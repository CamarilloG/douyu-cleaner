// ==UserScript==
// @name         虎牙直播间纯净增强
// @namespace    https://github.com/CamarilloG/douyu-cleaner
// @version      0.2.0
// @description  重建极简播放器界面与评论区，保留官方播放及弹幕收发，原生弹幕悬停 +1。
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

/* Rebuilt Huya comments. Source: official #chat-room__list, never a second socket. */
(function (global) {
  'use strict';
  const drafts = new Map();
  function plainText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    if (['SCRIPT', 'STYLE'].includes(node.tagName)) return '';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '[图片]';
    if (node.tagName === 'BR') return '\n';
    return Array.from(node.childNodes || []).map(plainText).join('');
  }
  function parseRow(row) {
    // Verified on 660000: decoration badges are siblings of the name and J_msg.
    // Never derive a name by splitting the visible text on a colon.
    const body = row.querySelector('.J_msg');
    const nick = row.querySelector('.name.J_userMenu');
    const text = plainText(body || row).trim();
    if (!text) return null;
    return { id: row.getAttribute('data-cmid'), nick: body && nick ? nick.textContent.trim() : '', text, system: !(body && nick) };
  }
  function mount({ host, send, onCollapse }) {
    if (!host || typeof send !== 'function') throw new TypeError('Huya chat requires host and send');
    const doc = host.ownerDocument, win = doc.defaultView;
    const room = win.location.origin + win.location.pathname;
    let destroyed = false, sending = false, composing = false, stick = true, unread = 0, bound = null, scheduled = false;
    const seen = new Map(), seenNodes = new WeakSet();
    const panel = doc.createElement('section');
    panel.className = 'hc-chat-panel';
    panel.setAttribute('aria-label', '虎牙纯净评论');
    const style = doc.createElement('style');
    style.textContent = `
.hc-chat-panel{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;background:#13141a;color:#e6e6e6;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;box-sizing:border-box;overflow:hidden}
.hc-chat-panel *{box-sizing:border-box}.hc-chat-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #282b36;flex:none}.hc-chat-title{font-weight:600;flex:1}.hc-chat-count{font:12px system-ui;color:#8894a8}
.hc-chat-panel button{cursor:pointer;font:inherit;border:1px solid #394050;border-radius:6px;background:#242834;color:#e6e6e6;padding:4px 10px}.hc-chat-panel button:hover{background:#363e50}.hc-chat-panel button:disabled{opacity:.55;cursor:wait}.hc-chat-panel button:focus-visible,.hc-chat-input:focus-visible{outline:2px solid #72c1ff;outline-offset:2px}
.hc-chat-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 14px;scrollbar-width:thin;scrollbar-color:#454d5f transparent;overflow-anchor:none}.hc-chat-row{padding:5px 0;overflow-wrap:anywhere;white-space:pre-wrap}.hc-chat-nick{color:#95a8cd;margin-right:7px}.hc-chat-system{color:#8c95a7;font-size:12px}.hc-chat-jump{margin:4px 14px;flex:none}.hc-chat-jump[hidden]{display:none}
.hc-chat-compose{display:flex;gap:8px;padding:12px 14px 6px;flex:none;border-top:1px solid #282b36}.hc-chat-input{flex:1;min-width:0;background:#1d2029;border:1px solid #394050;border-radius:6px;color:#f4f5f8;font:inherit;padding:7px 10px}.hc-chat-send{flex:none}.hc-chat-status{font-size:12px;color:#a2adc1;padding:2px 14px 12px;min-height:32px;overflow-wrap:anywhere;flex:none}
`;
    const el = (tag, cls, text) => { const node = doc.createElement(tag); node.className = cls; if (text) node.textContent = text; return node; };
    const header = el('header', 'hc-chat-header');
    const count = el('span', 'hc-chat-count', '0 / 200');
    const collapse = el('button', 'hc-chat-collapse', '›'); collapse.type = 'button'; collapse.title = '折叠评论区'; collapse.setAttribute('aria-label', '折叠评论区');
    header.append(el('span', 'hc-chat-title', '纯净评论'), count, collapse);
    const list = el('div', 'hc-chat-list'); list.tabIndex = 0; list.setAttribute('aria-label', '直播评论记录');
    const jump = el('button', 'hc-chat-jump', '↓ 跳到最新'); jump.type = 'button'; jump.hidden = true;
    const compose = el('div', 'hc-chat-compose');
    const input = el('input', 'hc-chat-input'); input.type = 'text'; input.placeholder = '说点什么…'; input.setAttribute('aria-label', '发送弹幕内容'); input.value = drafts.get(room) || '';
    const submit = el('button', 'hc-chat-send', '发送'); submit.type = 'button';
    const status = el('div', 'hc-chat-status', '通过官方发送入口提交'); status.setAttribute('role', 'status');
    compose.append(input, submit); panel.append(style, header, list, jump, compose, status); host.append(panel);
    function saveDraft() {
      drafts.delete(room); drafts.set(room, input.value);
      while (drafts.size > 10) drafts.delete(drafts.keys().next().value);
    }
    function bottom() { list.scrollTop = list.scrollHeight; stick = true; unread = 0; jump.hidden = true; }
    function add(row, history) {
      const message = parseRow(row); if (!message) return;
      const key = message.id == null ? null : JSON.stringify([message.id, message.nick, message.text, message.system]);
      if (key ? seen.has(key) : seenNodes.has(row)) return;
      if (key) { seen.set(key, true); while (seen.size > 1000) seen.delete(seen.keys().next().value); }
      else seenNodes.add(row);
      const item = el('div', 'hc-chat-row' + (message.system ? ' hc-chat-system' : ''));
      if (message.nick) item.append(el('span', 'hc-chat-nick', message.nick + '：'));
      item.append(el('span', 'hc-chat-text', message.text)); list.append(item);
      while (list.children.length > 200) list.firstElementChild.remove();
      if (!stick && !history) { unread++; jump.textContent = '↓ ' + unread + ' 条新消息'; jump.hidden = false; }
    }
    function sync(history = false) {
      if (destroyed || !bound) return;
      for (const row of Array.from(bound.children).slice(-200)) add(row, history);
      count.textContent = list.children.length + ' / 200';
      if (stick) bottom();
    }
    const observer = new win.MutationObserver(() => {
      if (scheduled) return; scheduled = true;
      win.queueMicrotask(() => { scheduled = false; sync(); });
    });
    function bind() {
      if (destroyed) return;
      if (room !== win.location.origin + win.location.pathname) { destroy(); return; }
      const next = doc.querySelector('#chat-room__list');
      if (next === bound) return;
      observer.disconnect(); bound = next;
      if (bound) { sync(true); observer.observe(bound, { childList: true, subtree: true, characterData: true }); }
    }
    async function trySend() {
      if (destroyed || sending || composing) return;
      const draft = input.value, text = draft.trim(); if (!text) return;
      if (room !== win.location.origin + win.location.pathname) { status.textContent = '房间已变化，请刷新后重试'; return; }
      sending = true; submit.disabled = true; status.textContent = '正在提交…';
      try {
        const result = await send(text);
        if (destroyed) return;
        if (result?.status === 'sent') {
          if (input.value === draft) input.value = '';
          status.textContent = result.message || '已发送';
        } else if (result?.status === 'failed') status.textContent = result.message || '发送失败，草稿已保留，请检查原站登录及冷却提示';
        else status.textContent = (result?.message || '已提交，请核对官方发送结果') + '（草稿已保留）';
        saveDraft();
      } catch (_) { if (!destroyed) status.textContent = '提交失败，草稿已保留，请稍后手动重试'; }
      finally { sending = false; if (!destroyed) submit.disabled = false; }
    }
    list.addEventListener('scroll', () => { stick = list.scrollHeight - list.scrollTop - list.clientHeight < 28; if (stick) { unread = 0; jump.hidden = true; } });
    jump.addEventListener('click', bottom);
    collapse.addEventListener('click', () => { if (onCollapse) onCollapse(); });
    input.addEventListener('input', saveDraft);
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229 && !event.shiftKey) { event.preventDefault(); trySend(); }
    });
    submit.addEventListener('click', trySend);
    function destroy() { if (destroyed) return; destroyed = true; saveDraft(); observer.disconnect(); win.clearInterval(timer); panel.remove(); }
    const timer = win.setInterval(bind, 700);
    bind();
    return { destroy };
  }
  const api = { mount, parseRow, plainText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.HuyaCleanerChat = api;
})(typeof globalThis === 'object' ? globalThis : window);


/* Huya shell: custom controls/chat around the original player and danmaku. */
(() => {
  'use strict';
  if (!/(^|\.)huya\.com$/.test(location.hostname) || window.top !== window.self) return;
  const STORAGE = 'huya-cleaner-shell-v2';
  const defaults = { repeat: true, lowLatency: false, autoQuality: true, topbar: false, chat: true, ads: true, gifts: true, ranks: true, activities: true, volume: null, muted: false, qualityName: '', bufferTarget: 3 };
  let settings = { ...defaults };
  function readSettings(saved) {
    for (const key of Object.keys(defaults)) if (typeof defaults[key] === 'boolean') settings[key] = typeof saved[key] === 'boolean' ? saved[key] : defaults[key];
    settings.volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : null;
    settings.qualityName = typeof saved.qualityName === 'string' ? saved.qualityName.slice(0, 50) : '';
    settings.bufferTarget = Number.isFinite(saved.bufferTarget) && saved.bufferTarget >= 1 && saved.bufferTarget <= 10 ? saved.bufferTarget : 3;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    readSettings(saved);
  } catch (_) { /* Storage may be unavailable. Settings still work for this visit. */ }
  let active = null;
  let stopped = false;
  let disabledRoom = null;
  const roomKey = () => location.origin + location.pathname;
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rules = {
    ads: '#J_roomGgTop, #room-hd-banner, #ab-banner, #sidebarBanner',
    gifts: '#player-gift-wrap, #J_treasureChestContainer, #J_bigStreamerStage',
    ranks: '#J_roomHourRank, #J_roomFansRank, #J_roomWeeklyRankList',
    activities: '[id^="diy-activity-icon-"], #player-marquee-wrap, #J_communityContainer, #room-moments, #J_roomULike, #player-ext-wrap, #player-ext-wrap-under-barrage'
  };
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
      ['#pub_msg_input', '#msg_send_bt'],
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
    if (state.sending) return fail('上一条弹幕正在提交，请稍候');
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
    state.sending = true;
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
      state.sending = false;
      if (staged && !submitted && input.isConnected && value() === text) setValue(input, '');
    }
  }

  function apply(state) {
    state.revision = (state.revision || 0) + 1;
    state.cleanStyle.textContent = Object.entries(rules).filter(([key]) => settings[key])
      .map(([, selector]) => `${selector}{display:none!important}`).join('\n');
    state.shell.classList.toggle('hc-chat-collapsed', !settings.chat);
    state.shell.classList.toggle('hc-no-topbar', !settings.topbar);
    state.repeat?.destroy();
    state.repeat = settings.repeat ? window.LiveCleanerNativeRepeat.mount({ root: state.player, itemSelector: '#danmudiv .danmu-item', readText, send: text => send(text, state), roomKey }) : null;
    for (const input of state.shell.querySelectorAll('[data-setting]')) input.checked = settings[input.dataset.setting];
    state.shell.querySelector('#hc-buffer-target').value = String(settings.bufferTarget);
    if (!settings.lowLatency && state.rateVideo) { state.rateVideo.playbackRate = state.originalRate; state.rateVideo = null; }
    window.dispatchEvent(new Event('resize'));
  }
  const shellCSS = `
    #hc-shell{position:fixed;inset:0;z-index:10000;background:#080a0d;color:#e9edf3;font:13px/1.5 system-ui;display:grid;grid-template:44px minmax(0,1fr)/minmax(0,1fr) 340px;overflow:hidden;color-scheme:dark}
    #hc-shell *{box-sizing:border-box}#hc-shell button,#hc-shell select{font:inherit;color:inherit;background:#20252d;border:1px solid #363e49;border-radius:6px;padding:5px 10px;cursor:pointer}#hc-shell button:hover{background:#333c49}#hc-shell button:focus-visible,#hc-shell input:focus-visible,#hc-shell select:focus-visible{outline:2px solid #65b5ff;outline-offset:2px}
    #hc-titlebar{grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:0 14px;border-bottom:1px solid #262b33;background:#13171d}#hc-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#hc-brand{color:#f8ac45;font-weight:700;white-space:nowrap}
    #hc-video-host{position:relative;grid-column:1;min-width:0;min-height:0;background:#000;overflow:hidden}#hc-chat-host{grid-column:2;grid-row:2;min-width:0;min-height:0;height:100%;border-left:1px solid #282e38;background:#11151b;overflow:hidden}
    #hc-shell.hc-chat-collapsed{grid-template-columns:minmax(0,1fr) 0}#hc-shell.hc-chat-collapsed #hc-chat-host{visibility:hidden;border:0}#hc-shell.hc-no-topbar{grid-template-rows:0 minmax(0,1fr)}#hc-shell.hc-no-topbar #hc-titlebar{visibility:hidden}
    #hc-video-host>#J_playerMain,#hc-video-host #videoContainer,#hc-video-host #player-wrap,#hc-video-host #player-video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-height:0!important;min-width:0!important;margin:0!important;padding:0!important}
    #hc-video-host video{width:100%!important;height:100%!important;object-fit:contain!important}#hc-video-host .player-gift-wrap,#hc-video-host .player-gift,#hc-video-host #player-gift-wrap,#hc-video-host .player-ctrl-wrap,#hc-video-host #player-ctrl-wrap,#hc-video-host .player-full-input,#hc-video-host #player-top-right-btns{visibility:hidden!important;pointer-events:none!important}
    #hc-video-host #player-ext-wrap iframe[src*=".ext.huya.com"],#hc-video-host #player-ext-wrap-under-barrage iframe[src*=".ext.huya.com"]{display:none!important}
    #hc-controlbar{position:absolute;left:0;right:0;bottom:0;z-index:10000;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:24px 12px 12px;background:linear-gradient(transparent,#080a0ded);transition:opacity .2s}#hc-controlbar button{border-color:transparent;background:#20252dcc}#hc-volume{width:86px;accent-color:#f7a944}#hc-gap{margin-left:auto;font-size:12px;color:#bac6d8;font-variant-numeric:tabular-nums}#hc-quality{max-width:140px}
    #hc-shell.hc-idle #hc-controlbar{opacity:0;pointer-events:none}#hc-shell.hc-idle #hc-video-host{cursor:none}#hc-shell #hc-controlbar:focus-within{opacity:1;pointer-events:auto}
    #hc-settings{position:absolute;right:14px;bottom:66px;z-index:10002;width:260px;border:1px solid #3a4655;border-radius:10px;background:#181f29;padding:14px;box-shadow:0 8px 30px #0008}#hc-settings[hidden]{display:none}#hc-settings label{display:block;margin:8px 0}#hc-settings input{margin-right:8px}#hc-settings p{color:#9cacc0;font-size:12px;margin:10px 0 0}
    #hc-toast{position:absolute;left:50%;top:22px;transform:translateX(-50%);max-width:85%;padding:8px 14px;border-radius:8px;background:#202b3bef;color:#fff;z-index:10003;pointer-events:none}#hc-toast:empty{display:none}#hc-resume{position:fixed;right:16px;top:70px;z-index:2147483600;background:#202733;color:#fff;border:1px solid #56657c;border-radius:8px;padding:9px 14px;cursor:pointer}
    @media(max-width:850px){#hc-shell{grid-template-columns:minmax(0,1fr) 280px}#hc-controlbar{gap:4px;padding:20px 6px 6px}#hc-controlbar button{padding:4px 6px}#hc-volume{width:54px}#hc-gap{display:none}}
  `;
  const videoOf = state => state.player.querySelector('#hy-video') || state.player.querySelector('video');
  function toast(state, message) {
    if (active !== state) return;
    state.toast.textContent = message;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { state.toast.textContent = ''; }, 3500);
  }
  function qualityItems(state) {
    return [...state.player.querySelectorAll('.player-videotype-list li')].filter(item => item.textContent.trim() && !item.classList.contains('disabled') && item.getAttribute('aria-disabled') !== 'true');
  }
  function qualityScore(item) {
    const name = item.textContent;
    const number = name.match(/(\d+(?:\.\d+)?)\s*[Mm]/);
    return /原画/.test(name) ? 10000 : /4K/i.test(name) ? 9000 : /2K/i.test(name) ? 8000 : /HDR/i.test(name) ? 7000 + (number ? +number[1] : 0) : /蓝光/.test(name) ? 6000 + (number ? +number[1] : 0) : /超清/.test(name) ? 4000 : /高清/.test(name) ? 3000 : /流畅/.test(name) ? 1000 : 2000;
  }
  function refreshQuality(state) {
    const items = qualityItems(state);
    const signature = items.map(item => item.textContent.trim()).join('|');
    if (signature !== state.qualitySignature) {
      state.qualitySignature = signature;
      state.quality.replaceChildren(new Option(items.length ? '自动最高可用' : '等待官方画质', 'auto'));
      for (const [index, item] of items.entries()) state.quality.add(new Option(item.textContent.trim(), String(index)));
      state.quality.disabled = !items.length;
    }
    if (settings.autoQuality && items.length && state.autoQualitySignature !== signature) {
      state.autoQualitySignature = signature;
      const best = [...items].filter(item => !/付费|开通|会员|试用|登录/.test(item.textContent)).sort((a, b) => qualityScore(b) - qualityScore(a))[0];
      if (best && !best.classList.contains('on')) best.click();
    }
    if (!settings.autoQuality && settings.qualityName && state.manualQualitySignature !== signature) {
      state.manualQualitySignature = signature;
      const desired = items.find(item => item.textContent.trim() === settings.qualityName);
      if (desired && !desired.classList.contains('on')) desired.click();
    }
    if (settings.autoQuality) state.quality.value = 'auto';
    else { const selected = items.findIndex(item => item.classList.contains('on')); if (selected >= 0) state.quality.value = String(selected); }
  }
  function tick(state) {
    if (active !== state) return;
    refreshQuality(state);
    const video = videoOf(state);
    if (!video) { state.gap.textContent = '等待官方播放器'; return; }
    if (video !== state.video) {
      if (state.rateVideo) { state.rateVideo.playbackRate = state.originalRate; state.rateVideo = null; }
      state.video = video;
      if (settings.volume !== null) { video.volume = settings.volume; video.muted = settings.muted; }
    }
    state.play.textContent = video.paused ? '播放' : '暂停';
    state.mute.textContent = video.muted || !video.volume ? '取消静音' : '静音';
    if (document.activeElement !== state.volume) state.volume.value = String(video.muted ? 0 : Math.round(video.volume * 100));
    const danmuButton = state.player.querySelector('#player-danmu-btn');
    if (danmuButton) { state.danmaku.setAttribute('aria-pressed', String(/关闭/.test(danmuButton.title) || danmuButton.classList.contains('player-ctrl-switch-show'))); }
    let gap = null;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) gap = video.buffered.end(i) - video.currentTime;
    }
    state.gap.textContent = gap === null ? '缓冲差 —' : `缓冲差 ${gap.toFixed(1)}s`;
    if (settings.lowLatency && !video.paused && !video.seeking && video.readyState >= 3 && gap !== null) {
      if (state.rateVideo !== video) { state.rateVideo = video; state.originalRate = video.playbackRate; }
      video.playbackRate = gap > settings.bufferTarget ? 1.08 : state.originalRate;
    } else if (state.rateVideo) { state.rateVideo.playbackRate = state.originalRate; state.rateVideo = null; }
  }
  function mount(player) {
    document.querySelector('#hc-resume')?.remove();
    const state = { key: roomKey(), player, revision: 0, sending: false, repeat: null };
    const marker = document.createComment('huya-cleaner-player-origin');
    player.before(marker);
    const style = document.createElement('style'); style.textContent = shellCSS; document.head.append(style);
    const cleanStyle = document.createElement('style'); document.head.append(cleanStyle);
    const shell = document.createElement('div'); shell.id = 'hc-shell';
    shell.innerHTML = '<header id="hc-titlebar"><span id="hc-brand">虎牙 · 纯净</span><span id="hc-title"></span><button type="button" data-act="restore">恢复官方界面</button></header><main id="hc-video-host"><div id="hc-toast" role="status" aria-live="polite"></div><div id="hc-controlbar"><button type="button" data-act="play" title="播放 / 暂停（Space）">播放</button><button type="button" data-act="refresh">刷新</button><button type="button" data-act="mute" title="静音（M）">静音</button><input id="hc-volume" type="range" min="0" max="100" aria-label="音量"><select id="hc-quality" aria-label="画质"></select><span id="hc-gap" title="播放位置到本地缓冲末尾的时间，不是与主播现场的真实延迟">缓冲差 —</span><button type="button" data-act="danmaku" title="官方弹幕（D）">弹幕</button><button type="button" data-act="chat" title="折叠评论">评论</button><button type="button" data-act="settings">设置</button><button type="button" data-act="fullscreen" title="全屏（F）">全屏</button></div><aside id="hc-settings" hidden><strong>观看设置</strong><div id="hc-setting-items"></div><button type="button" data-act="restore">恢复官方界面</button><p>Space 播放 · F 全屏 · M 静音<br>D 弹幕 · H 顶栏<br>移到官方飞行弹幕上，点击 +1 复读。</p></aside></main><aside id="hc-chat-host"></aside>';
    const get = selector => shell.querySelector(selector);
    const host = get('#hc-video-host');
    Object.assign(state, { marker, style, cleanStyle, shell, host, toast: get('#hc-toast'), gap: get('#hc-gap'), play: get('[data-act="play"]'), mute: get('[data-act="mute"]'), danmaku: get('[data-act="danmaku"]'), volume: get('#hc-volume'), quality: get('#hc-quality'), settingsPanel: get('#hc-settings') });
    get('#hc-title').textContent = document.querySelector('#J_roomHeader h1')?.textContent?.trim() || document.title;
    document.body.append(shell); host.prepend(player); active = state;
    const labels = { repeat: '弹幕悬停 +1', lowLatency: '自动追帧（缓冲差偏大时加速）', autoQuality: '自动最高可用画质', topbar: '显示顶栏（H）', ads: '隐藏广告位', gifts: '隐藏礼物特效', activities: '隐藏活动' };
    for (const [key, title] of Object.entries(labels)) {
      const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.setting = key;
      input.addEventListener('change', () => { settings[key] = input.checked; state.autoQualitySignature = null; save(); apply(state); });
      label.append(input, title); get('#hc-setting-items').append(label);
    }
    const targetLabel = document.createElement('label');
    targetLabel.textContent = '目标缓冲差（秒） ';
    const targetInput = document.createElement('input'); Object.assign(targetInput, { id: 'hc-buffer-target', type: 'number', min: '1', max: '10', step: '0.5', value: String(settings.bufferTarget) }); targetInput.style.width = '60px';
    targetInput.addEventListener('change', () => { const value = Number(targetInput.value); settings.bufferTarget = Number.isFinite(value) ? Math.max(1, Math.min(10, value)) : 3; targetInput.value = String(settings.bufferTarget); save(); });
    targetLabel.append(targetInput); get('#hc-setting-items').append(targetLabel);
    const collapse = () => { settings.chat = !settings.chat; save(); apply(state); };
    const act = async name => {
      const video = videoOf(state);
      try {
        if (name === 'play') { if (!video) return toast(state, '等待官方播放器'); if (video.paused) await video.play(); else video.pause(); }
        else if (name === 'mute' && video) { video.muted = !video.muted; settings.muted = video.muted; settings.volume = video.volume; save(); }
        else if (name === 'refresh') { const button = player.querySelector('.player-refresh-btn'); if (button) button.click(); else toast(state, '官方刷新入口尚未加载'); }
        else if (name === 'danmaku') { const button = player.querySelector('#player-danmu-btn'); if (button) button.click(); else toast(state, '官方弹幕开关尚未加载'); }
        else if (name === 'chat') collapse();
        else if (name === 'topbar') { settings.topbar = !settings.topbar; save(); apply(state); }
        else if (name === 'fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else await shell.requestFullscreen(); }
        else if (name === 'settings') { state.settingsPanel.hidden = !state.settingsPanel.hidden; wake(); }
        else if (name === 'restore') { disabledRoom = state.key; unmount(); offerResume(); }
      } catch (_) { toast(state, '操作暂不可用，请检查官方播放器状态'); }
      if (active === state) tick(state);
    };
    shell.addEventListener('click', event => { const button = event.target.closest('[data-act]'); if (button) { event.preventDefault(); event.stopPropagation(); act(button.dataset.act); } });
    host.addEventListener('dblclick', event => {
      if (event.target.closest('button,input,select,textarea,a,[contenteditable],#hc-controlbar,#hc-settings,.lc-native-repeat-layer')) return;
      event.preventDefault(); event.stopImmediatePropagation(); act('fullscreen');
    }, true);
    state.volume.addEventListener('input', () => { const video = videoOf(state); if (video) { video.volume = Number(state.volume.value) / 100; video.muted = video.volume === 0; settings.volume = video.volume; settings.muted = video.muted; save(); } });
    state.quality.addEventListener('change', () => {
      const value = state.quality.value; settings.autoQuality = value === 'auto'; state.autoQualitySignature = null;
      const selected = value !== 'auto' ? qualityItems(state)[Number(value)] : null;
      settings.qualityName = selected?.textContent.trim() || ''; state.manualQualitySignature = state.qualitySignature; save();
      selected?.click(); apply(state); tick(state);
    });
    const wake = () => { shell.classList.remove('hc-idle'); clearTimeout(state.idleTimer); state.idleTimer = setTimeout(() => { if (state.settingsPanel.hidden && !shell.querySelector('#hc-controlbar:focus-within')) shell.classList.add('hc-idle'); }, 2800); };
    shell.addEventListener('pointermove', wake, true); shell.addEventListener('focusin', wake);
    state.keydown = event => {
      if (event.key === 'Escape' && !state.settingsPanel.hidden) { state.settingsPanel.hidden = true; event.preventDefault(); event.stopImmediatePropagation(); wake(); return; }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const action = { ' ': 'play', f: 'fullscreen', m: 'mute', d: 'danmaku', h: 'topbar' }[event.key.toLowerCase()];
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); wake(); act(action); }
    };
    document.addEventListener('keydown', state.keydown, true);
    state.chat = window.HuyaCleanerChat?.mount({ host: get('#hc-chat-host'), send: text => send(text, state), onCollapse: collapse });
    state.tickTimer = setInterval(() => tick(state), 1000);
    apply(state); tick(state); wake();
  }
  function offerResume() {
    if (document.querySelector('#hc-resume')) return;
    const button = document.createElement('button'); button.id = 'hc-resume'; button.textContent = '启用虎牙纯净版';
    button.style.cssText = 'position:fixed;right:16px;top:70px;z-index:2147483600;background:#202733;color:white;padding:10px;border-radius:8px;cursor:pointer';
    button.addEventListener('click', () => { disabledRoom = null; button.remove(); sync(); }); document.body.append(button);
  }
  function unmount(discardPlayer = false) {
    if (!active) return;
    const state = active; active = null; state.revision++;
    clearInterval(state.tickTimer); clearTimeout(state.idleTimer); clearTimeout(state.toastTimer);
    document.removeEventListener('keydown', state.keydown, true);
    state.repeat?.destroy(); state.chat?.destroy();
    if (state.rateVideo) state.rateVideo.playbackRate = state.originalRate;
    if (document.fullscreenElement === state.shell) document.exitFullscreen().catch(() => {});
    if (discardPlayer) { state.player.remove(); state.marker.remove(); }
    else if (state.marker.isConnected) state.marker.replaceWith(state.player);
    else if (state.player.isConnected) state.player.remove();
    state.cleanStyle.remove(); state.style.remove(); state.shell.remove();
    window.dispatchEvent(new Event('resize'));
  }
  function sync() {
    if (stopped) return;
    const roomPath = /^\/[a-zA-Z0-9_-]+\/?$/.test(location.pathname);
    const replacement = document.querySelector('#J_mainRoom #J_playerMain');
    if (active && (active.key !== roomKey() || !active.player.isConnected || !active.marker.isConnected || (replacement && replacement !== active.player))) unmount(!!replacement && replacement !== active.player);
    if (disabledRoom && disabledRoom !== roomKey()) { disabledRoom = null; document.querySelector('#hc-resume')?.remove(); }
    if (!active && roomPath && disabledRoom !== roomKey() && document.querySelector('#chatRoom') && document.querySelector('#J_roomHeader') && window.LiveCleanerNativeRepeat && window.HuyaCleanerChat) {
      const player = document.querySelector('#J_mainRoom #J_playerMain'); if (player) mount(player);
    }
  }
  setInterval(sync, 1000);
  window.addEventListener('popstate', sync);
  window.addEventListener('pagehide', () => { stopped = true; unmount(); });
  window.addEventListener('pageshow', () => { stopped = false; sync(); });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE) return;
    try { readSettings(JSON.parse(event.newValue || '{}')); if (active) { active.autoQualitySignature = null; active.manualQualitySignature = null; active.video = null; apply(active); } } catch (_) { /* Ignore malformed external settings. */ }
  });
  sync();
})();
