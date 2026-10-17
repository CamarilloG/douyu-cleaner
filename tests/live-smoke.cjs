// Public, signed-out rooms only. This check never clicks a send or repeat button.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const results = [];
    try {
        for (const site of [
            { name: 'huya', url: 'https://www.huya.com/660000', file: 'huya-cleaner.user.js', items: '#danmudiv .danmu-item' },
            { name: 'douyu', url: 'https://www.douyu.com/9999', file: 'douyu-cleaner.user.js', items: '[class*="danmuItem-"][class*="scroll-"]' },
        ]) {
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.addScriptTag({ path: path.resolve(site.file) });
                await page.waitForSelector('.lc-native-repeat-layer', { state: 'attached', timeout: 45000 });
                await page.waitForSelector(site.items, { state: 'attached', timeout: 30000 }).catch(() => {});
                let hovered = false;
                for (let i = 0; i < 20; i++) {
                    const item = page.locator(site.items).last();
                    const box = await item.boundingBox().catch(() => null);
                    if (box && box.x >= 0 && box.x < 1400 && box.y > 0 && box.y < 850) {
                        await page.mouse.move(box.x + Math.min(10, box.width / 2), box.y + box.height / 2);
                        await page.waitForTimeout(100);
                        hovered = await page.locator('.lc-native-repeat-layer button').first().isVisible();
                        if (hovered) break;
                    }
                    await page.waitForTimeout(250);
                }
                fs.mkdirSync('test-results', { recursive: true });
                await page.screenshot({ path: `test-results/${site.name}-live.png` });
                results.push({ site: site.name, mounted: true, items: await page.locator(site.items).count(), hovered, pageErrors: errors.slice(0, 4) });
            } catch (error) {
                results.push({ site: site.name, error: error.message, pageErrors: errors.slice(0, 4) });
            }
            await page.close();
        }
    } finally { await browser.close(); }
    console.log(JSON.stringify(results, null, 2));
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/live-smoke.json', JSON.stringify(results, null, 2));
    if (results.some(result => !result.mounted || !result.hovered)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
