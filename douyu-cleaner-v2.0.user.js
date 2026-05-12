// ==UserScript==
// @name         斗鱼直播间极简版
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      2.0.0
// @description  彻底重写直播间前端：极简 shell（左视频 + 右弹幕）/ 自动最高画质 / 实时低延迟（硬跳追帧）/ 自定义评论区（DOM 镜像 + 原生发送转发）。保留原生 mpegts 播放器与 WebSocket，仅 reparent 与控制 <video> 属性。
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  v2.0 设计要点（基于实地浏览器调研）：
    1) 协议：斗鱼自研 .xs（dyp2p 混合）+ mpegts 在 Worker 内跑，主线程拿
       MediaSourceHandle。无法 hook 内部 stashBuffer，但 <video> 属性可控。
    2) 降延迟主力：currentTime 硬跳（lag → 0.3s, 2s 后稳定 0.8s）。
       playbackRate 改值会被 mpegts 内部复位，不持久，弃用。
    3) 类名策略：斗鱼新版 CSS Module，类名是 hash 形式，必须用前缀匹配
       [class^="rate-"] / [class^="danmu-"]。仅 ID 选择器（#js-player-*）稳定。
    4) 版面：position:fixed; inset:0; z-index:9999 直接覆盖整个原页面。
       reparent #js-player-video-case（含飞行弹幕和特效层）进自建 shell。
       原 DOM 留在底层（React/WebSocket 继续跑），不删除。
    5) 自动最高画质：[class^="rate-"] 内 <li> 默认按 原画→2K60→蓝光8M→...
       排列，按优先级文本匹配点击。
    6) v1.x 的广告黑名单 + XHR/fetch 拦截原样保留。
*/

(function () {
    'use strict';

    /* 防御：清掉前一个版本（v1.x）可能遗留的 panel/shell 节点。
       v1.x 把 panel 挂在 #js-player-asideMain，v2 改挂在 #dy-shell-chat。
       Tampermonkey 升级时通常会重新执行脚本，但旧 IIFE 的 DOM 节点不会自动清掉。 */
    document.querySelectorAll('#dy-chat-panel, #dy-shell').forEach(el => {
        try { el.remove(); } catch (e) { /* noop */ }
    });

    /* ================================================================
     * § 1. 配置
     * ================================================================ */
    const CFG = {
        SEL_PLAYER_CASE: '#js-player-video-case',
        SEL_PLAYER_MULTI: '#js-player-multiContainer',
        SEL_RATE: '[class^="rate-"]',
        SEL_BARRAGE: '.Barrage-list',
        SEL_CHAT_INPUT: '.ChatSend-txt',
        SEL_CHAT_SEND: '.ChatSend-button',
        CHAT_WIDTH: 350,
        LATENCY_THRESHOLD: 3.0,
        LATENCY_TARGET: 0.5,
        LATENCY_CHECK_MS: 2000,
        MAX_MESSAGES: 200,
        NEAR_BOTTOM_PX: 24,
        QUALITY_PRIORITY: ['原画', '2K60', '2K', '蓝光8M', '蓝光4M', '蓝光', '超清', '高清'],
    };

    /* ================================================================
     * § 2. 广告黑名单（v1.5 沿用 + 兜底）
     * ================================================================ */
    const adHideSelectors = [
        '.ScreenBannerAd', '.banner__aJxj6', '.advert__J8F6s', '.DropMenuList-ad',
        '[class*="ScreenBannerAd"]', '[class*="advert__"]', '[class*="-advert"]',
        '[class*="Advert"]', '[class*="-Ad-"]', '[class^="ad-"]', '[class*=" ad-"]',
        '[class*="wm-pc-room-DropMenu"]', '[class*="wm-pc-room-button"]',
        '.SupremeRightHeader', '[class*="SupremeRight"]',
        '.CreateCenter', '[class*="CreateCenter"]', '.Header-createcenter-wrap',
        '.Header-download-wrap',
        '[class*="Download-panel"]', '[class*="Download-pcClient"]',
        '[class*="Download-mobile"]', '[class*="Download-list"]',
        '.Header-taskentry-wrap',
        '[class*="taskScoreEntry"]', '[class*="TaskEntryPanel"]',
        '.activeItem__d6uUm',
        '[class*="activeItem__"]', '[class*="activeBar__"]', '[class*="activeContainer__"]',
        '.RechargeBigRewards',
        '[class*="RechargeBigRewards"]', '[class*="Recharge"]', '[class*="recharge"]',
        '[class*="BigRewards"]', '[class*="SupplyStation"]', '[class*="supplyStation"]',
        '[class*="GiftRoll"]', '[class*="gameAd"]',
        '[class*="PubgGamePropShop"]',
        '[class*="ActBase"].is-show',
        '[class*="ActBase-bar"]', '[class*="ActBase-switch"]', '[class*="ActBase-Pendant"]',
        '[class*="ActRotation"]',
        '.layout-Player-rankAll', '.layout-Player-rank', '.ChatRank',
        '[class*="DiamondsFansRank"]', '[class*="RankTips"]', '[class*="ChatTabContainer"]',
        '.FishballTreasure', '.TreasureEntrance',
        '.LotteryContainer-svgaWrap', '.LotteryContainer-svgaDes', '.AnchorDrawLottery',
        '[class*="SignIn"]', '[class*="signin"]',
        '[class*="TaskCenter"]', '[class*="ActivityItem"]',
        '[class*="Lottery"]', '[class*="Coupon"]',
        '[class*="ShopKeeper"]', '[class*="WearMedal"]', '[class*="Backpack-newPropTip"]',
        '[class*="CPSDialog"]', '[class*="AnchorUpDialog"]',
        '.GiftInfoPanel-banner', '.GiftInfoPanel-bannerContainer',
        '[class*="GiftInfoPanel-banner"]', '.AdvancedGiftBanner',
        '[class*="InteractABAd"]',
        '[class*="Promotion"]', '[class*="Business"]',
        '[class*="RecomBox"]', '[class*="RoomRecom"]', '[class*="recommend-"]',
        '[class*="RoomVipList"]',
        '[class*="ToolbarGiftCard"]', '[class*="ToolbarGiftArea"]',
        '[class*="PlayerToolbar-Task"]',
        '[class*="DiamondsFansEnter"]', '[class*="AnchorGachaEntrance"]',
        '[class*="NobleToolbarEnter"]', '[class*="VRankEntrance"]',
        '.roomSmallPlayerFloatLayout',
        '[class*="FloatLayout"]', '[class*="float-ad"]',
        '[class*="XinghaiAd"]',
    ];

    /* ================================================================
     * § 3. CSS
     * ================================================================ */
    const css = `
        ${adHideSelectors.join(',')}{ display:none !important; }

        /* 极简 shell：覆盖整个 viewport */
        #dy-shell{
            position:fixed !important; inset:0 !important;
            background:#000;
            display:flex; flex-direction:row;
            z-index:9999;
            font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
        }
        #dy-shell-video{
            flex:1 1 auto; position:relative; background:#000;
            min-width:0; overflow:hidden;
        }
        /* reparent 进来的播放器容器强制铺满视频区 */
        #dy-shell-video > ${CFG.SEL_PLAYER_CASE}{
            position:absolute !important; inset:0 !important;
            width:100% !important; height:100% !important;
            transform:none !important;
        }
        #dy-shell-video ${CFG.SEL_PLAYER_MULTI},
        #dy-shell-video [class*="layout-Player-videoEntity"]{
            position:absolute !important; inset:0 !important;
            width:100% !important; height:100% !important;
        }
        #dy-shell-video video{
            width:100% !important; height:100% !important;
            object-fit:contain !important;
        }
        /* 视频上的飞行弹幕容器：保持原样，仅在搬过来后让它跟随铺满。
           注意斗鱼的 .danmu-XXX className 实际是 " danmu-XXX"（前导空格），
           所以 [class^="danmu-"] 不匹配，必须用 [class*="danmu-"]。 */
        #dy-shell-video [class*="danmu-"],
        #dy-shell-video .DanmuEffectDom{
            position:absolute !important; inset:0 !important;
        }
        #dy-shell-chat{
            flex:0 0 ${CFG.CHAT_WIDTH}px;
            position:relative;
            background:#13141a;
            color:#e6e6e6;
            border-left:1px solid #1f2127;
            display:flex; flex-direction:column;
        }

        /* 状态条 */
        #dy-shell-status{
            position:absolute; top:8px; right:8px;
            background:rgba(0,0,0,0.55); color:#ccc;
            font-size:11px; padding:4px 9px; border-radius:3px;
            pointer-events:none; z-index:10;
            font-family:ui-monospace,Menlo,monospace;
            opacity:0; transition:opacity 0.2s;
        }
        #dy-shell-video:hover #dy-shell-status,
        #dy-shell-status.dy-show{ opacity:1; }
        #dy-shell-status .dy-status-dot{ color:#27c93f; margin-right:4px; }
        #dy-shell-status.dy-offline .dy-status-dot{ color:#ff5252; }
        #dy-shell-status .dy-status-lag{ color:#8a93a0; margin-left:6px; }

        /* ChatPanel —— v1.5 沿用 */
        #dy-chat-panel{
            position:absolute !important; inset:0 !important;
            display:flex; flex-direction:column;
            background:#13141a; color:#e6e6e6;
        }
        #dy-chat-header{
            flex:0 0 auto; padding:8px 12px; font-size:12px; color:#6b7077;
            border-bottom:1px solid #1f2127;
            display:flex; justify-content:space-between; align-items:center;
            letter-spacing:0.5px;
        }
        #dy-chat-header .dy-chat-status{
            display:inline-block; width:6px; height:6px; border-radius:50%;
            background:#27c93f; margin-right:6px; vertical-align:middle;
        }
        #dy-chat-list{
            flex:1 1 auto; min-height:0;
            overflow-y:auto; overflow-x:hidden;
            padding:6px 0;
        }
        #dy-chat-list::-webkit-scrollbar{ width:6px; }
        #dy-chat-list::-webkit-scrollbar-track{ background:transparent; }
        #dy-chat-list::-webkit-scrollbar-thumb{ background:#2a2c33; border-radius:3px; }
        #dy-chat-list::-webkit-scrollbar-thumb:hover{ background:#3a3d45; }
        .dy-msg{ padding:3px 12px; line-height:1.5; font-size:13px; word-break:break-word; }
        .dy-msg:hover{ background:#1a1c22; }
        .dy-msg-nick{ color:#8a93a0; margin-right:6px; font-weight:500; }
        .dy-msg-nick::after{ content:":"; color:#555a63; margin-left:2px; }
        .dy-msg-text{ color:#e6e6e6; }
        .dy-msg-self{ background:#1a2330; border-left:2px solid #4a90e2; padding-left:10px; }
        .dy-msg-system{
            color:#6b7077; font-size:12px; font-style:italic;
            padding:4px 12px; background:#16181d; border-left:2px solid #5a5d68;
        }
        .dy-msg-system .dy-msg-nick{ display:none; }
        #dy-chat-jumpbtn{
            position:absolute; right:14px; bottom:78px;
            background:#4a90e2; color:#fff; border:none; border-radius:14px;
            font-size:12px; padding:5px 12px; cursor:pointer;
            box-shadow:0 2px 8px rgba(0,0,0,0.4);
            display:none; z-index:6;
        }
        #dy-chat-jumpbtn.dy-show{ display:block; }
        #dy-chat-jumpbtn:hover{ background:#5fa3f0; }
        #dy-chat-inputwrap{
            flex:0 0 auto; padding:10px 12px;
            background:#181a20; border-top:1px solid #1f2127;
            display:flex; gap:8px; align-items:center;
        }
        #dy-chat-input{
            flex:1 1 auto; min-width:0;
            background:#22252c; border:1px solid #2c2f36; border-radius:4px;
            color:#e6e6e6; padding:7px 10px; font-size:13px; outline:none;
            font-family:inherit;
        }
        #dy-chat-input:focus{ border-color:#4a90e2; }
        #dy-chat-input::placeholder{ color:#4a4d54; }
        #dy-chat-send{
            flex:0 0 auto; background:#ff7700; color:#fff;
            border:none; border-radius:4px; padding:7px 16px; font-size:13px; cursor:pointer;
        }
        #dy-chat-send:hover:not(:disabled){ background:#ff8b1a; }
        #dy-chat-send:disabled{ background:#3a3d45; cursor:not-allowed; }
        #dy-chat-toast{
            position:absolute; top:50px; left:50%; transform:translateX(-50%);
            background:rgba(0,0,0,0.85); color:#fff;
            padding:6px 14px; border-radius:4px; font-size:12px;
            opacity:0; transition:opacity 0.2s; pointer-events:none; z-index:7;
        }
        #dy-chat-toast.dy-show{ opacity:1; }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'douyu-cleaner-style';
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);

    /* ================================================================
     * § 4. 工具
     * ================================================================ */
    const waitFor = (sel, timeoutMs = 30000) => new Promise(resolve => {
        const found = document.querySelector(sel);
        if (found) return resolve(found);
        const start = Date.now();
        const ob = new MutationObserver(() => {
            const el = document.querySelector(sel);
            if (el) { ob.disconnect(); resolve(el); }
            else if (Date.now() - start > timeoutMs) { ob.disconnect(); resolve(null); }
        });
        ob.observe(document.documentElement, { childList: true, subtree: true });
    });
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    // 直播间路径：/<digits-or-letters>，排除 /directory /topic /search /user 等
    const isLiveRoomUrl = () => /^\/[A-Za-z0-9_-]+\/?$/.test(location.pathname)
        && !/^\/(directory|topic|search|user|cate|category|topic|gold|rank|cps|api|topic|game)/i.test(location.pathname);

    /* ================================================================
     * § 5. 弹幕条目解析（v1.5 沿用）
     * ================================================================ */
    const NICK_COLORS = {
        red: '#ff5252', orange: '#ffa726', yellow: '#ffd54f',
        green: '#66bb6a', blue: '#7eb6ff', purple: '#ba68c8',
        pink: '#f48fb1', cyan: '#4dd0e1'
    };
    const CONTENT_COLORS = {
        '0': '#e6e6e6', '1': '#ff5252', '2': '#7eb6ff', '3': '#81c784',
        '4': '#ba68c8', '5': '#ffd54f', '6': '#4dd0e1'
    };
    const parseListItem = (li) => {
        const warning = li.querySelector('.Barrage-message--warning');
        if (warning) return { type: 'system', text: warning.textContent.trim() };
        const lines = li.querySelectorAll('.Barrage-line');
        if (lines.length) {
            const parts = [];
            lines.forEach(line => {
                const label = line.querySelector('.Barrage-label');
                const content = line.querySelector('.Barrage-content');
                if (label && content) parts.push(`${label.textContent.trim()}：${content.textContent.trim()}`);
            });
            return { type: 'system', text: parts.join('  /  ') };
        }
        const nickEl = li.querySelector('.Barrage-nickName.js-nick:not(.is-colon)');
        const contentEl = li.querySelector('.Barrage-content');
        if (!nickEl || !contentEl) return null;
        const nickCls = nickEl.getAttribute('class') || '';
        const contentCls = contentEl.getAttribute('class') || '';
        let nickColor = '#8a93a0';
        const nickModifier = nickCls.match(/Barrage-nickName--(\w+)/);
        if (nickModifier && NICK_COLORS[nickModifier[1]]) nickColor = NICK_COLORS[nickModifier[1]];
        let textColor = '#e6e6e6';
        const colorMatch = contentCls.match(/Barrage-content--color(\d)/);
        if (colorMatch && CONTENT_COLORS[colorMatch[1]]) textColor = CONTENT_COLORS[colorMatch[1]];
        return {
            type: 'normal',
            nick: nickEl.textContent.trim(),
            text: contentEl.textContent.trim(),
            nickColor, textColor
        };
    };

    /* ================================================================
     * § 6. ChatPanel
     * ================================================================ */
    class ChatPanel {
        constructor(host) {
            this.host = host;
            this.stickToBottom = true;
            this.unreadCount = 0;
            this.lastUserSentText = null;
            this.boundList = null;
            this.listOb = null;
            this._build();
            this._bindEvents();
        }
        _build() {
            const root = document.createElement('div');
            root.id = 'dy-chat-panel';
            root.innerHTML = `
                <div id="dy-chat-header">
                    <span><span class="dy-chat-status"></span>纯净评论</span>
                    <span id="dy-chat-counter">0</span>
                </div>
                <div id="dy-chat-list"></div>
                <button id="dy-chat-jumpbtn">↓ 新消息</button>
                <div id="dy-chat-inputwrap">
                    <input id="dy-chat-input" type="text" placeholder="说点什么…" maxlength="60" />
                    <button id="dy-chat-send">发送</button>
                </div>
                <div id="dy-chat-toast"></div>
            `;
            this.host.appendChild(root);
            this.root = root;
            this.listEl = root.querySelector('#dy-chat-list');
            this.inputEl = root.querySelector('#dy-chat-input');
            this.sendBtn = root.querySelector('#dy-chat-send');
            this.jumpBtn = root.querySelector('#dy-chat-jumpbtn');
            this.counterEl = root.querySelector('#dy-chat-counter');
            this.toastEl = root.querySelector('#dy-chat-toast');
        }
        _bindEvents() {
            this.listEl.addEventListener('scroll', () => {
                const el = this.listEl;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < CFG.NEAR_BOTTOM_PX;
                this.stickToBottom = atBottom;
                if (atBottom) {
                    this.unreadCount = 0;
                    this.jumpBtn.classList.remove('dy-show');
                    this.jumpBtn.textContent = '↓ 新消息';
                }
            });
            this.jumpBtn.addEventListener('click', () => this._scrollToBottom());
            const trySend = () => {
                const txt = this.inputEl.value.trim();
                if (!txt) return;
                this.send(txt);
            };
            this.sendBtn.addEventListener('click', trySend);
            this.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
                    e.preventDefault();
                    trySend();
                }
            });
        }
        _scrollToBottom() {
            this.listEl.scrollTop = this.listEl.scrollHeight;
            this.stickToBottom = true;
            this.unreadCount = 0;
            this.jumpBtn.classList.remove('dy-show');
        }
        _toast(msg, ms = 1600) {
            this.toastEl.textContent = msg;
            this.toastEl.classList.add('dy-show');
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => this.toastEl.classList.remove('dy-show'), ms);
        }
        addMessage(parsed) {
            if (!parsed) return;
            const div = document.createElement('div');
            if (parsed.type === 'system') {
                div.className = 'dy-msg dy-msg-system';
                div.textContent = parsed.text;
            } else {
                const isSelf = this.lastUserSentText && parsed.text === this.lastUserSentText;
                if (isSelf) this.lastUserSentText = null;
                div.className = isSelf ? 'dy-msg dy-msg-self' : 'dy-msg';
                div.innerHTML = `<span class="dy-msg-nick" style="color:${parsed.nickColor}">${escapeHtml(parsed.nick)}</span><span class="dy-msg-text" style="color:${parsed.textColor}">${escapeHtml(parsed.text)}</span>`;
            }
            this.listEl.appendChild(div);
            while (this.listEl.children.length > CFG.MAX_MESSAGES) {
                this.listEl.removeChild(this.listEl.firstChild);
            }
            if (this.stickToBottom) {
                this._scrollToBottom();
            } else {
                this.unreadCount++;
                this.jumpBtn.textContent = `↓ ${this.unreadCount} 条新消息`;
                this.jumpBtn.classList.add('dy-show');
            }
            this.counterEl.textContent = this.listEl.children.length;
        }
        bindBarrageList(list) {
            if (!list || this.boundList === list) return;
            if (this.listOb) this.listOb.disconnect();
            this.boundList = list;
            list.querySelectorAll('.Barrage-listItem').forEach(li => {
                this.addMessage(parseListItem(li));
            });
            this.listOb = new MutationObserver(mutations => {
                for (const m of mutations) {
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1 && n.classList && n.classList.contains('Barrage-listItem')) {
                            this.addMessage(parseListItem(n));
                        }
                    }
                }
            });
            this.listOb.observe(list, { childList: true });
        }
        send(text) {
            const native = document.querySelector(CFG.SEL_CHAT_INPUT);
            const btn = document.querySelector(CFG.SEL_CHAT_SEND);
            if (!native || !btn) { this._toast('找不到原生输入框'); return; }
            if (btn.hasAttribute('disabled')) { this._toast('未登录 / 禁言 / 冷却'); return; }
            try {
                native.focus();
                const sel = window.getSelection();
                sel.removeAllRanges();
                const r = document.createRange();
                r.selectNodeContents(native);
                sel.addRange(r);
                const ok = document.execCommand('insertText', false, text);
                if (!ok) {
                    native.textContent = text;
                    native.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
                }
                this.lastUserSentText = text;
                setTimeout(() => {
                    btn.click();
                    this.inputEl.value = '';
                    this.inputEl.focus();
                }, 80);
            } catch (e) {
                this._toast('发送失败：' + (e.message || e));
            }
        }
        destroy() {
            if (this.listOb) this.listOb.disconnect();
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
        }
    }

    /* ================================================================
     * § 7. Shell
     * ================================================================ */
    let shell = null;
    let chat = null;
    let originalPlayerParent = null;
    let originalPlayerNext = null;
    let latencyTimer = null;

    const buildShell = () => {
        if (document.getElementById('dy-shell')) return;
        const root = document.createElement('div');
        root.id = 'dy-shell';
        root.innerHTML = `
            <div id="dy-shell-video">
                <div id="dy-shell-status">
                    <span class="dy-status-dot">●</span><span class="dy-status-text">等待</span><span class="dy-status-lag"></span>
                </div>
            </div>
            <div id="dy-shell-chat"></div>
        `;
        document.body.appendChild(root);
        shell = {
            root,
            videoHost: root.querySelector('#dy-shell-video'),
            chatHost: root.querySelector('#dy-shell-chat'),
            statusEl: root.querySelector('#dy-shell-status'),
        };
    };

    const setStatus = (txt, lagSec, offline = false) => {
        if (!shell) return;
        const t = shell.statusEl.querySelector('.dy-status-text');
        const l = shell.statusEl.querySelector('.dy-status-lag');
        if (t) t.textContent = txt;
        if (l) l.textContent = (lagSec != null && isFinite(lagSec)) ? `lag ${lagSec.toFixed(2)}s` : '';
        shell.statusEl.classList.toggle('dy-offline', !!offline);
    };

    /* ================================================================
     * § 8. Player reparent
     * ================================================================ */
    const movePlayerIntoShell = async () => {
        const caseEl = await waitFor(CFG.SEL_PLAYER_CASE, 30000);
        if (!caseEl || !shell) return false;
        if (caseEl.parentElement === shell.videoHost) return true;
        originalPlayerParent = caseEl.parentElement;
        originalPlayerNext = caseEl.nextSibling;
        shell.videoHost.appendChild(caseEl);
        return true;
    };

    /* ================================================================
     * § 9. 自动最高画质
     * ================================================================ */
    const pickHighestQuality = async () => {
        const rate = await waitFor(CFG.SEL_RATE, 20000);
        if (!rate) return false;
        // 选中态：观测到斗鱼用 selected-XXXX（hash 后缀）。也兼容旧版的 is-active / is-selected。
        const isActive = (el) => /(^|\s)(selected|active|is-active|is-selected)[-_\s]/.test(' ' + (el.className || '').toString() + ' ');
        const tryClick = () => {
            const items = Array.from(rate.querySelectorAll('li'));
            if (!items.length) return false;
            for (const q of CFG.QUALITY_PRIORITY) {
                const item = items.find(li => {
                    const t = (li.textContent || '').trim();
                    return t === q || t.startsWith(q);
                });
                if (item) {
                    if (isActive(item)) return true;
                    item.click();
                    return true;
                }
            }
            return false;
        };
        if (tryClick()) return true;
        return new Promise(resolve => {
            let tries = 0;
            const tid = setInterval(() => {
                const ok = tryClick();
                tries++;
                if (ok || tries > 6) { clearInterval(tid); resolve(ok); }
            }, 1500);
        });
    };

    /* ================================================================
     * § 10. 低延迟（currentTime 硬跳）
     * ================================================================ */
    const startLatencyChase = () => {
        if (latencyTimer) clearInterval(latencyTimer);
        latencyTimer = setInterval(() => {
            const v = document.querySelector('video');
            if (!v) { setStatus('未找到视频', null, true); return; }
            if (v.paused) { setStatus('已暂停', null); return; }
            if (!v.buffered.length) { setStatus('缓冲中', null); return; }
            const end = v.buffered.end(v.buffered.length - 1);
            const lag = end - v.currentTime;
            if (lag > CFG.LATENCY_THRESHOLD) {
                v.currentTime = end - CFG.LATENCY_TARGET;
                setStatus('实时（已追帧）', CFG.LATENCY_TARGET);
            } else if (lag < 0) {
                setStatus('追赶中', null);
            } else {
                setStatus('实时', lag);
            }
        }, CFG.LATENCY_CHECK_MS);
    };
    const stopLatencyChase = () => {
        if (latencyTimer) { clearInterval(latencyTimer); latencyTimer = null; }
    };

    /* ================================================================
     * § 11. 弹幕绑定
     * ================================================================ */
    const bindChat = async () => {
        if (!chat) return;
        const list = await waitFor(CFG.SEL_BARRAGE, 30000);
        if (list) chat.bindBarrageList(list);
    };

    /* ================================================================
     * § 12. 挂载 / 卸载 / 重挂
     * ================================================================ */
    const mount = async () => {
        if (!isLiveRoomUrl()) return;
        if (document.getElementById('dy-shell')) return;
        buildShell();
        chat = new ChatPanel(shell.chatHost);
        await movePlayerIntoShell();
        bindChat();
        pickHighestQuality();
        startLatencyChase();
        console.log('[Douyu Cleaner] v2.0 shell mounted');
    };
    const unmount = () => {
        stopLatencyChase();
        const caseEl = document.querySelector(CFG.SEL_PLAYER_CASE);
        if (caseEl && originalPlayerParent && originalPlayerParent.isConnected) {
            try { originalPlayerParent.insertBefore(caseEl, originalPlayerNext); }
            catch (e) { /* 原位置已变 */ }
        }
        originalPlayerParent = null;
        originalPlayerNext = null;
        if (chat) { chat.destroy(); chat = null; }
        if (shell && shell.root) shell.root.remove();
        shell = null;
    };
    const remount = async () => {
        unmount();
        await new Promise(r => setTimeout(r, 1200));
        await mount();
        // 房间切换后 Barrage-list 会被重建，循环重绑
        const tryRebind = (tries = 0) => {
            if (!chat) return;
            const list = document.querySelector(CFG.SEL_BARRAGE);
            if (list && list !== chat.boundList) { chat.bindBarrageList(list); return; }
            if (tries < 15) setTimeout(() => tryRebind(tries + 1), 800);
        };
        setTimeout(() => tryRebind(0), 1500);
    };

    /* ================================================================
     * § 13. SPA 监听
     * ================================================================ */
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            if (isLiveRoomUrl()) remount();
            else unmount();
        }
    }, 800);
    setInterval(() => {
        if (!chat) return;
        const list = document.querySelector(CFG.SEL_BARRAGE);
        if (list && list !== chat.boundList) chat.bindBarrageList(list);
    }, 4000);

    /* ================================================================
     * § 14. 广告动态清理 + XHR/fetch 拦截（v1.5 沿用）
     * ================================================================ */
    const keywordRe = /(advert|Advert|ScreenBanner|FishballTreasure|TreasureEntrance|InteractABAd|RoomRecom|Recommend|Promotion|SignIn|TaskCenter|Lottery|ActivityItem|FloatLayout|roomSmallPlayerFloat|Coupon|ShopKeeper|WearMedal|GiftInfoPanel-banner|AdvancedGiftBanner|Business|activeItem__|activeBar__|Recharge|BigRewards|SupplyStation|SupremeRight|CreateCenter|ChatRank|DiamondsFansRank|RankTips|PubgGamePropShop|ActBase-bar|ActBase-switch|ActRotation|Header-download|Header-taskentry|taskScoreEntry|TaskEntryPanel|CPSDialog|AnchorUpDialog|ToolbarGiftCard|ToolbarGiftArea|PlayerToolbar-Task|DiamondsFansEnter|AnchorGachaEntrance|NobleToolbarEnter|VRankEntrance|wm-pc-room-DropMenu|wm-pc-room-button|XinghaiAd)/;
    const clean = (root) => {
        if (!root || root.nodeType !== 1) return;
        const cls = root.getAttribute && root.getAttribute('class');
        if (!cls || cls.length > 250) return;
        if (keywordRe.test(cls)) root.style.setProperty('display', 'none', 'important');
    };
    const cleanOb = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const n of m.addedNodes) clean(n);
        }
    });
    const startCleanOb = () => {
        cleanOb.observe(document.documentElement, { childList: true, subtree: true });
        if (document.body) document.body.querySelectorAll('[class]').forEach(clean);
    };
    if (document.body) startCleanOb();
    else document.addEventListener('DOMContentLoaded', startCleanOb);

    const blockUrlRe = /(\/advert\/|\/ad\/|adsrc|advertise|pos_ad|launchad|\/promotion\/|\/screenAd|tongji|hm\.baidu|cnzz|RechargeBigRewards|supplystation|PubgGamePropShop|ActRotation)/i;
    const EMPTY_JSON_URL = 'data:application/json,%7B%7D';
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (typeof url === 'string' && blockUrlRe.test(url)) url = EMPTY_JSON_URL;
        return _open.call(this, method, url, ...rest);
    };
    const _fetch = window.fetch;
    window.fetch = function (input, init) {
        try {
            const u = typeof input === 'string' ? input : (input && input.url) || '';
            if (blockUrlRe.test(u)) {
                return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
            }
        } catch (e) { }
        return _fetch.apply(this, arguments);
    };

    /* ================================================================
     * § 15. 启动
     * ================================================================ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    console.log('[Douyu Cleaner] v2.0.0 已加载');
})();
