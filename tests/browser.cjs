const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
    const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(__dirname, 'native-repeat.fixture.html')).href);
        const original = page.locator('.danmaku').first();
        const rect = await original.boundingBox();
        assert.equal(await original.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        await page.mouse.move(rect.x + 20, rect.y + 8);
        const button = page.locator('.lc-native-repeat-layer button');
        await button.waitFor({ state: 'visible' });
        assert.equal(await button.getAttribute('aria-label'), '复读弹幕：这波操作太秀了');
        await button.click();
        assert.deepEqual(await page.evaluate(() => sent), ['这波操作太秀了']);
        assert.equal(await page.locator('#draft').inputValue(), '还没写完的草稿');
        assert.match(await page.locator('[role=status]').innerText(), /已提交/);

        // Native CSS animations pause only during selection and resume on destroy.
        await page.mouse.move(800, 600);
        await page.waitForTimeout(400);
        const moving = page.locator('.moving');
        await moving.evaluate(el => { el.style.animationDuration = '1000s'; });
        const movingRect = await moving.boundingBox();
        await page.mouse.move(movingRect.x + 10, movingRect.y + 8);
        await button.waitFor({ state: 'visible' });
        assert.equal(await moving.evaluate(el => el.getAnimations()[0].playState), 'paused');
        await page.evaluate(() => repeat.destroy());
        assert.equal(await moving.evaluate(el => el.getAnimations()[0].playState), 'running');
        assert.equal(await page.locator('.lc-native-repeat-layer').count(), 0);

        // Hover under a stationary pointer is detected when a native item arrives later.
        await page.reload();
        await page.mouse.move(300, 280);
        await page.evaluate(() => {
            const el = document.createElement('span');
            el.className = 'danmaku'; el.textContent = '新经过的弹幕';
            el.style.cssText = 'left:280px;top:264px';
            document.querySelector('#native').append(el);
        });
        await button.waitFor({ state: 'visible' });
        assert.equal(await button.getAttribute('aria-label'), '复读弹幕：新经过的弹幕');
        await page.evaluate(() => { window.room = 'changed'; });
        await button.click({ timeout: 1500 }).catch(() => {});
        assert.deepEqual(await page.evaluate(() => sent), []);
        await page.evaluate(() => repeat.destroy());

        // Native fullscreen may target a descendant of our root with pointer-events:none.
        await page.reload();
        await page.evaluate(async () => {
            await document.querySelector('#native').requestFullscreen();
            const el = document.querySelector('.danmaku');
            el.style.left = '730px'; // Outside the old non-fullscreen player bounds.
        });
        await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.querySelector('.lc-native-repeat-layer'));
        const fullRect = await original.boundingBox();
        await page.mouse.move(fullRect.x + 10, fullRect.y + 8);
        await button.waitFor({ state: 'visible' });
        await button.click();
        assert.deepEqual(await page.evaluate(() => sent), ['这波操作太秀了']);
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(() => !document.fullscreenElement && document.querySelector('#player > .lc-native-repeat-layer'));
        assert.equal(await page.locator('#player > .lc-native-repeat-layer').count(), 1);

        // Adapter rejections are surfaced without success wording or retries.
        await page.evaluate(() => {
            repeat.destroy();
            document.querySelector('.danmaku').style.left = '120px';
            window.sent = [];
            window.repeat = LiveCleanerNativeRepeat.mount({ root: document.querySelector('#player'), itemSelector: '.danmaku', readText: el => el.textContent, roomKey: () => room,
                send: async () => { window.attempts = (window.attempts || 0) + 1; return {status:'failed', message:'请先登录'}; }
            });
        });
        const rejectRect = await original.boundingBox();
        await page.mouse.move(rejectRect.x + 10, rejectRect.y + 8);
        await button.waitFor({ state: 'visible' });
        await button.click();
        assert.equal(await page.locator('[role=status]').innerText(), '请先登录');
        assert.equal(await page.evaluate(() => attempts), 1);
        assert.deepEqual(await page.evaluate(() => sent), []);
        await page.evaluate(() => repeat.destroy());
        assert.deepEqual(errors, []);
        console.log('Native hover browser fixture passed: geometry, snapshot, draft, animation restore, stationary pointer, room change, fullscreen, rejected send, cleanup.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
