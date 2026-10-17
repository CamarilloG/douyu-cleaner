// Public signed-out rooms. Verifies the complete shell; never sends a message.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  fs.mkdirSync('test-results', { recursive: true });
  try {
    for (const room of ['660000', 'wanmei']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('https://www.huya.com/' + room, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#J_playerMain', { state: 'attached' });
      await page.evaluate(() => { window.testOriginalPlayer = document.querySelector('#J_playerMain'); });
      await page.addScriptTag({ path: 'huya-cleaner.user.js' });
      await page.locator('#hc-shell').waitFor({ state: 'visible' });
      await page.locator('#hc-chat-host input, #hc-chat-host textarea').first().waitFor();
      const boxes = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { shell: rect('#hc-shell'), player: rect('#hc-video-host'), chat: rect('#hc-chat-host'), originalPlayer: document.querySelector('#hc-video-host').contains(window.testOriginalPlayer) };
      });
      assert.ok(boxes.player.width > 600 && boxes.chat.width > 250, JSON.stringify(boxes));
      assert.ok(boxes.player.right <= boxes.chat.x + 2, JSON.stringify(boxes));
      assert.equal(boxes.shell.y, 0);
      assert.equal(boxes.shell.height, 900);
      assert.ok(boxes.originalPlayer, 'Retain the official player node inside the new shell');
      await page.waitForFunction(() => {
        const video = document.querySelector('#hc-video-host video');
        return video && video.readyState >= 2 && video.currentTime > 0;
      }, null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const media = await page.evaluate(() => {
        const video = document.querySelector('#hc-video-host video');
        return video ? { readyState: video.readyState, currentTime: video.currentTime, paused: video.paused, error: video.error?.code || null } : null;
      });
      await page.mouse.move(500, 600);
      await page.screenshot({ path: `test-results/huya-${room}-shell.png` });
      await page.locator('#hc-controlbar [data-act="settings"]').click({ force: true });
      await page.locator('#hc-settings [data-act="restore"]').click();
      await page.locator('#hc-shell').waitFor({ state: 'detached' });
      assert.ok(await page.evaluate(() => window.testOriginalPlayer.isConnected));
      console.log(JSON.stringify({ room, boxes, media, restored: true }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
