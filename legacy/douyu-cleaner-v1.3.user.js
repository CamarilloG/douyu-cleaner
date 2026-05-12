// ==UserScript==
// @name         斗鱼直播间去广告 + 纯净弹幕区
// @namespace    https://github.com/yourname/douyu-cleaner
// @version      1.3.0
// @description  屏蔽斗鱼直播间广告/活动浮窗/充值弹窗/贵族横幅/入场特效；右侧弹幕区仅保留滚动弹幕与输入框。v1.3 新增 PubgGamePropShop/ActBase/wm-pc-room/Toolbar/DanmuEffect 等真实在播 class，并修复 SVG className 与性能 bug
// @author       you
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
     * 1. 通用广告 / 推广 / 活动 / 充值弹窗 屏蔽
     * ============================================================ */
    const adHideSelectors = [
        // —— 顶部横幅 / 屏幕广告 / 站内推广位
        '.ScreenBannerAd',
        '.banner__aJxj6',
        '.advert__J8F6s',
        '.DropMenuList-ad',
        '[class*="ScreenBannerAd"]',
        '[class*="advert__"]',
        '[class*="-advert"]',
        '[class*="Advert"]',
        '[class*="-Ad-"]',
        '[class^="ad-"]',
        '[class*=" ad-"]',

        // —— 顶部"赛事中心"条 / 多舞台切换条（赛事必用，看赛事请删此两行）
        '.has-match-center',
        '[class*="wm-pc-room-DropMenu"]',
        '[class*="wm-pc-room-button"]',

        // —— 顶部右侧扩展入口（下载 / 客户端 / 任务 / 创作中心）
        '.SupremeRightHeader',
        '[class*="SupremeRight"]',
        '.CreateCenter',
        '[class*="CreateCenter"]',
        '.Header-createcenter-wrap',
        '.Header-download-wrap',
        '[class*="Download-panel"]',
        '[class*="Download-pcClient"]',
        '[class*="Download-mobile"]',
        '[class*="Download-list"]',
        '.Header-taskentry-wrap',
        '[class*="taskScoreEntry"]',
        '[class*="TaskEntryPanel"]',

        // —— 左上活动入口
        '.activeItem__d6uUm',
        '[class*="activeItem__"]',
        '[class*="activeBar__"]',
        '[class*="activeContainer__"]',

        // —— 右侧 / 顶部充值悬浮 ("鱼鱼补给站" 等)
        '.RechargeBigRewards',
        '[class*="RechargeBigRewards"]',
        '[class*="Recharge"]',
        '[class*="recharge"]',
        '[class*="BigRewards"]',
        '[class*="SupplyStation"]',
        '[class*="supplyStation"]',
        '[class*="GiftRoll"]',
        '[class*="gameAd"]',

        // —— v1.3 新增：实测命中的右侧浮窗（PUBG道具商店 / ActBase 通用活动框架 / 轮播）
        //    ActBase 是通用框架，限定 is-show 子选择器避免误伤主播自定义小游戏
        '[class*="PubgGamePropShop"]',
        '[class*="ActBase"].is-show',
        '[class*="ActBase-bar"]',
        '[class*="ActBase-switch"]',
        '[class*="ActBase-Pendant"]',
        '[class*="ActRotation"]',

        // —— 右上"在线榜 / 活跃榜 / 贵宾 / 钻粉"分栏整块
        '.layout-Player-rankAll',
        '.layout-Player-rank',
        '.ChatRank',
        '[class*="DiamondsFansRank"]',
        '[class*="RankTips"]',
        '[class*="ChatTabContainer"]',

        // —— 鱼丸宝箱 / 签到 / 任务 / 抽奖 / 活动
        '.FishballTreasure',
        '.TreasureEntrance',
        '.LotteryContainer-svgaWrap',
        '.LotteryContainer-svgaDes',
        '.AnchorDrawLottery',
        '[class*="SignIn"]',
        '[class*="signin"]',
        '[class*="TaskCenter"]',
        '[class*="ActivityItem"]',
        '[class*="Lottery"]',
        '[class*="Coupon"]',
        '[class*="ShopKeeper"]',
        '[class*="WearMedal"]',
        '[class*="Backpack-newPropTip"]',

        // —— v1.3 新增：弹幕底层入场/礼物特效层（不在 chat 区，在视频上方）
        '[class*="DanmuEffectDom"]',
        '[class*="MMSvgaBaseContainer"]',
        '[class*="SuperFansSvgaContainer"]',
        '[class*="LuckyStarSvga"]',
        '[class*="LittleLuckyV2"]',

        // —— v1.3 新增：CPS / 主播上播 / 关注引导对话框
        '[class*="CPSDialog"]',
        '[class*="AnchorUpDialog"]',

        // —— 礼物面板 / 互动广告
        '.GiftInfoPanel-banner',
        '.GiftInfoPanel-bannerContainer',
        '[class*="GiftInfoPanel-banner"]',
        '.AdvancedGiftBanner',
        '[class*="InteractABAd"]',
        '[class*="Promotion"]',
        '[class*="Business"]',
        '[class*="RecomBox"]',
        '[class*="RoomRecom"]',
        '[class*="recommend-"]',
        '[class*="RoomVipList"]',

        // —— v1.3 新增：工具栏礼物轮播广告卡 / 工具栏额外卡片
        '[class*="ToolbarGiftCard"]',
        '[class*="ToolbarGiftArea"]',
        '[class*="PlayerToolbar-Task"]',
        // 注：ToolbarCardModule 可能含正经按钮（直播间公告等），先用比较窄的命中而不全屏蔽

        // —— v1.3 新增：弹幕区入口按钮（钻粉/抽奖/贵族/V排行）
        '[class*="DiamondsFansEnter"]',
        '[class*="AnchorGachaEntrance"]',
        '[class*="NobleToolbarEnter"]',
        '[class*="VRankEntrance"]',

        // —— 小窗 / 悬浮播放器 / 弹窗 / 全屏蒙层
        '.roomSmallPlayerFloatLayout',
        '[class*="FloatLayout"]',
        '[class*="float-ad"]',
        '.container__CfDK-.fixed__Ny65f.mask__f5JUy'
        // 注：v1.3 移除了过宽的 [class*="Popup"] / [class*="popup"] / [class*="Operate"] / [class*="-Float"]
        // —— 实测无任何合法 class 含这些字符串，但留着会有未来误杀风险，宁可漏
    ];

    /* ============================================================
     * 2. 右侧弹幕区"纯净版" + 屏蔽进场特效 / 礼物横幅
     * ============================================================ */
    const chatHideSelectors = [
        // —— 弹幕区顶部工具栏
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

        // —— 弹幕区里的额外活动 / 排行 / 贵宾 / 股东 / 公会 / 守护
        '.layout-Player-chat [class*="VipList"]',
        '.layout-Player-chat [class*="RankList"]',
        '.layout-Player-chat [class*="StockHolder"]',
        '.layout-Player-chat [class*="Guild"]',
        '.layout-Player-chat [class*="Guard"]',
        '.layout-Player-chat [class*="Noble"]',
        '.layout-Player-chat [class*="Fans-rank"]',

        // —— 顶部漂浮通知 / 喇叭 / 系统消息
        '.layout-Player-chat .Barrage-topFloater',
        '.layout-Player-chat .Barrage-topFloaterList',
        '.layout-Player-chat .Barrage-toolbar',
        '.layout-Player-chat [class*="MatchSysMsg"]',
        '.layout-Player-chat [class*="Notice"]',
        '.layout-Player-chat [class*="Horn"]',

        /* —— 弹幕区进场特效 / 礼物横幅 / 入场动画 —— */
        '[class*="VideoBarrageBanner"]',
        '[class*="VideoBarrageGiftBanner"]',
        '[class*="NewGiftBarrageBanner"]',
        '[class*="UserGiftBanner"]',
        '[class*="BarrageBanner"]',
        '[class*="GiftBanner"]',
        '[class*="EnterRoom"]',
        '[class*="enterRoom"]',
        '[class*="NobleEnter"]',
        '[class*="NobleBarrage"]',
        '[class*="VipEnter"]',
        '[class*="vipEnter"]',
        '[class*="GuardEnter"]',
        '[class*="EnterAnim"]',
        '[class*="enterAnim"]',
        '[class*="UserEnter"]',
        '[class*="userEnter"]',

        // —— 弹幕区里的 svga / vap / 动画播放层
        '.AsideEffectPlayerDom',
        '.AsideEffectPlayerDom-svgaPlayer',
        '.AsideEffectPlayerDom-vapPlayer',
        '[class*="AsideEffect"]',
        '.ConfigEffect',
        '[class*="ConfigEffect"]',
        '[class*="SvgaPlayer"]',
        '[class*="VapPlayer"]',
        '[class*="-svgaPlayer"]',
        '[class*="-vapPlayer"]'
    ];

    /* ============================================================
     * 3. 注入 CSS
     * ============================================================ */
    const css = `
        ${adHideSelectors.join(',')}{
            display:none !important;
        }
        ${chatHideSelectors.join(',')}{
            display:none !important;
        }

        /* —— 纯净版弹幕区布局重排 —— */
        .layout-Player-chat .Chat{
            display:flex !important;
            flex-direction:column !important;
            height:100% !important;
            background:#1a1a1a !important;
        }
        .layout-Player-chat .ChatSpeak{
            flex:1 1 auto !important;
            min-height:0 !important;
            display:flex !important;
            flex-direction:column !important;
        }
        .layout-Player-chat .Barrage{
            flex:1 1 auto !important;
            min-height:0 !important;
        }
        .layout-Player-chat .Barrage-main,
        .layout-Player-chat .Barrage-list{
            height:100% !important;
            background:transparent !important;
        }
        .layout-Player-chat .Barrage-listItem{
            padding:4px 10px !important;
            line-height:1.45 !important;
            font-size:13px !important;
            color:#e6e6e6 !important;
            background:transparent !important;
            border:none !important;
            animation:none !important;
            transform:none !important;
        }
        /* 弹幕条目里的徽章 / 等级 / 粉丝牌 / 贵族标识 */
        .layout-Player-chat .Barrage-listItem [class*="Medal"],
        .layout-Player-chat .Barrage-listItem [class*="UserLevel"],
        .layout-Player-chat .Barrage-listItem [class*="userLevel"],
        .layout-Player-chat .Barrage-listItem [class*="Noble"],
        .layout-Player-chat .Barrage-listItem [class*="noble"],
        .layout-Player-chat .Barrage-listItem [class*="Guard"],
        .layout-Player-chat .Barrage-listItem [class*="Badge"],
        .layout-Player-chat .Barrage-listItem [class*="Icon-"],
        .layout-Player-chat .Barrage-listItem [class*="-icon"]{
            display:none !important;
        }
        .layout-Player-chat .Barrage-listItem .Barrage-nickName{
            color:#9aa0a6 !important;
            font-weight:normal !important;
        }
        /* 输入框区 */
        .layout-Player-chat .ChatSend{
            flex:0 0 auto !important;
            padding:6px 8px !important;
            background:#222 !important;
            border-top:1px solid #333 !important;
        }
        .layout-Player-chat .ChatSend-scroll{
            background:#2c2c2c !important;
            border-radius:4px !important;
        }
        .layout-Player-chat .ChatSend-txt{ color:#eee !important; }
        .layout-Player-chat .ChatSend-button{
            background:#ff7700 !important;
            color:#fff !important;
            border-radius:4px !important;
        }

        /* 兜底：禁用所有 svga / vap 动画播放层（弹幕区进场特效） */
        .layout-Player-chat canvas,
        .layout-Player-chat video[class*="vap"],
        .layout-Player-chat [class*="svga"]{
            display:none !important;
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
     * 4. MutationObserver 动态清理
     *    v1.3: 仅检查节点自身 class，不再 querySelectorAll('*') 全树遍历
     *    v1.3: 改用 getAttribute('class') 兼容 SVG 节点
     * ============================================================ */
    const keywordRe = /(advert|Advert|ScreenBanner|FishballTreasure|TreasureEntrance|InteractABAd|RoomRecom|Recommend|Promotion|SignIn|TaskCenter|Lottery|ActivityItem|FloatLayout|roomSmallPlayerFloat|Coupon|ShopKeeper|WearMedal|GiftInfoPanel-banner|AdvancedGiftBanner|Barrage-topFloater|Business|activeItem__|activeBar__|Recharge|BigRewards|SupplyStation|SupremeRight|CreateCenter|ChatRank|DiamondsFansRank|RankTips|PubgGamePropShop|ActBase-bar|ActBase-switch|ActRotation|Header-download|Header-taskentry|taskScoreEntry|TaskEntryPanel|CPSDialog|AnchorUpDialog|ToolbarGiftCard|ToolbarGiftArea|PlayerToolbar-Task|DiamondsFansEnter|AnchorGachaEntrance|NobleToolbarEnter|VRankEntrance|DanmuEffectDom|MMSvgaBaseContainer|SuperFansSvgaContainer|LuckyStarSvga|LittleLuckyV2|wm-pc-room-DropMenu|wm-pc-room-button|has-match-center)/;

    const chatJunkRe = /(ChatToolBar|FansMedalPanel-container|ChatNobleBarrage|ChatFansBarrage|ChatEmotion|Horn4Category|PopularBarrage|BarrageWord|ChatBarrageCollect|EnergyBarrageIcon|BarrageAIIcon|BarrageFilter|ShieldTool-content|VipList|RankList|StockHolder|NobleEnter|EnterRoom|enterRoom|VideoBarrageBanner|VideoBarrageGiftBanner|NewGiftBarrageBanner|UserGiftBanner|BarrageBanner|GiftBanner|VipEnter|vipEnter|GuardEnter|EnterAnim|enterAnim|UserEnter|userEnter|AsideEffect|ConfigEffect|SvgaPlayer|VapPlayer|svgaPlayer|vapPlayer)/;

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
            for (let i = 0; i < nodes.length; i++) {
                clean(nodes[i]);
            }
        }
    });

    const startObserve = () => {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        if (document.body) {
            document.body.querySelectorAll('[class]').forEach(clean);
        }
    };
    if (document.body) startObserve();
    else document.addEventListener('DOMContentLoaded', startObserve);

    /* ============================================================
     * 5. 拦截广告 / 统计 / 充值大礼包 / svga 资源请求
     *    v1.3: 拦截后返回空 JSON 而不是空 text，避免下游 JSON.parse 抛错
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

    console.log('[Douyu Cleaner] v1.3 已加载：PubgGamePropShop / ActBase / Toolbar / DanmuEffect 已纳入屏蔽；SVG className 兼容与性能 bug 已修复');
})();
