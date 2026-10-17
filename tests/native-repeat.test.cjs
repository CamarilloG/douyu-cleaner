const test = require('node:test');
const assert = require('node:assert/strict');
const { hitTest, createSender } = require('../src/native-repeat.js');

const bounds = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
function item(text, overrides = {}) {
    return {
        text, isConnected: true, querySelector: () => null,
        getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 125, width: 100, height: 25 }),
        ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1', pointerEvents: 'none' }) } },
        ...overrides
    };
}
test('native pointer-events:none danmaku is hit by geometry with text snapshot', () => {
    const original = item('这波操作太秀了');
    const selected = hitTest([original], 120, 110, el => el.text, bounds);
    original.text = '下一条';
    assert.equal(selected.text, '这波操作太秀了');
    assert.equal(hitTest([original], 700, 110, el => el.text, bounds), null);
});
test('rich content, rejected text and invisible nodes are not repeated', () => {
    assert.equal(hitTest([item('礼物', { querySelector: () => ({}) })], 120, 110, el => el.querySelector('img') ? null : el.text, bounds), null);
    assert.equal(hitTest([item('前缀')], 120, 110, () => null, bounds), null);
    assert.equal(hitTest([item('removed', { isConnected: false })], 120, 110, el => el.text, bounds), null);
    assert.equal(hitTest([item('hidden', { ownerDocument: { defaultView: { getComputedStyle: () => ({ opacity: '0' }) } } })], 120, 110, el => el.text, bounds), null);
});
test('overlapping danmaku selects the last matching visible item', () => {
    assert.equal(hitTest([item('back'), item('front')], 120, 110, el => el.text, bounds).text, 'front');
});
test('sender prevents concurrent submissions and cooldown duplicates', async () => {
    let calls = 0, now = 0, resolve;
    const sender = createSender(() => { calls++; return new Promise(r => { resolve = r; }); }, () => 'a', () => now);
    const first = sender.submit({ text: '你好', room: 'a' });
    now = 5000;
    assert.equal((await sender.submit({ text: '你好', room: 'a' })).status, 'failed');
    resolve({ status: 'submitted' });
    assert.equal((await first).status, 'submitted');
    assert.equal(calls, 1);
});
test('sender rejects room changes, destroy and immediate repeated clicks', async () => {
    let calls = 0, room = 'a', now = 0;
    const sender = createSender(async () => { calls++; return { status: 'sent' }; }, () => room, () => now);
    assert.equal((await sender.submit({ text: '你好', room: 'a' })).status, 'sent');
    assert.equal((await sender.submit({ text: '你好', room: 'a' })).status, 'failed');
    now = 2000; room = 'b';
    assert.equal((await sender.submit({ text: '你好', room: 'a' })).status, 'failed');
    sender.destroy();
    assert.equal((await sender.submit({ text: '你好', room: 'b' })).status, 'failed');
    assert.equal(calls, 1);
});
test('unknown send outcome remains submitted and failures never auto retry', async () => {
    assert.deepEqual(await createSender(async () => undefined, () => 'a').submit({ text: 'hi', room: 'a' }), { status: 'submitted', message: '已提交，请查看原站发送结果' });
    let calls = 0;
    const sender = createSender(async () => { calls++; throw new Error('offline'); }, () => 'a');
    assert.equal((await sender.submit({ text: 'hi', room: 'a' })).status, 'failed');
    assert.equal(calls, 1);
});
