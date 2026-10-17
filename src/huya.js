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
