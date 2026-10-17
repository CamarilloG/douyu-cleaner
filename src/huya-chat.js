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
