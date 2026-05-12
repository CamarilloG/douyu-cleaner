// ==UserScript==
// @name         斗鱼直播间极简版
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      2.11.0
// @description  彻底重写直播间前端：极简 shell（左视频 + 右弹幕）/ 自动最高画质 / 实时低延迟（硬跳追帧）/ 自定义评论区（DOM 镜像 + 原生发送转发）。保留原生 mpegts 播放器与 WebSocket，仅 reparent 与控制 <video> 属性。
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  v2.8 设计（v2.0 思路 + 从 v2.1~v2.6 教训中得出的"弹幕零干预"原则）：

    [保留 v2.0 路径]
    1) 极简 shell：position:fixed; inset:0; z-index:9999 覆盖整个原页面
    2) reparent #js-player-video-case 进 shell（视频区 + 飞行弹幕容器一起搬）
    3) 自动最高画质：点击 [class^="rate-"] 内第一项 <li>
    4) 客户端追帧：监听 video.buffered.end - currentTime，超阈值硬跳

    [v2.1 引入并保留]
    5) Controlbar（原生 SVG icon 复刻）：暂停/刷新/音量/折叠/全屏
    6) 鼠标静置 2.5s 自动隐藏 UI
    7) 折叠评论区
    8) Space/F/M 快捷键 + 双击全屏

    [v2.8 的关键减法 —— 弹幕零干预]
    × 不 reparent showdanmuWrap（v2.3-v2.6 失败：React 把 wrap 标 removed-）
    × 不自建弹幕开关按钮（用户用原生 controlbar 即可）
    × 不自建弹幕设置面板（v2.2 自建 CSS 变量驱动会让弹幕消失）
    × 不加 dy-danmu-off / dy-block-* / CSS 变量
    × loadPrefs 清洗 v2.1~v2.6 残留的脏字段
       —— 弹幕开关/设置/速度/字号/屏蔽 全部走原生 controlbar，零干预

    [保留的最小必要 CSS]
    + reparent 后 React 给 .danmu-XXX 写的 inline width/height 来自原小窗尺寸，
      容器尺寸响应有延迟。一条 inset:0 + 100%/100% CSS 强制弹幕容器跟随父级
      （仅作用于容器层，:not 排除子弹幕保留它们内部定位）
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
        UI_IDLE_HIDE_MS: 2500, // 鼠标静置多久后隐藏 UI
    };

    /* SVG icon 库（一字不漏复刻自原生斗鱼播放器 controlbar） */
    const SVG = {
        play: '<svg fill="none" viewBox="0 0 32 32"><path d="M22.603 14.352a2 2 0 010 3.296l-10.47 7.198C10.806 25.758 9 24.808 9 23.198V8.802c0-1.61 1.806-2.56 3.133-1.648l10.47 7.198z" fill="currentColor"/></svg>',
        pause: '<svg fill="none" viewBox="0 0 32 32"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.5 7A1.5 1.5 0 008 8.5v15a1.5 1.5 0 003 0v-15A1.5 1.5 0 009.5 7zm13 0A1.5 1.5 0 0021 8.5v15a1.5 1.5 0 003 0v-15A1.5 1.5 0 0022.5 7z" fill="currentColor"/></svg>',
        reload: '<svg fill="none" viewBox="0 0 32 32"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.383 9.9a9 9 0 0115.396 8.086.194.194 0 01-.33.09l-1.781-1.843M22.619 22.1a9 9 0 01-15.396-8.087.194.194 0 01.33-.088l1.781 1.841"/></g></svg>',
        volumeOn: '<svg fill="none" viewBox="0 0 32 32"><path d="M5 10h5.5L16 6v20l-5.5-4H5V10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.736 23.517a8 8 0 00-.527-15.206M19.687 19.867a3.925 3.925 0 00-.258-7.46" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        volumeMuted: '<svg fill="none" viewBox="0 0 32 32"><path d="M5 10h5.5L16 6v20l-5.5-4H5V10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 19l6-6M20 13l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        danmu: '<svg fill="none" viewBox="0 0 32 32"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 7h18v18H7z"/><path d="M11.684 14.773l-.182 1.755h2.6c0 2.236-.078 3.731-.208 4.485-.156.754-.819 1.17-2.002 1.248-.338 0-.676-.026-1.04-.052l-.351-1.261a9.39 9.39 0 001.066.065c.65 0 1.014-.208 1.105-.624.091-.416.143-1.313.143-2.691h-2.691l.364-4.082h2.197v-1.69h-2.444v-1.157h3.783v4.004h-2.34zm3.198-2.457h1.56a9.991 9.991 0 00-.975-1.612l1.235-.416c.364.52.689 1.066.962 1.664l-.819.364h1.794a16.82 16.82 0 00.962-2.132l1.287.455c-.26.624-.559 1.183-.884 1.677h1.508v5.473h-2.678v1.001h3.185v1.274h-3.185v2.327h-1.326v-2.327h-3.094V18.79h3.094v-1.001h-2.626v-5.473zm5.434 4.342v-1.014h-1.482v1.014h1.482zm-2.808 0v-1.014h-1.417v1.014h1.417zm-1.417-2.132h1.417V13.46h-1.417v1.066zm2.743-1.066v1.066h1.482V13.46h-1.482z" fill="currentColor"/></svg>',
        settings: '<svg fill="none" viewBox="0 0 32 32"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.023 14.758a.5.5 0 00.079-.499l-1.609-4.118a.5.5 0 01.648-.647l4.118 1.608a.5.5 0 00.498-.079l3.42-2.802a.5.5 0 01.816.416l-.258 4.413a.5.5 0 00.23.45l3.721 2.386a.493.493 0 01.225.492c.642.265 1.216.66 1.69 1.152.593-1.076.373-2.554-.835-3.328l-2.983-1.912.206-3.537c.127-2.175-2.395-3.46-4.08-2.079l-2.74 2.246-3.3-1.29c-2.03-.792-4.031 1.21-3.239 3.24l1.29 3.299-2.246 2.74c-1.381 1.685-.096 4.207 2.079 4.08l3.537-.206 1.912 2.983c.775 1.209 2.254 1.429 3.33.834a5.007 5.007 0 01-1.152-1.689.493.493 0 01-.495-.225L13.5 18.965a.5.5 0 00-.45-.23l-4.414.258a.5.5 0 01-.415-.816l2.802-3.42z" fill="currentColor"/><path d="M24.812 6.507a.2.2 0 01.376 0l.59 1.596a.2.2 0 00.119.119l1.596.59a.2.2 0 010 .376l-1.596.59a.2.2 0 00-.119.119l-.59 1.596a.2.2 0 01-.376 0l-.59-1.596a.2.2 0 00-.119-.119l-1.596-.59a.2.2 0 010-.376l1.596-.59a.2.2 0 00.119-.119l.59-1.596zM9.906 22.253a.1.1 0 01.188 0l.43 1.164a.1.1 0 00.06.059l1.162.43a.1.1 0 010 .188l-1.163.43a.1.1 0 00-.059.06l-.43 1.163a.1.1 0 01-.188 0l-.43-1.164a.1.1 0 00-.06-.059l-1.163-.43a.1.1 0 010-.188l1.164-.43a.1.1 0 00.059-.06l.43-1.163z" fill="currentColor"/><path d="M21 17a4 4 0 100 8 4 4 0 100-8zM19 19l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        webFullscreen: '<svg fill="none" viewBox="0 0 32 32"><path d="M20 25h6v-6M14 7H8v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 12L8 7M26 25l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        fullscreen: '<svg fill="none" viewBox="0 0 32 32"><path d="M20 25h5v-5M20 7h5v5M12 7H7v5M12 25H7v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        chevronRight: '<svg fill="none" viewBox="0 0 32 32"><path d="M14 8l8 8-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        chevronLeft: '<svg fill="none" viewBox="0 0 32 32"><path d="M18 8l-8 8 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };

    /* 用户偏好持久化（localStorage）
       弹幕开关/设置/字号/速度/屏蔽 全部交还原生 controlbar，我们不存。 */
    const PREF_KEY = 'dy-cleaner-v2-prefs';
    const DEFAULT_PREFS = {
        volume: 0.5,
        muted: false,
        chatCollapsed: false,
        danmuVisible: true,
    };
    const loadPrefs = () => {
        try {
            const raw = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
            // 清洗 v2.1~v2.6 残留的 danmuOpacity:0 等"脏值"（曾导致弹幕透明看不见）
            const clean = {};
            for (const k of Object.keys(DEFAULT_PREFS)) {
                if (k in raw) clean[k] = raw[k];
            }
            return Object.assign({}, DEFAULT_PREFS, clean);
        } catch (e) { return Object.assign({}, DEFAULT_PREFS); }
    };
    const savePrefs = (p) => {
        try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* quota */ }
    };
    let prefs = loadPrefs();

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
        /* 弹幕容器：完全不干预样式，原生 React 管。但加两条最小必要 fix： */

        /* ⭐ v2.8 核心 fix：斗鱼"isNew" A/B 版本会把弹幕父容器 .comment-XXX 加
           hidden-XXXX modifier 让 display:none。飞行弹幕子 DOM 实际存在（".danmuItem-"
           节点带弹幕文字内容）但全被父级隐藏，看起来"没弹幕"。强制 unhide。
           v2.9 升级：去掉 #dy-shell-video 限定，全局生效（防 reparent 时序未完成时漏匹配）。
           另外 v2.9 还有 JS MutationObserver 兜底直接 set inline style（防 React inline display:none）。 */
        [class*="comment-"][class*="hidden-"]:not([class*="sendComment"]):not([class*="DanmuRecharge"]){
            display: block !important;
            visibility: visible !important;
        }

        /* ⭐ v2.10：自建飞行弹幕层。
           原因：斗鱼 isNew A/B 版本根本不渲染飞行弹幕 DOM（用户实测
           danmuItemCount:0），原生层是空的。我们用 ChatPanel 已经在镜像的
           .Barrage-list 数据，自己渲染飞行字幕 + CSS animation 从右向左滚。 */
        #dy-flying-layer{
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important; height: 100% !important;
            pointer-events: none;
            overflow: hidden;
            z-index: 9;
        }
        .dy-fly-item{
            position: absolute;
            left: 0;
            white-space: nowrap;
            font-size: 22px;
            line-height: 1;
            font-weight: 500;
            color: #fff;
            text-shadow: 0 0 4px #000, 1px 1px 2px rgba(0,0,0,0.85), -1px -1px 2px rgba(0,0,0,0.85);
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            will-change: transform;
            /* 动画由 JS Web Animations API 控制（动态算 layer 宽度 + item 宽度），
               这里只设置基础样式 */
        }
        .dy-fly-item .dy-fly-nick{ margin-right: 6px; }
        /* 弹幕开关：关闭时整个自建飞行层 visibility:hidden */
        #dy-shell.dy-danmu-off #dy-flying-layer{
            visibility: hidden !important;
        }

        /* 容器层强制铺满父级（React 把 inline width/height 写死成原小窗尺寸，
           ResizeObserver 响应有几秒延迟）。:not 排除子弹幕 .danmuItem 保留它们
           的 inline 定位（否则会全部叠到 0,0）。 */
        #dy-shell-video [class*=" danmu-"]:not([class*="danmuItem"]):not([class*="showdanmu"]):not([class*="danmuModels"]):not([class*="danmuTips"]):not([class*="danmuReport"]):not([class*="sendDanmu"]):not([class*="simpleDanmu"]),
        #dy-shell-video [class^="danmu-"]:not([class*="danmuItem"]):not([class*="showdanmu"]):not([class*="danmuModels"]):not([class*="danmuTips"]):not([class*="danmuReport"]):not([class*="sendDanmu"]):not([class*="simpleDanmu"]),
        #dy-shell-video [class*="comment-"]:not([class*="sendComment"]),
        #dy-shell-video .DanmuEffectDom{
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
        }

        #dy-shell-chat{
            flex:0 0 ${CFG.CHAT_WIDTH}px;
            position:relative;
            background:#13141a;
            color:#e6e6e6;
            border-left:1px solid #1f2127;
            display:flex; flex-direction:column;
            transition: flex-basis 0.22s ease, border-left-width 0.22s;
        }
        #dy-shell.dy-chat-collapsed #dy-shell-chat{
            flex-basis: 0 !important;
            border-left-width: 0 !important;
            overflow: hidden;
        }

        /* === Controlbar：默认隐藏，dy-ui-active / settings 打开时显示 === */
        #dy-shell-controlbar{
            position:absolute;
            left:0; right:0; bottom:0;
            height:48px;
            padding:0 14px;
            display:flex; align-items:center; gap:6px;
            background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));
            opacity:0; transform: translateY(6px);
            transition: opacity 0.22s, transform 0.22s;
            pointer-events:none;
            z-index: 11;
            color:#e6e6e6;
        }
        #dy-shell.dy-ui-active #dy-shell-controlbar{
            opacity:1; transform: translateY(0);
            pointer-events:auto;
        }
        /* 鼠标静止后隐藏鼠标光标（更沉浸） */
        #dy-shell-video{ cursor: none; }
        #dy-shell.dy-ui-active #dy-shell-video{ cursor: default; }
        #dy-shell-controlbar, #dy-shell-controlbar *,
        #dy-chat-expand-btn{ cursor: default; }
        #dy-shell-controlbar .dy-btn{
            background: none; border: none; color: #e6e6e6;
            font-size: 18px; line-height: 1;
            padding: 0; cursor: pointer;
            border-radius: 4px;
            transition: background 0.15s, color 0.15s;
            width: 36px; height: 36px;
            display: inline-flex; align-items:center; justify-content:center;
        }
        #dy-shell-controlbar .dy-btn svg{
            width: 26px; height: 26px; display: block;
        }
        #dy-shell-controlbar .dy-btn:hover{ background: rgba(255,255,255,0.12); color:#fff; }
        #dy-shell-controlbar .dy-btn.dy-off{ color: rgba(255,255,255,0.4); }
        #dy-shell-controlbar .dy-spacer{ flex:1 1 auto; }
        #dy-shell-controlbar .dy-vol-wrap{
            display:flex; align-items:center; gap:6px;
        }
        #dy-shell-controlbar .dy-vol-wrap .dy-vol-slider{
            width: 0; opacity: 0;
            transition: width 0.22s, opacity 0.22s;
        }
        #dy-shell-controlbar .dy-vol-wrap:hover .dy-vol-slider,
        #dy-shell-controlbar .dy-vol-slider:focus{
            width: 80px; opacity: 1;
        }
        #dy-shell-controlbar input[type="range"]{
            -webkit-appearance: none; appearance: none;
            height: 4px; background: rgba(255,255,255,0.25); border-radius: 2px;
            outline: none; cursor: pointer;
        }
        #dy-shell-controlbar input[type="range"]::-webkit-slider-thumb{
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; border-radius: 50%; background: #fff;
            cursor: pointer;
        }

        #dy-shell-controlbar{ overflow: visible !important; }

        /* === 折叠按钮（chat panel 顶部 + shell 右上悬浮） === */
        #dy-chat-collapse-btn{
            background: none; border: none; color: #6b7077;
            cursor: pointer; padding: 2px 6px; font-size: 14px;
            border-radius: 3px;
        }
        #dy-chat-collapse-btn:hover{ color:#fff; background: rgba(255,255,255,0.08); }
        #dy-chat-collapse-btn svg{ width: 14px; height: 14px; display:block; }
        #dy-chat-expand-btn{
            position: absolute;
            right: 12px; top: 12px;
            background: rgba(0,0,0,0.55); color: #ccc;
            border: none; border-radius: 4px;
            padding: 4px 10px 4px 6px; font-size: 13px; cursor: pointer;
            display: none;
            z-index: 11;
            align-items: center; gap: 4px;
        }
        #dy-shell.dy-chat-collapsed.dy-ui-active #dy-chat-expand-btn{ display:flex; }
        #dy-chat-expand-btn svg{ width: 16px; height: 16px; display:block; }
        #dy-chat-expand-btn:hover{ background: rgba(0,0,0,0.8); color:#fff; }
        /* 折叠状态下，状态条向左让位 */
        #dy-shell.dy-chat-collapsed #dy-shell-status{ right: 90px; }

        /* 状态条 */
        #dy-shell-status{
            position:absolute; top:8px; right:8px;
            background:rgba(0,0,0,0.55); color:#ccc;
            font-size:11px; padding:4px 9px; border-radius:3px;
            pointer-events:none; z-index:10;
            font-family:ui-monospace,Menlo,monospace;
            opacity:0; transition:opacity 0.2s;
        }
        #dy-shell.dy-ui-active #dy-shell-status,
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
                    <span style="display:flex;align-items:center;gap:8px;">
                        <span id="dy-chat-counter">0</span>
                        <button id="dy-chat-collapse-btn" title="折叠评论区">${SVG.chevronRight}</button>
                    </span>
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

            // ⭐ v2.10：同步往视频上喷一条飞行弹幕
            // _suppressFly 防止 bindBarrageList 初始批量加载时一次喷 200 条
            if (!this._suppressFly) spawnFlyingDanmu(parsed);
        }
        bindBarrageList(list) {
            if (!list || this.boundList === list) return;
            if (this.listOb) this.listOb.disconnect();
            this.boundList = list;
            // 初始批量加载历史弹幕：仅镜像到 chat panel，不喷飞行
            this._suppressFly = true;
            list.querySelectorAll('.Barrage-listItem').forEach(li => {
                this.addMessage(parseListItem(li));
            });
            this._suppressFly = false;
            // 后续 MutationObserver 检测到新增的才喷飞行
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
     * § 6.5 ⭐ 自建飞行弹幕渲染（v2.10）
     *
     * 斗鱼 isNew A/B 版本根本不渲染飞行弹幕 DOM，原生 [class*="danmuItem-"]
     * 永远为 0 条。我们靠 ChatPanel 已在镜像的 .Barrage-list 数据，把每条
     * 弹幕复刻成 absolute DOM 节点，CSS animation 从右往左飞 8 秒。
     * ================================================================ */
    const FLY_LANE_COUNT = 10;       // 屏幕同时几行飞行弹幕
    const FLY_LANE_HEIGHT = 36;      // 每行高度（与字号匹配）
    const FLY_TOP_OFFSET = 8;        // 距视频区顶部
    const FLY_DURATION_SEC = 8;      // 每条弹幕飞行多少秒
    const FLY_MAX_ALIVE = 60;        // 同时最多多少条飞行弹幕
    let flyLaneCursor = 0;

    // 自适应：如果斗鱼原生在渲染飞行弹幕，我们就不重复渲染（避免双倍）。
    // 通过周期检查 [class*="danmuItem-"] 数量判断。
    let nativeIsRendering = false;
    let nativeCheckTimer = null;
    const startNativeCheck = () => {
        if (nativeCheckTimer) clearInterval(nativeCheckTimer);
        nativeCheckTimer = setInterval(() => {
            nativeIsRendering = document.querySelectorAll('[class*="danmuItem-"]').length > 0;
        }, 2000);
    };
    const stopNativeCheck = () => {
        if (nativeCheckTimer) { clearInterval(nativeCheckTimer); nativeCheckTimer = null; }
    };

    const spawnFlyingDanmu = (parsed) => {
        if (!shell || !shell.flyingLayer) return;
        if (!parsed || parsed.type !== 'normal') return;             // 系统消息不飞
        if (shell.root.classList.contains('dy-danmu-off')) return;   // 用户关了弹幕
        if (nativeIsRendering) return;                               // 斗鱼原生在渲染就不重复
        const layer = shell.flyingLayer;
        // 限流
        while (layer.children.length > FLY_MAX_ALIVE) {
            layer.removeChild(layer.firstChild);
        }
        const item = document.createElement('div');
        item.className = 'dy-fly-item';
        item.innerHTML =
            `<span class="dy-fly-nick" style="color:${parsed.nickColor}">${escapeHtml(parsed.nick)}:</span>` +
            `<span style="color:${parsed.textColor}">${escapeHtml(parsed.text)}</span>`;
        // 分配 lane（循环复用）
        const lane = flyLaneCursor;
        flyLaneCursor = (flyLaneCursor + 1) % FLY_LANE_COUNT;
        item.style.top = (FLY_TOP_OFFSET + lane * FLY_LANE_HEIGHT) + 'px';
        layer.appendChild(item);
        // 用 Web Animations API 控制：layer 全宽度起点 → item 完全出屏左侧
        // 这样比 CSS `transform: translate(100%)` 精确（100% 是自身宽度而非容器宽）
        const layerW = layer.clientWidth || window.innerWidth;
        const itemW = item.offsetWidth || 100;
        const anim = item.animate(
            [
                { transform: `translate3d(${layerW}px, 0, 0)` },
                { transform: `translate3d(${-itemW}px, 0, 0)` }
            ],
            { duration: FLY_DURATION_SEC * 1000, fill: 'forwards', easing: 'linear' }
        );
        anim.onfinish = () => item.remove();
        // 兜底（如果浏览器 tab 切到后台 animation 暂停，10s 后强制清掉）
        setTimeout(() => item.remove(), (FLY_DURATION_SEC + 2) * 1000);
    };

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
        // v2.8 起：dy-shell 直接挂 body。v2.4 因 reparent 原生 React 控件需要 React tree
        // 事件代理路径而挂到 #root，但 v2.8 不再 reparent 原生 React 控件，挂 body 即可。
        root.innerHTML = `
            <div id="dy-shell-video">
                <div id="dy-flying-layer"></div>
                <div id="dy-shell-status">
                    <span class="dy-status-dot">●</span><span class="dy-status-text">等待</span><span class="dy-status-lag"></span>
                </div>
                <button id="dy-chat-expand-btn" title="展开评论区">${SVG.chevronLeft}<span>评论</span></button>
                <div id="dy-shell-controlbar">
                    <button class="dy-btn" data-act="play" title="暂停/继续 (Space)">${SVG.play}</button>
                    <button class="dy-btn" data-act="refresh" title="刷新（追到实时）">${SVG.reload}</button>
                    <span class="dy-vol-wrap">
                        <button class="dy-btn" data-act="mute" title="静音切换">${SVG.volumeOn}</button>
                        <input class="dy-vol-slider" type="range" min="0" max="100" value="50" />
                    </span>
                    <div class="dy-spacer"></div>
                    <button class="dy-btn" data-act="danmu-toggle" title="视频弹幕开关 (D)">${SVG.danmu}</button>
                    <button class="dy-btn" data-act="collapse" title="折叠评论区">${SVG.chevronRight}</button>
                    <button class="dy-btn" data-act="fullscreen" title="全屏 (F)">${SVG.fullscreen}</button>
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
            controlbar: root.querySelector('#dy-shell-controlbar'),
            flyingLayer: root.querySelector('#dy-flying-layer'),
            expandBtn: root.querySelector('#dy-chat-expand-btn'),
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
     * § 9.5 Controls：播放器控件 + 折叠 + 弹幕设置
     * ================================================================ */
    // 把 prefs 反映到 DOM / video（仅音量 + 折叠两类）
    const applyPrefs = () => {
        if (!shell) return;
        const v = document.querySelector('video');
        // 音量
        if (v) {
            v.volume = Math.max(0, Math.min(1, prefs.volume));
            v.muted = !!prefs.muted;
        }
        const muteBtn = shell.controlbar.querySelector('[data-act="mute"]');
        if (muteBtn) muteBtn.innerHTML = (prefs.muted || prefs.volume === 0) ? SVG.volumeMuted : SVG.volumeOn;
        const volSlider = shell.controlbar.querySelector('.dy-vol-slider');
        if (volSlider) volSlider.value = String(Math.round(prefs.volume * 100));
        // 折叠状态
        shell.root.classList.toggle('dy-chat-collapsed', !!prefs.chatCollapsed);
        // 弹幕开关：dy-danmu-off class 控制 CSS visibility
        shell.root.classList.toggle('dy-danmu-off', !prefs.danmuVisible);
        const danmuBtn = shell.controlbar.querySelector('[data-act="danmu-toggle"]');
        if (danmuBtn) danmuBtn.classList.toggle('dy-off', !prefs.danmuVisible);
    };

    const setPref = (k, v) => { prefs[k] = v; savePrefs(prefs); applyPrefs(); };

    const bindControls = () => {
        if (!shell) return;
        const cb = shell.controlbar;
        const v = () => document.querySelector('video');

        // === Controlbar 按钮事件代理 ===
        cb.addEventListener('click', (e) => {
            const btn = e.target.closest('.dy-btn[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            const vid = v();
            switch (act) {
                case 'play': {
                    if (!vid) return;
                    if (vid.paused) vid.play().catch(() => {}); else vid.pause();
                    break;
                }
                case 'refresh': {
                    if (!vid || !vid.buffered.length) return;
                    vid.currentTime = vid.buffered.end(vid.buffered.length - 1) - 0.3;
                    if (vid.paused) vid.play().catch(() => {});
                    break;
                }
                case 'mute': {
                    setPref('muted', !prefs.muted);
                    break;
                }
                case 'danmu-toggle': {
                    setPref('danmuVisible', !prefs.danmuVisible);
                    break;
                }
                case 'collapse': {
                    setPref('chatCollapsed', !prefs.chatCollapsed);
                    break;
                }
                case 'fullscreen': {
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    else shell.root.requestFullscreen().catch(() => {});
                    break;
                }
            }
        });

        // play/pause icon 跟随 video 状态
        const updatePlayIcon = () => {
            const vid = v();
            const playBtn = cb.querySelector('[data-act="play"]');
            if (playBtn && vid) playBtn.innerHTML = vid.paused ? SVG.play : SVG.pause;
        };
        const vid0 = v();
        if (vid0) {
            vid0.addEventListener('play', updatePlayIcon);
            vid0.addEventListener('pause', updatePlayIcon);
            // 监听 volumechange 同步 mute 状态（兼容用户用键盘 M 静音 / 浏览器 UI）
            vid0.addEventListener('volumechange', () => {
                prefs.volume = vid0.volume;
                prefs.muted = vid0.muted;
                savePrefs(prefs);
                applyPrefs();
            });
        }
        updatePlayIcon();

        // 音量 slider
        const volSlider = cb.querySelector('.dy-vol-slider');
        if (volSlider) {
            volSlider.addEventListener('input', () => {
                const vol = (+volSlider.value) / 100;
                setPref('volume', vol);
                // 自动取消静音（用户拉动）
                if (vol > 0 && prefs.muted) setPref('muted', false);
            });
        }

        // === Shell 上的展开按钮（折叠态露出） ===
        if (shell.expandBtn) {
            shell.expandBtn.addEventListener('click', () => setPref('chatCollapsed', false));
        }

        // === 鼠标静置自动隐藏 UI ===
        let hideTimer = null;
        const scheduleHide = () => {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                if (!shell) return;
                if (cb.matches(':hover')) return;
                shell.root.classList.remove('dy-ui-active');
            }, CFG.UI_IDLE_HIDE_MS);
        };
        const showUI = () => {
            if (!shell) return;
            shell.root.classList.add('dy-ui-active');
            scheduleHide();
        };
        const hideUINow = () => {
            if (!shell) return;
            clearTimeout(hideTimer);
            shell.root.classList.remove('dy-ui-active');
        };
        shell.videoHost.addEventListener('mousemove', showUI);
        shell.videoHost.addEventListener('mouseenter', showUI);
        shell.videoHost.addEventListener('mouseleave', hideUINow);
        cb.addEventListener('mouseenter', () => { clearTimeout(hideTimer); shell.root.classList.add('dy-ui-active'); });
        cb.addEventListener('mouseleave', scheduleHide);
        // 初次挂载短暂显示提示一下 UI 存在
        showUI();

        // === 双击视频区切换全屏（避开 controlbar / 原生设置浮层 / expand 按钮） ===
        shell.videoHost.addEventListener('dblclick', (e) => {
            if (e.target.closest('#dy-shell-controlbar, #dy-chat-expand-btn')) return;
            if (e.target.closest('[class*="setting-"]')) return;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else shell.root.requestFullscreen().catch(() => {});
        });

        // === 键盘快捷键（在 input/textarea/contenteditable 时不响应） ===
        if (!window.__dyV2Keys) {
            window.__dyV2Keys = true;
            document.addEventListener('keydown', (e) => {
                if (!shell) return;
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
                const vid = v();
                if (e.code === 'Space' && vid) {
                    e.preventDefault();
                    if (vid.paused) vid.play().catch(() => {}); else vid.pause();
                    showUI();
                } else if (e.code === 'KeyF') {
                    e.preventDefault();
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    else shell.root.requestFullscreen().catch(() => {});
                } else if (e.code === 'KeyM') {
                    e.preventDefault();
                    setPref('muted', !prefs.muted);
                    showUI();
                } else if (e.code === 'KeyD') {
                    e.preventDefault();
                    setPref('danmuVisible', !prefs.danmuVisible);
                    showUI();
                }
            });
        }

        applyPrefs();
    };

    // ChatPanel 内部的折叠按钮（mount 完 chat 后绑定）
    const bindChatCollapseBtn = () => {
        if (!chat || !chat.root) return;
        const btn = chat.root.querySelector('#dy-chat-collapse-btn');
        if (btn) btn.onclick = () => setPref('chatCollapsed', true);
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
     * § 11.5 ⭐ v2.9 核心：强制 unhide 飞行弹幕父容器
     *
     * 斗鱼"app-isNew" A/B 版本给 .comment-XXX 加 hidden-XXXX modifier 让
     * display:none，飞行弹幕 DOM 实际存在但全被父级隐藏。CSS unhide 在某些
     * 时序/specificity 场景下不够稳，这里用 JS 兜底：
     *   - 启动时立即扫一遍，对所有 .comment-XXX hidden- 设置 inline
     *     style.setProperty('display', 'block', 'important')
     *   - MutationObserver 持续监听 class/style 属性变化，再次遇到 hidden-
     *     立刻强制 inline style（inline + !important 优先级最高，覆盖一切）
     * ================================================================ */
    const forceUnhideEl = (el) => {
        if (!el || el.nodeType !== 1) return;
        const cls = (el.className || '').toString();
        if (!cls.includes('comment-')) return;
        if (cls.includes('sendComment')) return;
        if (!cls.match(/hidden-/)) return;
        try {
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('visibility', 'visible', 'important');
        } catch (e) { /* readonly element */ }
    };
    const scanAndUnhide = (root) => {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('[class*="comment-"][class*="hidden-"]').forEach(forceUnhideEl);
    };
    let unhideOb = null;
    const startUnhide = () => {
        if (unhideOb) return;
        // 启动时先扫一遍
        scanAndUnhide(document);
        unhideOb = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'attributes' && m.target.nodeType === 1) {
                    forceUnhideEl(m.target);
                } else if (m.type === 'childList') {
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1) {
                            forceUnhideEl(n);
                            scanAndUnhide(n);
                        }
                    }
                }
            }
        });
        unhideOb.observe(document.documentElement, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['class', 'style'],
        });
    };
    // 立刻启动，不等 mount（mount 可能很晚，弹幕容器渲染更早）
    if (document.body) startUnhide();
    else document.addEventListener('DOMContentLoaded', startUnhide);

    /* ================================================================
     * § 12. 挂载 / 卸载 / 重挂
     * ================================================================ */
    let mountInFlight = false;
    const mount = async () => {
        if (!isLiveRoomUrl()) { console.log('[Douyu Cleaner] mount skip: not live room', location.pathname); return; }
        if (document.getElementById('dy-shell')) { console.log('[Douyu Cleaner] mount skip: shell exists'); return; }
        if (mountInFlight) { console.log('[Douyu Cleaner] mount skip: another mount in flight'); return; }
        mountInFlight = true;
        console.log('[Douyu Cleaner] mount start', location.pathname);
        // 兜底：35s 后无论成功失败都释放 flag（防 waitFor 30s 超时后卡死）
        const flightTimer = setTimeout(() => { mountInFlight = false; }, 35000);
        const releaseFlight = () => { clearTimeout(flightTimer); mountInFlight = false; };
        buildShell();
        chat = new ChatPanel(shell.chatHost);
        bindChatCollapseBtn();
        await movePlayerIntoShell();
        bindControls();
        bindChat();
        pickHighestQuality();
        startLatencyChase();
        startNativeCheck();
        releaseFlight();
        console.log('[Douyu Cleaner] v2.11 shell mounted ✓');
        // 诊断：mount 完成后 2s 报告弹幕容器状态，方便排查"弹幕没显示"
        setTimeout(() => {
            const comment = document.querySelector('[class*="comment-"]:not([class*="sendComment"])');
            const danmu = document.querySelector('[class*=" danmu-"]:not([class*="danmuItem"]):not([class*="showdanmu"]):not([class*="danmuModels"]):not([class*="danmuTips"]):not([class*="danmuReport"]):not([class*="sendDanmu"]):not([class*="simpleDanmu"])');
            const items = document.querySelectorAll('[class*="danmuItem-"]').length;
            const commentR = comment ? comment.getBoundingClientRect() : null;
            const danmuR = danmu ? danmu.getBoundingClientRect() : null;
            console.log('[Douyu Cleaner] diag:', {
                commentExists: !!comment, commentCls: comment?.className, commentHasHidden: /hidden-/.test(comment?.className || ''),
                commentSize: commentR ? `${commentR.width|0}x${commentR.height|0}` : null,
                commentDisplay: comment ? getComputedStyle(comment).display : null,
                danmuExists: !!danmu, danmuSize: danmuR ? `${danmuR.width|0}x${danmuR.height|0}` : null,
                danmuItemCount: items,
            });
        }, 2000);
    };
    const unmount = () => {
        stopLatencyChase();
        stopNativeCheck();
        // 复原 player case
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
     * § 13. SPA 监听 + 健康自愈轮询
     *
     * v2.11 关键修复：之前 mount 失败（如 waitFor 在 React unmount/remount race
     * 中错过 #js-player-asideMain）后**没有重试机制**，shell 永远不建。现在每
     * 1.5s 检查：
     *   1) URL 变化 → remount
     *   2) URL 没变但 shell 不见 + DOM 就绪 → 重新 mount（自愈）
     *   3) Barrage-list 重建（流断重连）→ 重新 bindBarrageList
     * ================================================================ */
    let lastUrl = location.href;
    let healCheckCount = 0;
    setInterval(() => {
        // 1) URL 变化
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            if (isLiveRoomUrl()) {
                console.log('[Douyu Cleaner] URL changed →', location.pathname, '→ remount');
                remount();
            } else {
                console.log('[Douyu Cleaner] URL changed → non-room → unmount');
                unmount();
            }
            return;
        }
        // 2) 自愈：直播间 URL 但 shell 不在 → mount
        if (isLiveRoomUrl() && !document.getElementById('dy-shell') && !mountInFlight) {
            // 等斗鱼 DOM 就绪再 mount
            const aside = document.querySelector('#js-player-asideMain');
            const caseEl = document.querySelector('#js-player-video-case');
            if (aside && caseEl) {
                healCheckCount++;
                console.log('[Douyu Cleaner] shell missing, auto-remount #' + healCheckCount);
                mount();
            }
        }
        // 3) Barrage-list 重建检测
        if (chat) {
            const list = document.querySelector(CFG.SEL_BARRAGE);
            if (list && list !== chat.boundList) chat.bindBarrageList(list);
        }
    }, 1500);

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

    console.log('[Douyu Cleaner] v2.11.0 已加载（自建飞行弹幕 + mount 自愈）');
})();
