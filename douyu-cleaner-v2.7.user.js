// ==UserScript==
// @name         斗鱼直播间清洁版
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      2.7.0
// @description  v1.5 的稳妥路线：不动播放器/不 reparent 任何原生组件，只做 ① 广告/活动/特效屏蔽 ② 替换右侧评论区为极简版 ③ 自动选最高画质 ④ 客户端追帧降延迟。播放器、弹幕、画质设置、音量、全屏 等全部走原生。
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  v2.7 设计反思（从 v2.0~v2.6 折返）：
    - v2.0~v2.6 尝试 reparent #js-player-video-case 实现"网页全屏"形态，但斗鱼播放器
      用 React 15/16，弹幕容器有 state-driven 的 hidden- modifier（与流状态联动），
      reparent 后 state 流转有时让弹幕容器永久 hidden。
    - 同样 reparent showdanmuWrap 也会让 wrap 被 React 标 removed- 失效。
    - 综合 5 个版本的实测教训：**任何对原生 React 子树做 reparent / inline style 强制覆盖
      的方案都会跟 React state 冲突**。最稳的方案是 v1.5 那种"原生页面原样保留，
      只替换可见层"。
  v2.7 在 v1.5 的基础上叠加了两个**不动 DOM**的辅助：
    - § 10 自动最高画质：点击 [class^="rate-"] 列表内第一项 <li>（事件触发即可，
      不修改 DOM）
    - § 11 客户端追帧：监听 <video>.buffered.end - currentTime，超阈值就硬跳 currentTime
      —— 这是 video 元素层属性，不碰 React。
  其他 v2.x 引入的功能（shell / controlbar / 折叠 / 控件按钮 / 弹幕设置 / 真全屏 /
  快捷键）全部**放弃**。用户用斗鱼原生 controlbar 处理这些。
*/

(function () {
    'use strict';

    /* 防御：清掉前一个 v2.0~v2.6 可能遗留的 shell/panel 节点 */
    document.querySelectorAll('#dy-shell, #dy-chat-panel').forEach(el => {
        try { el.remove(); } catch (e) { /* noop */ }
    });

    /* ============================================================
     * 1. 广告 / 活动 / 充值 / 特效 屏蔽（v1.5 沿用）
     * ============================================================ */
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

    /* ============================================================
     * 2. 自定义评论区 — 颜色映射（v1.5 沿用）
     * ============================================================ */
    const NICK_COLORS = {
        red: '#ff5252', orange: '#ffa726', yellow: '#ffd54f',
        green: '#66bb6a', blue: '#7eb6ff', purple: '#ba68c8',
        pink: '#f48fb1', cyan: '#4dd0e1'
    };
    const CONTENT_COLORS = {
        '0': '#e6e6e6', '1': '#ff5252', '2': '#7eb6ff', '3': '#81c784',
        '4': '#ba68c8', '5': '#ffd54f', '6': '#4dd0e1'
    };
    const MAX_MESSAGES = 200;
    const NEAR_BOTTOM_PX = 24;

    /* ============================================================
     * 3. CSS 注入（v1.5 沿用：仅替换右侧 panel，不动主版面）
     * ============================================================ */
    const css = `
        ${adHideSelectors.join(',')}{ display:none !important; }

        /* 隐藏原生右侧整套（保留 DOM，让 React 继续跑） */
        #js-player-asideMain > .layout-Player-asideMainTop,
        #js-player-asideMain > .layout-Player-chat,
        #js-player-asideMain > .layout-Player-userCard {
            visibility: hidden !important;
        }
        #js-player-asideMain {
            position: relative !important;
        }

        /* 自定义评论区 */
        #dy-chat-panel{
            position: absolute !important;
            inset: 0 !important;
            display: flex;
            flex-direction: column;
            background: #13141a;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            z-index: 5;
            color: #e6e6e6;
        }
        #dy-chat-header{
            flex: 0 0 auto;
            padding: 8px 12px;
            font-size: 12px;
            color: #6b7077;
            border-bottom: 1px solid #1f2127;
            display: flex;
            justify-content: space-between;
            align-items: center;
            letter-spacing: 0.5px;
        }
        #dy-chat-header .dy-chat-status{
            display: inline-block;
            width: 6px; height: 6px;
            border-radius: 50%;
            background: #27c93f;
            margin-right: 6px;
            vertical-align: middle;
        }
        #dy-chat-header .dy-chat-lag{
            color: #6b7077;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            margin-left: 6px;
        }
        #dy-chat-list{
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 6px 0;
            scroll-behavior: auto;
        }
        #dy-chat-list::-webkit-scrollbar{ width: 6px; }
        #dy-chat-list::-webkit-scrollbar-track{ background: transparent; }
        #dy-chat-list::-webkit-scrollbar-thumb{ background: #2a2c33; border-radius: 3px; }
        #dy-chat-list::-webkit-scrollbar-thumb:hover{ background: #3a3d45; }

        .dy-msg{
            padding: 3px 12px;
            line-height: 1.5;
            font-size: 13px;
            word-break: break-word;
            transition: background 0.15s;
        }
        .dy-msg:hover{ background: #1a1c22; }
        .dy-msg-nick{
            color: #8a93a0;
            margin-right: 6px;
            font-weight: 500;
        }
        .dy-msg-nick::after{ content: ":"; color: #555a63; margin-left: 2px; }
        .dy-msg-text{ color: #e6e6e6; }
        .dy-msg-self{
            background: #1a2330;
            border-left: 2px solid #4a90e2;
            padding-left: 10px;
        }
        .dy-msg-system{
            color: #6b7077;
            font-size: 12px;
            font-style: italic;
            padding: 4px 12px;
            background: #16181d;
            border-left: 2px solid #5a5d68;
        }
        .dy-msg-system .dy-msg-nick{ display: none; }

        #dy-chat-jumpbtn{
            position: absolute;
            right: 14px;
            bottom: 78px;
            background: #4a90e2;
            color: #fff;
            border: none;
            border-radius: 14px;
            font-size: 12px;
            padding: 5px 12px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            display: none;
            z-index: 6;
        }
        #dy-chat-jumpbtn.dy-show{ display: block; }
        #dy-chat-jumpbtn:hover{ background: #5fa3f0; }

        #dy-chat-inputwrap{
            flex: 0 0 auto;
            padding: 10px 12px;
            background: #181a20;
            border-top: 1px solid #1f2127;
            display: flex;
            gap: 8px;
            align-items: center;
        }
        #dy-chat-input{
            flex: 1 1 auto;
            min-width: 0;
            background: #22252c;
            border: 1px solid #2c2f36;
            border-radius: 4px;
            color: #e6e6e6;
            padding: 7px 10px;
            font-size: 13px;
            outline: none;
            transition: border-color 0.15s;
            font-family: inherit;
        }
        #dy-chat-input:focus{ border-color: #4a90e2; }
        #dy-chat-input::placeholder{ color: #4a4d54; }
        #dy-chat-send{
            flex: 0 0 auto;
            background: #ff7700;
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 7px 16px;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.15s;
        }
        #dy-chat-send:hover:not(:disabled){ background: #ff8b1a; }
        #dy-chat-send:disabled{ background: #3a3d45; cursor: not-allowed; }

        #dy-chat-toast{
            position: absolute;
            top: 50px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.85);
            color: #fff;
            padding: 6px 14px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.2s;
            pointer-events: none;
            z-index: 7;
        }
        #dy-chat-toast.dy-show{ opacity: 1; }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'douyu-cleaner-style';
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);

    /* ============================================================
     * 4. 工具
     * ============================================================ */
    const waitFor = (sel, timeoutMs = 30000) => new Promise(resolve => {
        const existing = document.querySelector(sel);
        if (existing) return resolve(existing);
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

    /* ============================================================
     * 5. 弹幕条目 → 自定义消息（v1.5 沿用）
     * ============================================================ */
    const parseListItem = (li) => {
        const warning = li.querySelector('.Barrage-message--warning');
        if (warning) {
            return { type: 'system', text: warning.textContent.trim() };
        }
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
            nickColor,
            textColor
        };
    };

    /* ============================================================
     * 6. 评论面板（v1.5 沿用）
     * ============================================================ */
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
                    <span><span class="dy-chat-status"></span>纯净评论 <span class="dy-chat-lag"></span></span>
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
            this.lagEl = root.querySelector('.dy-chat-lag');
        }

        _bindEvents() {
            this.listEl.addEventListener('scroll', () => {
                const el = this.listEl;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
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

        setLag(text) {
            if (this.lagEl) this.lagEl.textContent = text || '';
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

            while (this.listEl.children.length > MAX_MESSAGES) {
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
            if (!list) return;
            if (this.boundList === list) return;
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
            const native = document.querySelector('.layout-Player-chat .ChatSend-txt');
            const btn = document.querySelector('.layout-Player-chat .ChatSend-button');
            if (!native || !btn) {
                this._toast('找不到原生输入框，刷新试试');
                return;
            }
            if (btn.hasAttribute('disabled')) {
                this._toast('发送按钮被禁用（未登录 / 禁言 / 冷却）');
                return;
            }
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

    /* ============================================================
     * 7. 挂载 / 路由重挂载
     * ============================================================ */
    let panel = null;
    let latencyTimer = null;

    const mount = async () => {
        const aside = await waitFor('#js-player-asideMain', 30000);
        if (!aside) return;
        if (document.getElementById('dy-chat-panel')) return;
        panel = new ChatPanel(aside);
        waitFor('.Barrage-list', 30000).then(list => {
            if (panel && list) panel.bindBarrageList(list);
        });
        startAutoQuality();
        startLatencyChase();
    };

    const remount = async () => {
        if (panel) { panel.destroy(); panel = null; }
        stopLatencyChase();
        await new Promise(r => setTimeout(r, 1200));
        mount();
        const tryRebind = (tries = 0) => {
            if (!panel) return;
            const list = document.querySelector('.Barrage-list');
            if (list && list !== panel.boundList) {
                panel.bindBarrageList(list);
                return;
            }
            if (tries < 15) setTimeout(() => tryRebind(tries + 1), 800);
        };
        setTimeout(() => tryRebind(0), 1500);
    };

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            remount();
        }
    }, 800);

    setInterval(() => {
        if (!panel) return;
        const list = document.querySelector('.Barrage-list');
        if (list && list !== panel.boundList) {
            panel.bindBarrageList(list);
        }
    }, 4000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    /* ============================================================
     * 8. 广告动态清理 + 资源拦截（v1.5 沿用）
     * ============================================================ */
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
        } catch (e) {}
        return _fetch.apply(this, arguments);
    };

    /* ============================================================
     * 9. ★ v2 引入：自动最高画质
     *
     * 原理：等 [class^="rate-"] 容器出现 → 按 [原画 / 2K60 / 蓝光8M ...] 优先级
     * 找到第一个匹配的 <li> → click() 触发原生 React onClick → 原生切清晰度。
     * 我们只触发 click 事件，不修改 DOM 或 React state，跟原生路径 100% 一致。
     * ============================================================ */
    const QUALITY_PRIORITY = ['原画', '2K60', '2K', '蓝光8M', '蓝光4M', '蓝光', '超清', '高清'];

    const isActive = (el) => /(^|\s)(selected|active|is-active|is-selected)[-_\s]/.test(' ' + (el.className || '').toString() + ' ');

    let qualityPickedForThisRoom = false;
    const tryPickQuality = () => {
        if (qualityPickedForThisRoom) return true;
        const rate = document.querySelector('[class^="rate-"]');
        if (!rate) return false;
        const items = Array.from(rate.querySelectorAll('li'));
        if (!items.length) return false;
        for (const q of QUALITY_PRIORITY) {
            const item = items.find(li => {
                const t = (li.textContent || '').trim();
                return t === q || t.startsWith(q);
            });
            if (item) {
                if (!isActive(item)) item.click();
                qualityPickedForThisRoom = true;
                return true;
            }
        }
        return false;
    };

    let qualityTimer = null;
    const startAutoQuality = () => {
        qualityPickedForThisRoom = false;
        if (qualityTimer) clearInterval(qualityTimer);
        let tries = 0;
        qualityTimer = setInterval(() => {
            tries++;
            if (tryPickQuality() || tries > 30) {
                clearInterval(qualityTimer);
                qualityTimer = null;
            }
        }, 1500);
    };

    /* ============================================================
     * 10. ★ v2 引入：客户端追帧（实时低延迟）
     *
     * 原理：监控 <video>.buffered.end - currentTime，超过阈值就硬跳 currentTime
     * 到 buffered.end - 0.5s。这是 <video> 元素层属性，不涉及 React 或 mpegts.js
     * 内部，且实测稳定（lag 从 2-5s 压到 0.5-1s）。
     * ============================================================ */
    const LATENCY_THRESHOLD = 3.0;
    const LATENCY_TARGET = 0.5;
    const LATENCY_CHECK_MS = 2000;

    const startLatencyChase = () => {
        if (latencyTimer) clearInterval(latencyTimer);
        latencyTimer = setInterval(() => {
            const v = document.querySelector('video');
            if (!v || v.paused || !v.buffered.length) {
                if (panel) panel.setLag('');
                return;
            }
            const end = v.buffered.end(v.buffered.length - 1);
            const lag = end - v.currentTime;
            if (lag > LATENCY_THRESHOLD) {
                v.currentTime = end - LATENCY_TARGET;
                if (panel) panel.setLag(`已追 → ${LATENCY_TARGET.toFixed(1)}s`);
            } else if (lag < 0) {
                if (panel) panel.setLag('追赶中');
            } else {
                if (panel) panel.setLag(`lag ${lag.toFixed(1)}s`);
            }
        }, LATENCY_CHECK_MS);
    };
    const stopLatencyChase = () => {
        if (latencyTimer) { clearInterval(latencyTimer); latencyTimer = null; }
    };

    console.log('[Douyu Cleaner] v2.7.0 已加载（回归 v1.5 路线 + 自动画质 + 追帧）');
})();
