// ==UserScript==
// @name         虎牙直播间纯净增强
// @namespace    https://github.com/CamarilloG/douyu-cleaner
// @version      0.1.0
// @description  保留官方播放器和弹幕，原生弹幕悬停复读 +1、可选纯净布局与一键恢复。
// @match        https://www.huya.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/CamarilloG/douyu-cleaner/main/huya-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/CamarilloG/douyu-cleaner/main/huya-cleaner.user.js
// @supportURL   https://github.com/CamarilloG/douyu-cleaner/issues
// ==/UserScript==

// BEGIN SHARED NATIVE REPEAT
/* Native flying-danmaku interaction. Never copies or redraws the danmaku layer. */
(function (global) {
    'use strict';

    function inside(rect, x, y, padding = 0) {
        return rect && x >= rect.left - padding && x <= rect.right + padding &&
            y >= rect.top - padding && y <= rect.bottom + padding;
    }

    function readable(item, readText) {
        // A platform adapter must additionally exclude badges, gifts and system messages.
        if (!item) return null;
        const text = readText(item);
        return typeof text === 'string' && text.trim() && !text.includes('\uFFFC') ? text.trim() : null;
    }

    function hitTest(items, x, y, readText, rootRect) {
        if (!inside(rootRect, x, y)) return null;
        // Prefer the last painted item, and cap work on very busy rooms.
        const list = Array.from(items).slice(-500);
        for (let i = list.length - 1; i >= 0; i--) {
            const item = list[i];
            if (!item.isConnected) continue;
            const rect = item.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || !inside(rect, x, y)) continue;
            const style = item.ownerDocument.defaultView.getComputedStyle(item);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
            const text = readable(item, readText);
            if (text) return { item, text, rect };
        }
        return null;
    }

    function createSender(send, roomKey, now = Date.now, cooldownMs = 1200) {
        let pending = false;
        let destroyed = false;
        let lastAttempt = -Infinity;
        return {
            destroy() { destroyed = true; },
            async submit(snapshot) {
                if (destroyed || snapshot.room !== roomKey()) return { status: 'failed', message: '房间已变化，请重新选择弹幕' };
                if (pending || now() - lastAttempt < cooldownMs) return { status: 'failed', message: '请稍后再试' };
                pending = true;
                lastAttempt = now();
                try {
                    const result = await send(snapshot.text);
                    if (result && ['sent', 'submitted', 'failed'].includes(result.status)) return result;
                    return { status: 'submitted', message: '已提交，请查看原站发送结果' };
                } catch (error) {
                    return { status: 'failed', message: '发送失败，请在原站确认登录、禁言和发送冷却状态' };
                } finally {
                    pending = false;
                }
            }
        };
    }

    function mount(options) {
        const { root, readText, send, roomKey } = options;
        if (!root || !root.ownerDocument || typeof readText !== 'function' || typeof send !== 'function' || typeof roomKey !== 'function') {
            throw new TypeError('Native repeat requires root, readText, send and roomKey');
        }
        const doc = root.ownerDocument;
        const win = doc.defaultView;
        const sender = createSender(send, roomKey);
        const layer = doc.createElement('div');
        layer.className = 'lc-native-repeat-layer';
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483646;overflow:visible;';
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = '+1';
        button.hidden = true;
        button.style.cssText = 'position:absolute;pointer-events:auto;min-width:36px;height:28px;padding:0 8px;border:1px solid #ffffff99;border-radius:6px;background:#17191feb;color:white;font:600 14px/26px sans-serif;cursor:pointer;box-shadow:0 2px 8px #0008;white-space:nowrap;';
        const notice = doc.createElement('div');
        notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:absolute;left:50%;bottom:64px;transform:translateX(-50%);max-width:85%;padding:8px 12px;border-radius:6px;background:#17191feb;color:white;font:14px/1.5 sans-serif;display:none;';
        layer.append(button, notice);
        let host = null, restorePosition = null, selected = null, resume = [], frame = 0;
        let hideTimer = 0, noticeTimer = 0, destroyed = false, point = null, sending = false;
        const initialRoom = roomKey();

        function attach() {
            const full = doc.fullscreenElement;
            const next = full && root.contains(full) ? full : root;
            if (host === next) return;
            clear();
            if (restorePosition) restorePosition();
            host = next;
            restorePosition = null;
            if (win.getComputedStyle(host).position === 'static') {
                const old = host.style.position;
                host.style.position = 'relative';
                restorePosition = () => { if (host.style.position === 'relative') host.style.position = old; };
            }
            host.appendChild(layer);
        }

        function clear() {
            win.clearTimeout(hideTimer);
            hideTimer = 0;
            selected = null;
            button.hidden = true;
            for (const animation of resume) {
                try { if (animation.playState === 'paused') animation.play(); } catch (_) { /* removed animation */ }
            }
            resume = [];
        }

        function showNotice(message) {
            notice.textContent = message;
            notice.style.display = 'block';
            win.clearTimeout(noticeTimer);
            noticeTimer = win.setTimeout(() => { notice.style.display = 'none'; }, 3000);
        }

        function select(hit) {
            clear();
            selected = { ...hit, room: roomKey(), selectedAt: Date.now() };
            // Pause only running Web Animations. JS-driven transforms remain untouched.
            if (hit.item.getAnimations) {
                for (const animation of hit.item.getAnimations()) {
                    if (animation.playState === 'running') {
                        try { animation.pause(); resume.push(animation); } catch (_) { /* unsupported animation */ }
                    }
                }
            }
            const bounds = host.getBoundingClientRect();
            const sx = bounds.width ? (host.clientWidth || bounds.width) / bounds.width : 1;
            const sy = bounds.height ? (host.clientHeight || bounds.height) / bounds.height : 1;
            // Anchor to the selected snapshot so a moving DOM item cannot change the click target.
            button.style.left = Math.max(0, Math.min((hit.rect.right - bounds.left + 5) * sx, (host.clientWidth || bounds.width) - 42)) + 'px';
            button.style.top = Math.max(0, Math.min((hit.rect.top - bounds.top) * sy, (host.clientHeight || bounds.height) - 30)) + 'px';
            button.title = '复读：' + hit.text;
            button.setAttribute('aria-label', '复读弹幕：' + hit.text);
            button.hidden = false;
        }

        function inspect() {
            frame = 0;
            if (destroyed || !point || sending) return;
            if (roomKey() !== initialRoom) { clear(); return; }
            const { x, y } = point;
            if (selected) {
                const buttonRect = button.getBoundingClientRect();
                const buttonActive = inside(buttonRect, x, y, 8) || doc.activeElement === button;
                if (!selected.item.isConnected || (!buttonActive && readable(selected.item, readText) !== selected.text)) {
                    clear();
                } else if (buttonActive || (inside(selected.rect, x, y, 8) &&
                    (Date.now() - selected.selectedAt < 2000 || inside(selected.item.getBoundingClientRect(), x, y, 8)))) {
                    win.clearTimeout(hideTimer); hideTimer = 0; return;
                }
            }
            const items = options.getItems ? options.getItems() : root.querySelectorAll(options.itemSelector);
            const hit = hitTest(items, x, y, readText, host.getBoundingClientRect());
            if (hit) select(hit);
            else if (selected && !hideTimer) hideTimer = win.setTimeout(clear, 350);
        }

        function move(event) {
            if (event.pointerType === 'touch') return;
            if (!host || !inside(host.getBoundingClientRect(), event.clientX, event.clientY)) { leave(event); return; }
            point = { x: event.clientX, y: event.clientY };
            if (!frame) frame = win.requestAnimationFrame(inspect);
        }
        function leave(event) {
            if (layer.contains(event.relatedTarget)) return;
            point = null;
            if (!hideTimer) hideTimer = win.setTimeout(clear, 350);
        }
        function buttonEnter() { win.clearTimeout(hideTimer); hideTimer = 0; }
        function stop(event) { event.stopPropagation(); }
        async function click(event) {
            event.preventDefault(); event.stopPropagation();
            if (!selected || sending) return;
            const snapshot = { text: selected.text, room: selected.room };
            sending = true;
            button.disabled = true;
            const result = await sender.submit(snapshot);
            sending = false;
            button.disabled = false;
            if (destroyed || snapshot.room !== roomKey()) return;
            showNotice(result.message || ({ sent: '已发送', submitted: '已提交，请查看原站发送结果', failed: '发送失败' })[result.status]);
            clear();
        }
        function contextChanged() { clear(); }
        // Document capture also handles a fullscreen native layer with pointer-events:none:
        // its events can target the page rather than the (smaller) original player root.
        doc.addEventListener('pointermove', move, true);
        doc.addEventListener('pointerleave', leave);
        button.addEventListener('pointerenter', buttonEnter);
        button.addEventListener('pointerdown', stop);
        button.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener('click', click);
        doc.addEventListener('fullscreenchange', attach);
        win.addEventListener('resize', contextChanged);
        win.addEventListener('scroll', contextChanged, true);
        // Hover is the entry point, but the revealed control can also be focused.
        button.addEventListener('focus', buttonEnter);
        button.addEventListener('blur', contextChanged);
        attach();
        // New native messages also pass under a stationary cursor. Poll only while in the player.
        const hoverTimer = win.setInterval(() => { if (point && !frame) frame = win.requestAnimationFrame(inspect); }, 180);
        return {
            destroy() {
                if (destroyed) return;
                destroyed = true;
                sender.destroy(); clear();
                win.cancelAnimationFrame(frame);
                win.clearTimeout(noticeTimer);
                win.clearInterval(hoverTimer);
                doc.removeEventListener('pointermove', move, true);
                doc.removeEventListener('pointerleave', leave);
                doc.removeEventListener('fullscreenchange', attach);
                win.removeEventListener('resize', contextChanged);
                win.removeEventListener('scroll', contextChanged, true);
                layer.remove();
                if (restorePosition) restorePosition();
            }
        };
    }
    const api = { mount, hitTest, createSender };
    if (typeof module === 'object' && module.exports) module.exports = api;
    global.LiveCleanerNativeRepeat = api;
})(typeof globalThis === 'object' ? globalThis : window);

// END SHARED NATIVE REPEAT

/* Huya adapter. Keep the official player, chat renderer and composer in place. */
(() => {
  'use strict';
  if (!/(^|\.)huya\.com$/.test(location.hostname) || window.top !== window.self) return;
  const STORAGE = 'huya-cleaner-native-v1';
  const defaults = { repeat: true, cinema: false, ads: true, gifts: false, ranks: false, activities: false };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    for (const key of Object.keys(defaults)) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  } catch (_) { /* Storage may be unavailable. Settings still work for this visit. */ }
  let active = null;
  let stopped = false;
  const roomKey = () => location.origin + location.pathname;
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rules = {
    ads: '#J_roomGgTop, #room-hd-banner, #ab-banner, #sidebarBanner',
    gifts: '#player-gift-wrap, #J_treasureChestContainer, #J_bigStreamerStage',
    ranks: '#J_roomHourRank, #J_roomFansRank, #J_roomWeeklyRankList',
    activities: '[id^="diy-activity-icon-"], #player-marquee-wrap, #J_communityContainer, #room-moments, #J_roomULike'
  };
  // Verified room-core is the common ancestor of native player and chat in both
  // ordinary and event rooms. Do not override the player's own internal sizing.
  const cinemaCSS = `
    @media(min-width:900px) {
      html:not(:has(:fullscreen)) div:has(>#sidebar-scroll),
      html:not(:has(:fullscreen)) #sidebar-show-btn {display:none!important}
      html:not(:has(:fullscreen)) #J_mainRoom .room-core {
        position:fixed!important;inset:60px 0 0!important;margin:0!important;
        width:auto!important;min-width:0!important;height:auto!important;
        display:grid!important;grid-template-columns:minmax(0,1fr) 340px;
        gap:10px;padding:10px;box-sizing:border-box;background:#17191f;z-index:100;
        overflow:auto;align-items:start;
      }
      html:not(:has(:fullscreen)) #J_mainRoom .room-core>.room-core-l,
      html:not(:has(:fullscreen)) #J_mainRoom .room-core>.room-core-r {
        position:relative!important;inset:auto!important;width:100%!important;min-width:0!important;margin:0!important;float:none!important;
      }
      html:not(:has(:fullscreen)) #J_mainRoom .room-core>.room-core-r {height:100%!important;min-height:0!important}
      html:not(:has(:fullscreen)) #J_mainRoom .room-core>.room-core-r .room-sidebar {position:relative!important;inset:auto!important;width:100%!important;height:100%!important;box-sizing:border-box}
      html:not(:has(:fullscreen)) #J_mainRoom .room-core #J_roomSideHd {display:none!important}
    }
  `;
  function save() {
    try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch (_) { /* Session-only settings. */ }
  }
  function readText(item) {
    // Verified on the native HTML renderer: an empty, hidden img is always present.
    // Do not confuse that placeholder with a real picture/emoji message.
    if (Array.from(item.querySelectorAll('img')).some(img => img.getAttribute('src') && visible(img))) return null;
    const span = item.querySelector(':scope > span');
    if (!span || span.querySelector('img,svg,canvas')) return null;
    const text = span.textContent.trim();
    return text && text.length <= 500 ? text : null;
  }
  function findComposer() {
    const candidates = [
      ['#J_RoomChatSpeaker textarea, #J_RoomChatSpeaker input[type="text"], #J_RoomChatSpeaker [contenteditable="true"]', '#msg_send_bt'],
      ['#player-full-input-txt', '#player-full-input-btn']
    ];
    for (const [inputSelector, buttonSelector] of candidates) {
      const input = Array.from(document.querySelectorAll(inputSelector)).find(visible);
      const button = document.querySelector(buttonSelector);
      if (input && visible(button)) return { input, button };
    }
    return null;
  }
  function setValue(input, value) {
    if (input.isContentEditable) input.textContent = value;
    else {
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function send(text, state) {
    const fail = message => ({ status: 'failed', message });
    const revision = state.revision;
    if (active !== state || roomKey() !== state.key || !state.player.isConnected) return fail('房间已切换，请重新选择弹幕');
    const composer = findComposer();
    if (!composer) return fail('官方输入框尚不可用，请先确认登录及原站聊天框已加载');
    const { input, button } = composer;
    const unavailable = () => input.disabled || input.readOnly || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.classList.contains('disabled');
    if (unavailable()) {
      return fail('官方发送暂不可用，请检查登录、禁言或冷却提示');
    }
    if (input.maxLength > 0 && text.length > input.maxLength) return fail('这条弹幕超过官方输入框长度限制');
    const rich = input.isContentEditable;
    const value = () => rich ? input.textContent : input.value;
    if (value() || (rich && input.querySelector('img,svg,canvas,video,audio'))) return fail('官方输入框已有草稿，请先发送或清空草稿后复读');
    let staged = false;
    let submitted = false;
    try {
      staged = true;
      setValue(input, text);
      await new Promise(resolve => setTimeout(resolve, 80));
      if (value() !== text) return fail('输入内容已改变，已取消复读');
      if (active !== state || roomKey() !== state.key || !state.player.isConnected || revision !== state.revision) return fail('房间或插件设置已改变，未提交');
      const current = findComposer();
      if (!input.isConnected || !button.isConnected || current?.input !== input || current?.button !== button || unavailable()) return fail('官方发送入口已改变或暂不可用，未提交');
      // Once the official handler receives the click, leave the text intact:
      // it may read the editor asynchronously and owns its eventual clearing.
      submitted = true;
      button.click();
      // A click does not prove server acceptance. Never infer success from clearing
      // the field or from another viewer posting identical text.
      return { status: 'submitted', message: '已提交给官方发送入口，请查看原站登录、禁言或冷却反馈' };
    } catch (_) {
      return fail('未能提交，请使用官方输入框重试');
    } finally {
      if (staged && !submitted && input.isConnected && value() === text) setValue(input, '');
    }
  }
  function apply(state) {
    state.revision = (state.revision || 0) + 1;
    state.style.textContent = Object.entries(rules).filter(([key]) => settings[key])
      .map(([, selector]) => `${selector}{display:none!important}`).join('\n') + (settings.cinema ? cinemaCSS : '');
    state.repeat?.destroy();
    state.repeat = settings.repeat ? window.LiveCleanerNativeRepeat.mount({
      root: state.player,
      itemSelector: '#danmudiv .danmu-item',
      readText,
      send: text => send(text, state),
      roomKey
    }) : null;
    for (const [key, input] of Object.entries(state.controls)) input.checked = settings[key];
    updateStatus(state);
  }
  function updateStatus(state) {
    const layer = state.player.querySelector('#danmudiv');
    state.status.textContent = !settings.repeat ? '弹幕 +1 已关闭' : layer
      ? '移到视频中的官方文字弹幕上，点击 +1 复读。'
      : '等待官方文字弹幕层；Canvas 弹幕暂不支持逐条复读。';
  }
  function mount(player) {
    const state = { key: roomKey(), player, repeat: null, controls: {} };
    const style = document.createElement('style');
    style.id = 'hc-native-clean-style';
    document.head.append(style);
    const panelStyle = document.createElement('style');
    panelStyle.textContent = '#hc-native-settings{position:fixed;right:12px;top:70px;z-index:2147483600;background:#20242e;color:#fff;border:1px solid #64748b;border-radius:10px;font:13px/1.7 system-ui;padding:8px 12px;max-width:260px;box-shadow:0 3px 16px #0005}#hc-native-settings summary{cursor:pointer;user-select:none}#hc-native-settings label{display:block;margin:5px 0}#hc-native-settings input{margin-right:8px}#hc-native-settings button{margin-top:8px;cursor:pointer;background:#fff;color:#20242e;border:0;border-radius:5px;padding:5px 10px}#hc-native-settings p{margin:8px 0 0;color:#cbd5e1;white-space:normal}';
    document.head.append(panelStyle);
    const panel = document.createElement('details');
    panel.id = 'hc-native-settings';
    const summary = document.createElement('summary');
    summary.textContent = '虎牙纯净 · 原生优先';
    panel.append(summary);
    const labels = { repeat: '弹幕悬停 +1', cinema: '影院布局（官方视频 + 聊天）', ads: '隐藏页面广告位', gifts: '隐藏礼物特效与宝箱', ranks: '隐藏榜单', activities: '隐藏活动与推荐' };
    for (const [key, title] of Object.entries(labels)) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => { settings[key] = input.checked; save(); apply(state); });
      label.append(input, title);
      state.controls[key] = input;
      panel.append(label);
    }
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = '恢复官方界面';
    restore.addEventListener('click', () => {
      for (const key of Object.keys(settings)) settings[key] = false;
      save(); apply(state);
    });
    const status = document.createElement('p');
    status.setAttribute('aria-live', 'polite');
    panel.append(restore, status);
    document.body.append(panel);
    Object.assign(state, { style, panelStyle, panel, status });
    active = state;
    apply(state);
  }
  function unmount() {
    if (!active) return;
    active.repeat?.destroy();
    active.style.remove();
    active.panelStyle.remove();
    active.panel.remove();
    active = null;
  }
  function sync() {
    if (stopped) return;
    // A single path segment includes both numeric rooms and named/event rooms.
    // Require room DOM too, so search/category/account pages never get altered.
    const roomPath = /^\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname);
    const player = roomPath && document.querySelector('#J_mainRoom #J_playerMain');
    const valid = player && document.querySelector('#chatRoom') && document.querySelector('#J_roomHeader');
    if (active && (!valid || active.player !== player || active.key !== roomKey())) unmount();
    if (valid && !active && window.LiveCleanerNativeRepeat) mount(player);
    else if (active) updateStatus(active);
  }
  const timer = setInterval(sync, 1000);
  window.addEventListener('popstate', sync);
  window.addEventListener('pagehide', () => { stopped = true; unmount(); });
  window.addEventListener('pageshow', () => { stopped = false; sync(); });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE) return;
    try {
      const next = JSON.parse(event.newValue || '{}');
      for (const key of Object.keys(defaults)) settings[key] = typeof next[key] === 'boolean' ? next[key] : defaults[key];
      if (active) apply(active);
    } catch (_) { /* Ignore malformed external settings. */ }
  });
  // No chat mirroring, player reparenting, canvas interception or auto-send loop.
  sync();
})();
