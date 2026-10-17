// Fully offline browser acceptance fixture; no request can reach a live room.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(__dirname, 'huya-shell.fixture.html'), 'utf8');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto('https://www.huya.com/fixture-room');
    for (const file of ['native-repeat.js', 'huya-chat.js', 'huya.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'src', file), 'utf8') });
    }
    await page.locator('#hc-shell').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.querySelector('#hc-video-host video') === officialVideo), true);
    assert.equal(await page.evaluate(() => document.querySelector('#hc-video-host #danmudiv') === officialDanmaku), true);
    const layout = await page.evaluate(() => {
      const box = id => { const r = document.querySelector(id).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
      return {shell:box('#hc-shell'),video:box('#hc-video-host'),chat:box('#hc-chat-host')};
    });
    assert.ok(layout.video.width > 900 && layout.chat.width >= 250, JSON.stringify(layout));
    assert.ok(layout.video.right <= layout.chat.x + 2, JSON.stringify(layout));
    assert.ok(layout.shell.bottom <= 901 && layout.shell.y >= 0, JSON.stringify(layout));

    const control = act => page.locator(`#hc-controlbar [data-act="${act}"]`);
    // Real-site regression: a transparent-to-input white activity iframe covers the video.
    const extension = page.locator('#player-ext-wrap');
    const extensionUnder = page.locator('#player-ext-wrap-under-barrage');
    assert.equal(await extension.isVisible(), false);
    assert.equal(await extensionUnder.isVisible(), false);
    await control('settings').click();
    await page.locator('[data-setting="activities"]').uncheck();
    assert.equal(await extension.isVisible(), true);
    assert.equal(await extensionUnder.isVisible(), true);
    assert.equal(await extension.locator('iframe').isVisible(), false);
    await page.locator('[data-setting="activities"]').check();
    assert.equal(await extension.isVisible(), false);
    assert.equal(await extensionUnder.isVisible(), false);
    await page.locator('#hc-buffer-target').fill('4.5');
    await page.locator('#hc-buffer-target').dispatchEvent('change');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#hc-settings').isVisible(), false);

    // The official mouse layer stops bubbling. Capture must still wake an idle toolbar.
    await page.evaluate(() => document.activeElement.blur());
    await page.mouse.move(600, 300);
    await page.waitForFunction(() => document.querySelector('#hc-shell').classList.contains('hc-idle'));
    const movesBeforeWake = await page.evaluate(() => nativePointerMoves);
    await page.mouse.move(610, 310);
    await page.waitForFunction(() => !document.querySelector('#hc-shell').classList.contains('hc-idle'));
    assert.ok(await page.evaluate(() => nativePointerMoves) > movesBeforeWake);

    await control('play').click();
    assert.equal(await page.evaluate(() => playCount), 1);
    await control('play').click();
    assert.equal(await page.evaluate(() => pauseCount), 1);
    await page.locator('#hc-volume').evaluate(el => { el.value = String(Number(el.max) * 0.4); el.dispatchEvent(new Event('input', {bubbles:true})); });
    assert.ok(Math.abs(await page.evaluate(() => officialVideo.volume) - 0.4) < 0.01);
    await control('mute').click();
    assert.equal(await page.evaluate(() => officialVideo.muted), true);
    await control('mute').click();
    assert.equal(await page.evaluate(() => officialVideo.muted), false);
    await control('chat').click();
    assert.match(await page.locator('#hc-shell').getAttribute('class'), /hc-chat-collapsed/);
    await control('chat').click();
    assert.doesNotMatch(await page.locator('#hc-shell').getAttribute('class') || '', /hc-chat-collapsed/);
    await control('fullscreen').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await page.evaluate(() => document.fullscreenElement.contains(officialVideo)), true);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.locator('#official-mouse-layer').dblclick({position:{x:300,y:300}});
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);

    const composer = page.locator('#hc-chat-host textarea, #hc-chat-host input[type="text"]').first();
    await composer.fill('输入时不触发快捷键');
    const playsBeforeTyping = await page.evaluate(() => playCount);
    await composer.press('Space');
    await composer.press('KeyM');
    assert.equal(await page.evaluate(() => playCount), playsBeforeTyping);
    assert.equal(await page.evaluate(() => officialVideo.muted), false);
    await composer.evaluate(el => el.blur());
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => playCount), playsBeforeTyping + 1);

    // Watch genuine native list mutations; user identities are kept distinct.
    await page.evaluate(() => {
      const item = document.createElement('div'); item.dataset.cmid = 'fixture-2';
      item.innerHTML = '<div class="msg-normal"><span class="name J_userMenu">观众乙</span><span class="colon">:</span><span class="msg J_msg">新评论来了</span></div>';
      document.querySelector('#chat-room__list').append(item);
    });
    await page.locator('#hc-chat-host').getByText('新评论来了', {exact:true}).waitFor();
    assert.match(await page.locator('#hc-chat-host').innerText(), /观众乙/);
    await composer.fill('离线发送测试');
    await composer.press('Enter');
    await page.waitForFunction(() => sentMessages.length === 1);
    assert.deepEqual(await page.evaluate(() => sentMessages), ['离线发送测试']);

    // +1 belongs to the native flying message and preserves the mirrored composer draft.
    await composer.fill('我还在写的草稿');
    const danmakuRect = await page.locator('#danmudiv .danmu-item').boundingBox();
    await page.mouse.move(danmakuRect.x + 10, danmakuRect.y + 8);
    const repeat = page.locator('.lc-native-repeat-layer button');
    await repeat.waitFor({state:'visible'});
    await repeat.click();
    await page.waitForFunction(() => sentMessages.length === 2);
    assert.deepEqual(await page.evaluate(() => sentMessages), ['离线发送测试', '原生视频弹幕']);
    assert.equal(await composer.inputValue(), '我还在写的草稿');
    assert.equal(await page.locator('#hc-chat-host .lc-native-repeat-layer').count(), 0);
    fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
    await page.screenshot({path:path.join(root, 'test-results', 'huya-shell-fixture.png')});

    // Restore must preserve the same player and original sibling order.
    await control('settings').click();
    await page.locator('#hc-settings [data-act="restore"]').click();
    await page.waitForFunction(() => !document.querySelector('#hc-shell'));
    assert.equal(await page.evaluate(() => officialPlayer.parentElement.id), 'original-player-parent');
    assert.equal(await page.evaluate(() => officialPlayer.nextElementSibling.id), 'after-player');
    assert.equal(await page.evaluate(() => document.querySelector('video') === officialVideo), true);
    assert.equal(await extension.isVisible(), true);
    assert.equal(await extensionUnder.isVisible(), true);
    assert.equal(await extension.locator('iframe').isVisible(), true);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#hc-shell').count(), 0);

    // A fresh visit remounts once; SPA navigation away cancels the shell and observers.
    await page.reload();
    for (const file of ['native-repeat.js', 'huya-chat.js', 'huya.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'src', file), 'utf8') });
    // Enable again if restoration is persisted by the adapter.
    if (!await page.locator('#hc-shell').count()) {
      const enable = page.getByRole('button', {name:/启用|开启|极简/}).first();
      if (await enable.count()) await enable.click();
    }
    await page.locator('#hc-shell').waitFor();
    assert.ok(Math.abs(await page.evaluate(() => officialVideo.volume) - 0.4) < 0.01);
    assert.equal(await page.evaluate(() => officialVideo.muted), false);
    assert.equal(await page.locator('#hc-buffer-target').inputValue(), '4.5');
    await composer.fill('切房间时应取消发送');
    await page.evaluate(() => {
      document.querySelector('#hc-chat-host textarea, #hc-chat-host input[type="text"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      history.pushState({}, '', '/g/fixture'); window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForFunction(() => !document.querySelector('#hc-shell'));
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => sentMessages), []);
    assert.equal(await page.locator('#pub_msg_input').inputValue(), '');
    assert.equal(await page.evaluate(() => officialPlayer.parentElement.id), 'original-player-parent');
    assert.equal(await page.locator('.lc-native-repeat-layer').count(), 0);

    // The site can rebuild the player in the same room while the old node lives in our shell.
    await page.evaluate(() => { history.pushState({}, '', '/fixture-room2'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.locator('#hc-shell').waitFor();
    await page.evaluate(() => {
      const fresh = document.createElement('div'); fresh.id = 'J_playerMain';
      fresh.innerHTML = '<div id="player-wrap"><video id="hy-video"></video><div id="danmudiv"><div class="danmu-item"><span>重建后的官方弹幕</span></div></div></div>';
      window.replacementPlayer = fresh;
      document.querySelector('#after-player').before(fresh);
    });
    await page.waitForFunction(() => replacementPlayer.parentElement?.id === 'hc-video-host');
    assert.equal(await page.locator('#J_playerMain').count(), 1);
    assert.equal(await page.locator('#hc-shell').count(), 1);
    assert.equal(await page.evaluate(() => officialPlayer.isConnected), false);
    assert.deepEqual(errors, []);
    console.log('Huya shell offline acceptance passed: original media nodes, full layout, controls, fullscreen, shortcuts, chat mirroring, send bridge, restore, SPA cleanup and native player replacement.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
