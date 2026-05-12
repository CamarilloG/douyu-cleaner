// ==UserScript==
// @name         斗鱼直播间去广告 + 纯净弹幕区
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      1.4.0
// @description  屏蔽斗鱼直播间广告/活动浮窗/充值弹窗/入场特效；修复输入框被压成 16px 的布局 bug；修正新版斗鱼弹幕区作用域（Barrage 在 .layout-Player-asideMainTop 不在 .layout-Player-chat）
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  v1.4 重要变更（基于真实房间 F12 实测）：
  1. [作用域修正] 新版斗鱼侧栏拆成两个独立容器：
       #js-player-asideMain
        ├── .layout-Player-asideMainTop  ← 真正的弹幕滚动 .Barrage 在这里
        └── .layout-Player-chat          ← 仅工具栏 + 输入框
     老脚本所有 `.layout-Player-chat .Barrage*` 选择器实际未命中，本版改成
     `.layout-Player-barrage` / `.layout-Player-asideMain` 作用域。
  2. [输入框修复] `.ChatSend` 在斗鱼自身 CSS 下宽度退化成 16px。本版强制
     `.ChatSend { width:100% }` 并把内框 `.ChatSend-scroll` / `-box` / `-txt`
     改成正确的 flex:1 1 auto，恢复输入区。
  3. [新增屏蔽] `.layout-Player-effect`（弹幕区入场/礼物特效层）、`.ChatEffect`、
     `.SvgaConfigEffect`。
  4. [删除冗余] 删除老脚本中针对错误结构的 `.layout-Player-chat .Chat / .ChatSpeak / .Barrage*`
     flex 重排 —— 这些规则在新版结构下完全不生效。
*/

(function () {
    'use strict';

    /* ============================================================
     * 1. 广告 / 推广 / 活动 / 充值弹窗 屏蔽
     * ============================================================ */
    const adHideSelectors = [
        // —— 顶部横幅 / 屏幕广告
        '.ScreenBannerAd', '.banner__aJxj6', '.advert__J8F6s', '.DropMenuList-ad',
        '[class*="ScreenBannerAd"]', '[class*="advert__"]', '[class*="-advert"]',
        '[class*="Advert"]', '[class*="-Ad-"]', '[class^="ad-"]', '[class*=" ad-"]',

        // —— 顶部"赛事中心"条 / 多舞台切换条
        '.has-match-center',
        '[class*="wm-pc-room-DropMenu"]', '[class*="wm-pc-room-button"]',

        // —— 顶部右侧扩展入口（下载 / 客户端 / 任务 / 创作中心）
        '.SupremeRightHeader', '[class*="SupremeRight"]',
        '.CreateCenter', '[class*="CreateCenter"]', '.Header-createcenter-wrap',
        '.Header-download-wrap',
        '[class*="Download-panel"]', '[class*="Download-pcClient"]',
        '[class*="Download-mobile"]', '[class*="Download-list"]',
        '.Header-taskentry-wrap',
        '[class*="taskScoreEntry"]', '[class*="TaskEntryPanel"]',

        // —— 左上活动入口
        '.activeItem__d6uUm',
        '[class*="activeItem__"]', '[class*="activeBar__"]', '[class*="activeContainer__"]',

        // —— 充值悬浮 ("鱼鱼补给站" / RechargeBigRewards / 大礼包)
        '.RechargeBigRewards',
        '[class*="RechargeBigRewards"]', '[class*="Recharge"]', '[class*="recharge"]',
        '[class*="BigRewards"]', '[class*="SupplyStation"]', '[class*="supplyStation"]',
        '[class*="GiftRoll"]', '[class*="gameAd"]',

        // —— 右侧通用活动浮窗框架（PUBG 道具商店等）
        '[class*="PubgGamePropShop"]',
        '[class*="ActBase"].is-show',
        '[class*="ActBase-bar"]', '[class*="ActBase-switch"]', '[class*="ActBase-Pendant"]',
        '[class*="ActRotation"]',

        // —— 在线榜 / 活跃榜 / 贵宾 / 钻粉 整块
        '.layout-Player-rankAll', '.layout-Player-rank', '.ChatRank',
        '[class*="DiamondsFansRank"]', '[class*="RankTips"]', '[class*="ChatTabContainer"]',

        // —— 鱼丸宝箱 / 签到 / 任务 / 抽奖
        '.FishballTreasure', '.TreasureEntrance',
        '.LotteryContainer-svgaWrap', '.LotteryContainer-svgaDes', '.AnchorDrawLottery',
        '[class*="SignIn"]', '[class*="signin"]',
        '[class*="TaskCenter"]', '[class*="ActivityItem"]',
        '[class*="Lottery"]', '[class*="Coupon"]',
        '[class*="ShopKeeper"]', '[class*="WearMedal"]', '[class*="Backpack-newPropTip"]',

        // —— v1.4 新增：弹幕滚动区底层入场/礼物特效层（不在 .layout-Player-chat 内，在视频侧栏）
        '.layout-Player-effect', '[class*="layout-Player-effect"]',
        '.ChatEffect', '[class*="ChatEffect"]',
        '.SvgaConfigEffect', '[class*="SvgaConfigEffect"]',
        '[class*="DanmuEffectDom"]', '[class*="MMSvgaBaseContainer"]',
        '[class*="SuperFansSvgaContainer"]',
        '[class*="LuckyStarSvga"]', '[class*="LittleLuckyV2"]',

        // —— CPS / 主播上播对话框
        '[class*="CPSDialog"]', '[class*="AnchorUpDialog"]',

        // —— 礼物面板 / 互动广告
        '.GiftInfoPanel-banner', '.GiftInfoPanel-bannerContainer',
        '[class*="GiftInfoPanel-banner"]', '.AdvancedGiftBanner',
        '[class*="InteractABAd"]',
        '[class*="Promotion"]', '[class*="Business"]',
        '[class*="RecomBox"]', '[class*="RoomRecom"]', '[class*="recommend-"]',
        '[class*="RoomVipList"]',

        // —— 工具栏礼物轮播 / 工具栏额外卡片
        '[class*="ToolbarGiftCard"]', '[class*="ToolbarGiftArea"]',
        '[class*="PlayerToolbar-Task"]',

        // —— 弹幕区入口按钮（钻粉/抽奖/贵族/V排行）
        '[class*="DiamondsFansEnter"]', '[class*="AnchorGachaEntrance"]',
        '[class*="NobleToolbarEnter"]', '[class*="VRankEntrance"]',

        // —— 小窗 / 悬浮播放器
        '.roomSmallPlayerFloatLayout',
        '[class*="FloatLayout"]', '[class*="float-ad"]',
        '.container__CfDK-.fixed__Ny65f.mask__f5JUy'
    ];

    /* ============================================================
     * 2. 弹幕区/输入区"纯净版"屏蔽
     *    v1.4: 作用域改成 .layout-Player-asideMain（覆盖 asideMainTop + chat）
     * ============================================================ */
    const chatHideSelectors = [
        // —— 弹幕输入框上方的工具栏（表情/喇叭/贵族/粉丝/AI 等）
        '.layout-Player-chat .ChatToolBar',
        '.layout-Player-chat .FansMedalPanel-container',
        '.layout-Player-chat .ChatNobleBarrage',
        '.layout-Player-chat .ChatFansBarrage',
        '.layout-Player-chat .ChatEmotion',
        '.layout-Player-chat .Horn4Category',
        '.layout-Player-chat .PopularBarrage',
        '.layout-Player-chat .BarrageWord',
        '.layout-Player-chat .ChatBarrageCollect',
        '.layout-Player-chat .EnergyBarrageIcon',
        '.layout-Player-chat .BarrageAIIcon',
        '.layout-Player-chat .BarrageFilter',
        '.layout-Player-chat .ShieldTool-content',

        // —— 弹幕滚动区上方/旁边的额外活动 / 排行 / 贵宾 / 守护
        '.layout-Player-asideMain [class*="VipList"]',
        '.layout-Player-asideMain [class*="RankList"]',
        '.layout-Player-asideMain [class*="StockHolder"]',
        '.layout-Player-asideMain [class*="Guild"]',
        '.layout-Player-asideMain [class*="Fans-rank"]',

        // —— 顶部漂浮通知 / 喇叭
        '.layout-Player-asideMain .Barrage-topFloater',
        '.layout-Player-asideMain .Barrage-topFloaterList',
        '.layout-Player-asideMain .Barrage-toolbar',
        '.layout-Player-asideMain [class*="MatchSysMsg"]',
        '.layout-Player-asideMain [class*="Horn"]',

        // —— 弹幕滚动区里的进场特效 / 礼物横幅 / 入场动画
        '.layout-Player-asideMain [class*="VideoBarrageBanner"]',
        '.layout-Player-asideMain [class*="VideoBarrageGiftBanner"]',
        '.layout-Player-asideMain [class*="NewGiftBarrageBanner"]',
        '.layout-Player-asideMain [class*="UserGiftBanner"]',
        '.layout-Player-asideMain [class*="BarrageBanner"]',
        '.layout-Player-asideMain [class*="GiftBanner"]',
        '.layout-Player-asideMain [class*="EnterRoom"]',
        '.layout-Player-asideMain [class*="enterRoom"]',
        '.layout-Player-asideMain [class*="NobleEnter"]',
        '.layout-Player-asideMain [class*="NobleBarrage"]',
        '.layout-Player-asideMain [class*="VipEnter"]',
        '.layout-Player-asideMain [class*="vipEnter"]',
        '.layout-Player-asideMain [class*="GuardEnter"]',
        '.layout-Player-asideMain [class*="EnterAnim"]',
        '.layout-Player-asideMain [class*="enterAnim"]',
        '.layout-Player-asideMain [class*="UserEnter"]',
        '.layout-Player-asideMain [class*="userEnter"]',

        // —— svga / vap 动画播放层
        '.layout-Player-asideMain .AsideEffectPlayerDom',
        '.layout-Player-asideMain [class*="AsideEffect"]',
        '.layout-Player-asideMain [class*="SvgaPlayer"]',
        '.layout-Player-asideMain [class*="VapPlayer"]',
        '.layout-Player-asideMain [class*="-svgaPlayer"]',
        '.layout-Player-asideMain [class*="-vapPlayer"]'
    ];

    /* ============================================================
     * 3. 注入 CSS
     *    v1.4: 删除所有针对错误结构 .layout-Player-chat .Barrage* 的 flex 重排
     *    v1.4: 弹幕条目美化改作用域 .layout-Player-barrage .Barrage-listItem
     *    v1.4: 修复 .ChatSend 16px 宽度 bug
     * ============================================================ */
    const css = `
        ${adHideSelectors.join(',')}{ display:none !important; }
        ${chatHideSelectors.join(',')}{ display:none !important; }

        /* —— 弹幕滚动区背景 —— */
        .layout-Player-asideMainTop,
        .layout-Player-barrageStage,
        .layout-Player-barrage,
        .Barrage,
        .Barrage-main,
        .Barrage-list{
            background:#1a1a1a !important;
        }

        /* —— 弹幕条目（在 .layout-Player-barrage 里，不是 .layout-Player-chat） —— */
        .layout-Player-barrage .Barrage-listItem{
            padding:4px 10px !important;
            line-height:1.45 !important;
            font-size:13px !important;
            color:#e6e6e6 !important;
            background:transparent !important;
            border:none !important;
            animation:none !important;
            transform:none !important;
        }
        /* 隐藏弹幕条目里的徽章 / 等级 / 粉丝牌 / 贵族标识 */
        .layout-Player-barrage .Barrage-listItem [class*="Medal"],
        .layout-Player-barrage .Barrage-listItem [class*="UserLevel"],
        .layout-Player-barrage .Barrage-listItem [class*="userLevel"],
        .layout-Player-barrage .Barrage-listItem [class*="Noble"],
        .layout-Player-barrage .Barrage-listItem [class*="noble"],
        .layout-Player-barrage .Barrage-listItem [class*="Guard"],
        .layout-Player-barrage .Barrage-listItem [class*="Badge"],
        .layout-Player-barrage .Barrage-listItem [class*="Icon-"],
        .layout-Player-barrage .Barrage-listItem [class*="-icon"]{
            display:none !important;
        }
        .layout-Player-barrage .Barrage-listItem .Barrage-nickName{
            color:#9aa0a6 !important;
            font-weight:normal !important;
        }

        /* ============================================================
         * v1.4 修复：输入框宽度坍缩 bug
         * 现象：斗鱼新版 .ChatSend 在某些状态下 width 退化到 16px
         * 修复：强制 .ChatSend 占满父宽，内框走 flex:1 1 auto + min-width:0
         * ============================================================ */
        .layout-Player-chat .Chat{
            background:#1a1a1a !important;
        }
        .layout-Player-chat .ChatSpeak{
            align-items: stretch !important;
        }
        .layout-Player-chat .ChatSend{
            width: 100% !important;
            align-self: stretch !important;
            box-sizing: border-box !important;
            min-width: 0 !important;
            padding: 6px 8px !important;
            background:#222 !important;
            border-top:1px solid #333 !important;
        }
        .layout-Player-chat .ChatSend-scroll{
            flex: 1 1 auto !important;
            min-width: 0 !important;
            width: auto !important;
            background:#2c2c2c !important;
            border-radius:4px !important;
        }
        .layout-Player-chat .ChatSend-box,
        .layout-Player-chat .ChatSend-txt{
            width: 100% !important;
            min-width: 0 !important;
            flex: 1 1 auto !important;
        }
        .layout-Player-chat .ChatSend-txt{
            color:#eee !important;
        }
        .layout-Player-chat .ChatSend-button{
            background:#ff7700 !important;
            color:#fff !important;
            border-radius:4px !important;
            flex: 0 0 auto !important;
        }
    `;

    const injectCSS = () => {
        const style = document.createElement('style');
        style.id = 'douyu-cleaner-style';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    };
    injectCSS();

    /* ============================================================
     * 4. MutationObserver 动态清理（兜底）
     * ============================================================ */
    const keywordRe = /(advert|Advert|ScreenBanner|FishballTreasure|TreasureEntrance|InteractABAd|RoomRecom|Recommend|Promotion|SignIn|TaskCenter|Lottery|ActivityItem|FloatLayout|roomSmallPlayerFloat|Coupon|ShopKeeper|WearMedal|GiftInfoPanel-banner|AdvancedGiftBanner|Barrage-topFloater|Business|activeItem__|activeBar__|Recharge|BigRewards|SupplyStation|SupremeRight|CreateCenter|ChatRank|DiamondsFansRank|RankTips|PubgGamePropShop|ActBase-bar|ActBase-switch|ActRotation|Header-download|Header-taskentry|taskScoreEntry|TaskEntryPanel|CPSDialog|AnchorUpDialog|ToolbarGiftCard|ToolbarGiftArea|PlayerToolbar-Task|DiamondsFansEnter|AnchorGachaEntrance|NobleToolbarEnter|VRankEntrance|DanmuEffectDom|MMSvgaBaseContainer|SuperFansSvgaContainer|LuckyStarSvga|LittleLuckyV2|wm-pc-room-DropMenu|wm-pc-room-button|has-match-center|layout-Player-effect|ChatEffect|SvgaConfigEffect)/;

    const chatJunkRe = /(ChatToolBar|FansMedalPanel-container|ChatNobleBarrage|ChatFansBarrage|ChatEmotion|Horn4Category|PopularBarrage|BarrageWord|ChatBarrageCollect|EnergyBarrageIcon|BarrageAIIcon|BarrageFilter|ShieldTool-content|VipList|RankList|StockHolder|NobleEnter|EnterRoom|enterRoom|VideoBarrageBanner|VideoBarrageGiftBanner|NewGiftBarrageBanner|UserGiftBanner|BarrageBanner|GiftBanner|VipEnter|vipEnter|GuardEnter|EnterAnim|enterAnim|UserEnter|userEnter|AsideEffect|SvgaPlayer|VapPlayer|svgaPlayer|vapPlayer)/;

    const clean = (root) => {
        if (!root || root.nodeType !== 1) return;
        const cls = root.getAttribute && root.getAttribute('class');
        if (!cls || cls.length > 250) return;
        if (keywordRe.test(cls) || chatJunkRe.test(cls)) {
            root.style.setProperty('display', 'none', 'important');
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            const nodes = m.addedNodes;
            if (!nodes) continue;
            for (let i = 0; i < nodes.length; i++) clean(nodes[i]);
        }
    });

    const startObserve = () => {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        if (document.body) document.body.querySelectorAll('[class]').forEach(clean);
    };
    if (document.body) startObserve();
    else document.addEventListener('DOMContentLoaded', startObserve);

    /* ============================================================
     * 5. 拦截广告 / 统计 / 充值大礼包 / svga 资源请求
     * ============================================================ */
    const blockUrlRe = /(\/advert\/|\/ad\/|adsrc|advertise|pos_ad|launchad|\/promotion\/|\/screenAd|tongji|hm\.baidu|cnzz|RechargeBigRewards|supplystation|\/banner\/svga|enterRoom\.svga|noble.*\.svga|vap\/.*enter|PubgGamePropShop|ActRotation)/i;

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
                return Promise.resolve(new Response('{}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                }));
            }
        } catch (e) {}
        return _fetch.apply(this, arguments);
    };

    console.log('[Douyu Cleaner] v1.4 已加载：输入框宽度坍缩已修复 / 弹幕区作用域已修正为 .layout-Player-asideMain');
})();
