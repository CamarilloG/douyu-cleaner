// ==UserScript==
// @name         斗鱼直播间去广告 + 自定义评论区
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      1.5.1
// @description  屏蔽斗鱼直播间广告/活动浮窗/充值弹窗；用自定义评论区替换原生右侧弹幕区，仅保留滚动消息 + 输入发送，无入场动画、无礼物特效、无贵族横幅
//
// v1.5.1 修复：v1.5 误把 .has-match-center 当独立元素加进黑名单，但它实际是 .Header-wrap 的 modifier class，
//             导致整个顶部导航栏（首页/直播/分类/赛事/游戏/鱼吧 + 搜索 + 用户区）被一并屏蔽。已移除。
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  v1.5 实现思路（方案 A：DOM 镜像 + 原生发送）：
  - 不解 WebSocket 二进制协议，让原生弹幕逻辑在 visibility:hidden 的容器内继续跑
  - MutationObserver 监听 .Barrage-list 的子节点新增 → 提取昵称/内容/颜色 → 渲染到自定义 panel
  - 自定义输入框拿到回车 → execCommand 写入原生 .ChatSend-txt（contenteditable）→ click 原生 .ChatSend-button
  - 发送成功后斗鱼会把这条弹幕回推到 .Barrage-list，因此自己发送的内容也会回到镜像里（与他人弹幕一致）

  保留 v1.4 的广告屏蔽 + XHR/fetch 拦截 + MutationObserver 动态清理
*/

(function () {
    'use strict';

    /* ============================================================
     * 1. 广告 / 活动 / 充值 / 特效 屏蔽（继承 v1.4）
     * ============================================================ */
    const adHideSelectors = [
        // 顶部横幅 / 屏幕广告
        '.ScreenBannerAd', '.banner__aJxj6', '.advert__J8F6s', '.DropMenuList-ad',
        '[class*="ScreenBannerAd"]', '[class*="advert__"]', '[class*="-advert"]',
        '[class*="Advert"]', '[class*="-Ad-"]', '[class^="ad-"]', '[class*=" ad-"]',
        // 直播间内"多舞台/多视角"切换条（注意：.has-match-center 是 .Header-wrap 的 modifier，
        // 加它会把整个顶部导航栏干掉，已移除）
        '[class*="wm-pc-room-DropMenu"]', '[class*="wm-pc-room-button"]',
        // 顶部右侧扩展入口
        '.SupremeRightHeader', '[class*="SupremeRight"]',
        '.CreateCenter', '[class*="CreateCenter"]', '.Header-createcenter-wrap',
        '.Header-download-wrap',
        '[class*="Download-panel"]', '[class*="Download-pcClient"]',
        '[class*="Download-mobile"]', '[class*="Download-list"]',
        '.Header-taskentry-wrap',
        '[class*="taskScoreEntry"]', '[class*="TaskEntryPanel"]',
        // 左上活动入口
        '.activeItem__d6uUm',
        '[class*="activeItem__"]', '[class*="activeBar__"]', '[class*="activeContainer__"]',
        // 充值悬浮
        '.RechargeBigRewards',
        '[class*="RechargeBigRewards"]', '[class*="Recharge"]', '[class*="recharge"]',
        '[class*="BigRewards"]', '[class*="SupplyStation"]', '[class*="supplyStation"]',
        '[class*="GiftRoll"]', '[class*="gameAd"]',
        // 右侧通用活动浮窗框架
        '[class*="PubgGamePropShop"]',
        '[class*="ActBase"].is-show',
        '[class*="ActBase-bar"]', '[class*="ActBase-switch"]', '[class*="ActBase-Pendant"]',
        '[class*="ActRotation"]',
        // 在线榜 / 钻粉
        '.layout-Player-rankAll', '.layout-Player-rank', '.ChatRank',
        '[class*="DiamondsFansRank"]', '[class*="RankTips"]', '[class*="ChatTabContainer"]',
        // 鱼丸宝箱 / 签到 / 任务 / 抽奖
        '.FishballTreasure', '.TreasureEntrance',
        '.LotteryContainer-svgaWrap', '.LotteryContainer-svgaDes', '.AnchorDrawLottery',
        '[class*="SignIn"]', '[class*="signin"]',
        '[class*="TaskCenter"]', '[class*="ActivityItem"]',
        '[class*="Lottery"]', '[class*="Coupon"]',
        '[class*="ShopKeeper"]', '[class*="WearMedal"]', '[class*="Backpack-newPropTip"]',
        // CPS / 主播上播对话框
        '[class*="CPSDialog"]', '[class*="AnchorUpDialog"]',
        // 礼物面板 / 互动广告
        '.GiftInfoPanel-banner', '.GiftInfoPanel-bannerContainer',
        '[class*="GiftInfoPanel-banner"]', '.AdvancedGiftBanner',
        '[class*="InteractABAd"]',
        '[class*="Promotion"]', '[class*="Business"]',
        '[class*="RecomBox"]', '[class*="RoomRecom"]', '[class*="recommend-"]',
        '[class*="RoomVipList"]',
        // 工具栏礼物轮播 / 工具栏额外卡片
        '[class*="ToolbarGiftCard"]', '[class*="ToolbarGiftArea"]',
        '[class*="PlayerToolbar-Task"]',
        // 弹幕区入口按钮
        '[class*="DiamondsFansEnter"]', '[class*="AnchorGachaEntrance"]',
        '[class*="NobleToolbarEnter"]', '[class*="VRankEntrance"]',
        // 小窗 / 悬浮播放器
        '.roomSmallPlayerFloatLayout',
        '[class*="FloatLayout"]', '[class*="float-ad"]'
    ];

    /* ============================================================
     * 2. 自定义评论区 — 颜色映射
     * ============================================================ */
    const NICK_COLORS = {
        red: '#ff5252', orange: '#ffa726', yellow: '#ffd54f',
        green: '#66bb6a', blue: '#7eb6ff', purple: '#ba68c8',
        pink: '#f48fb1', cyan: '#4dd0e1'
    };
    const CONTENT_COLORS = {
        '0': '#e6e6e6', // 默认
        '1': '#ff5252', // 红
        '2': '#7eb6ff', // 蓝
        '3': '#81c784', // 绿
        '4': '#ba68c8', // 紫
        '5': '#ffd54f', // 黄
        '6': '#4dd0e1'  // 青
    };
    const MAX_MESSAGES = 200;
    const NEAR_BOTTOM_PX = 24;

    /* ============================================================
     * 3. 注入 CSS
     * ============================================================ */
    const css = `
        ${adHideSelectors.join(',')}{ display:none !important; }

        /* —— 隐藏原生右侧整套（保留 DOM，让 React 继续跑） —— */
        #js-player-asideMain > .layout-Player-asideMainTop,
        #js-player-asideMain > .layout-Player-chat,
        #js-player-asideMain > .layout-Player-userCard {
            visibility: hidden !important;
        }
        #js-player-asideMain {
            position: relative !important;
        }

        /* —— 自定义评论区 —— */
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
     * 4. 工具函数
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
     * 5. 弹幕条目 → 自定义消息
     * ============================================================ */
    const parseListItem = (li) => {
        // 系统/欢迎消息：仅有 .Barrage-text 或 .Barrage-message--warning
        const warning = li.querySelector('.Barrage-message--warning');
        if (warning) {
            return { type: 'system', text: warning.textContent.trim() };
        }
        // 信息卡（主播/标题/公告）
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
        // 普通弹幕
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
     * 6. 自定义评论区控制器
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

            // 修剪
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
            // 把已有的镜像进去
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
                // 全选既有内容
                const sel = window.getSelection();
                sel.removeAllRanges();
                const r = document.createRange();
                r.selectNodeContents(native);
                sel.addRange(r);
                // 写入文本（execCommand 会触发 input 事件，让 React 同步状态）
                const ok = document.execCommand('insertText', false, text);
                if (!ok) {
                    // fallback: 直接赋值 + dispatch
                    native.textContent = text;
                    native.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
                }
                this.lastUserSentText = text;
                // 给 React 一点时间同步状态
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

    const mount = async () => {
        const aside = await waitFor('#js-player-asideMain', 30000);
        if (!aside) return;
        if (document.getElementById('dy-chat-panel')) return;
        panel = new ChatPanel(aside);
        // 等 .Barrage-list 出现并绑定
        waitFor('.Barrage-list', 30000).then(list => {
            if (panel && list) panel.bindBarrageList(list);
        });
    };

    const remount = async () => {
        if (panel) { panel.destroy(); panel = null; }
        // 等斗鱼新房间重建完
        await new Promise(r => setTimeout(r, 1200));
        mount();
        // 房间切换后 .Barrage-list 可能重新生成，循环尝试重绑
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

    // SPA 路由检测
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            remount();
        }
    }, 800);

    // .Barrage-list 在房间内有时也会被斗鱼整体替换（断流/重连），周期性确认绑定的还是当前的
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
     * 8. 广告动态清理 + 资源拦截（v1.4 保留）
     * ============================================================ */
    const keywordRe = /(advert|Advert|ScreenBanner|FishballTreasure|TreasureEntrance|InteractABAd|RoomRecom|Recommend|Promotion|SignIn|TaskCenter|Lottery|ActivityItem|FloatLayout|roomSmallPlayerFloat|Coupon|ShopKeeper|WearMedal|GiftInfoPanel-banner|AdvancedGiftBanner|Business|activeItem__|activeBar__|Recharge|BigRewards|SupplyStation|SupremeRight|CreateCenter|ChatRank|DiamondsFansRank|RankTips|PubgGamePropShop|ActBase-bar|ActBase-switch|ActRotation|Header-download|Header-taskentry|taskScoreEntry|TaskEntryPanel|CPSDialog|AnchorUpDialog|ToolbarGiftCard|ToolbarGiftArea|PlayerToolbar-Task|DiamondsFansEnter|AnchorGachaEntrance|NobleToolbarEnter|VRankEntrance|wm-pc-room-DropMenu|wm-pc-room-button)/;

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

    console.log('[Douyu Cleaner] v1.5.1 已加载：修复顶部导航栏被误屏蔽 / 自定义评论区已挂载');
})();
