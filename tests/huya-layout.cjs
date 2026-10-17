// Public signed-out page; only toggles local settings. Never sends a message.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const room of ['660000', 'wanmei']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('https://www.huya.com/' + room, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.addScriptTag({ path: 'src/native-repeat.js' });
      await page.addScriptTag({ path: 'src/huya.js' });
      await page.locator('#hc-native-settings summary').click();
      const core = page.locator('#J_mainRoom .room-core').first();
      const before = await core.evaluate(el => getComputedStyle(el).position);
      await page.getByLabel('影院布局（官方视频 + 聊天）', { exact: true }).check();
      const boxes = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { core: rect('#J_mainRoom .room-core'), player: rect('#J_playerMain'), chat: rect('#chatRoom') };
      });
      assert.ok(boxes.player.width > 600 && boxes.chat.width > 250);
      assert.ok(boxes.player.right <= boxes.chat.x + 2, JSON.stringify(boxes));
      assert.ok(boxes.core.y >= 0 && boxes.core.bottom <= 901, JSON.stringify(boxes));
      assert.ok(boxes.player.y >= 60 && boxes.player.bottom <= 900, JSON.stringify(boxes));
      await page.screenshot({ path: `test-results/huya-${room}-cinema.png` });
      await page.getByRole('button', { name: '恢复官方界面', exact: true }).click();
      assert.equal(await core.evaluate(el => getComputedStyle(el).position), before);
      console.log(JSON.stringify({ room, boxes, restored: true }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
