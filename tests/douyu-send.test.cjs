const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('douyu-cleaner.user.js', 'utf8');
const sendMethod = source.slice(source.indexOf('        async send(text) {'), source.indexOf('        destroy() {', source.indexOf('        async send(text) {')));
function fixture() {
    let clicks = 0;
    const native = { textContent: '', isConnected: true, focus() {}, dispatchEvent() {}, getAttribute(key) { return key === 'maxlength' ? '50' : 'true'; } };
    const button = { isConnected: true, disabled: false, getAttribute() { return null; }, click() { clicks++; } };
    const location = { pathname: '/9999' };
    const context = { location, roomEpoch: 0, CFG: { SEL_CHAT_INPUT: '.input', SEL_CHAT_SEND: '.send' }, setTimeout, InputEvent: class {}, window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }, document: { activeElement: null, querySelector: sel => sel === '.input' ? native : button, createRange: () => ({ selectNodeContents() {} }), execCommand: (_, __, text) => { native.textContent = text; return true; } } };
    const panel = vm.runInNewContext(`({${sendMethod}})`, context);
    Object.assign(panel, { destroyed: false, epoch: 0, roomKey: '/9999', sending: false, sendBtn: { disabled: false }, inputEl: { value: '我的草稿' }, _toast() {} });
    return { panel, native, button, location, clicks: () => clicks };
}
test('repeat submits once, preserves custom draft, never claims sent', async () => {
    const f = fixture();
    const pending = f.panel.send('这条弹幕');
    assert.equal((await f.panel.send('另一条')).status, 'failed');
    assert.equal((await pending).status, 'submitted');
    assert.equal(f.clicks(), 1);
    assert.equal(f.panel.inputEl.value, '我的草稿');
});
test('native draft is never overwritten', async () => {
    const f = fixture(); f.native.textContent = '官方草稿';
    assert.equal((await f.panel.send('复读')).status, 'failed');
    assert.equal(f.native.textContent, '官方草稿'); assert.equal(f.clicks(), 0);
});
test('room switch during React input delay cancels click', async () => {
    const f = fixture(); const pending = f.panel.send('复读'); f.location.pathname = '/123';
    assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.native.textContent, '');
});
test('user editing pending input cancels without erasing new draft', async () => {
    const f = fixture(); const pending = f.panel.send('复读'); f.native.textContent = '用户改写';
    assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.native.textContent, '用户改写');
});
test('disabled and overlength input do not submit', async () => {
    const f = fixture(); f.button.disabled = true;
    assert.equal((await f.panel.send('复读')).status, 'failed'); f.button.disabled = false;
    assert.equal((await f.panel.send('字'.repeat(51))).status, 'failed'); assert.equal(f.clicks(), 0);
});
