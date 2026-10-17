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
