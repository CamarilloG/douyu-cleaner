const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
test('Huya rebuilt chat mirrors native rows safely, survives rebind, and protects drafts', async () => {
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="host" style="height:360px;width:340px"></div><div id="chat-room__list"><div data-cmid="1">系统公告</div><div data-cmid="2"><div class="msg-normal"><span class="name J_userMenu">名字:含冒号</span><span class="colon">:</span><span class="msg J_msg">正文<img alt="[大笑]">&lt;script&gt;危险文本&lt;/script&gt;</span></div></div></div>');
    await page.addScriptTag({ path: path.resolve('src/huya-chat.js') });
    await page.evaluate(() => {
      window.sent = []; window.resultStatus = 'submitted';
      window.mountChat = () => window.chat = HuyaCleanerChat.mount({ host: document.querySelector('#host'), send: async text => { sent.push(text); await new Promise(r => setTimeout(r, 50)); return { status: resultStatus }; } });
      mountChat();
    });
    assert.equal(await page.locator('.hc-chat-row').count(), 2);
    assert.equal(await page.locator('.hc-chat-nick').textContent(), '名字:含冒号：');
    assert.equal(await page.locator('.hc-chat-text').last().textContent(), '正文[大笑]<script>危险文本</script>');
    assert.equal(await page.locator('.hc-chat-list script, .hc-chat-list img').count(), 0);
    await page.evaluate(() => document.querySelector('#chat-room__list').replaceWith(document.querySelector('#chat-room__list').cloneNode(true)));
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.hc-chat-row').count(), 2, 'rebinding cloned history must not duplicate messages');
    await page.evaluate(() => {
      const original = document.querySelector('#chat-room__list');
      for (let i = 3; i <= 220; i++) { const row = document.createElement('div'); row.dataset.cmid = i; row.textContent = '记录' + i; original.append(row); }
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.hc-chat-row').count(), 200);
    assert.equal(await page.locator('.hc-chat-count').textContent(), '200 / 200');
    await page.locator('.hc-chat-input').fill('保留草稿');
    await page.evaluate(() => document.querySelector('.hc-chat-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await page.evaluate(() => sent.length), 0);
    await page.locator('.hc-chat-send').click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.hc-chat-input').inputValue(), '保留草稿');
    assert.match(await page.locator('.hc-chat-status').textContent(), /草稿已保留/);
    await page.evaluate(() => { chat.destroy(); mountChat(); });
    assert.equal(await page.locator('.hc-chat-input').inputValue(), '保留草稿', 'shell remount keeps draft');
    await page.evaluate(() => { resultStatus = 'sent'; });
    await page.locator('.hc-chat-send').click();
    await page.locator('.hc-chat-input').fill('提交期间新写的草稿');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.hc-chat-input').inputValue(), '提交期间新写的草稿');
    await page.locator('.hc-chat-send').click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.hc-chat-input').inputValue(), '');
    await page.evaluate(() => chat.destroy());
    assert.equal(await page.locator('.hc-chat-panel').count(), 0);
  } finally { await browser.close(); }
});
