const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/huya.js', 'utf8');
const method = source.slice(source.indexOf('  async function send('), source.indexOf('  function apply('));
function fixture() {
  let clicks = 0;
  const input = { value: '', maxLength: 30, isConnected: true, isContentEditable: false };
  const button = { isConnected: true, classList: { contains: () => false }, getAttribute: () => null, click: () => { clicks++; } };
  const state = { key: '/wanmei', player: { isConnected: true } };
  const context = { active: state, roomKey: () => context.path, path: '/wanmei', findComposer: () => context.composer, composer: { input, button }, setValue: (el, value) => { el.value = value; }, setTimeout };
  const send = vm.runInNewContext(`${method};send`, context);
  return { input, button, context, state, clicks: () => clicks, send: text => send(text, state) };
}
test('Huya refuses existing official draft without touching it', async () => {
  const f = fixture(); f.input.value = '正在写';
  assert.equal((await f.send('复读')).status, 'failed');
  assert.equal(f.input.value, '正在写'); assert.equal(f.clicks(), 0);
});
test('Huya submission leaves content for asynchronous official reader', async () => {
  const f = fixture(); let read;
  f.button.click = () => { setTimeout(() => { read = f.input.value; }, 5); };
  assert.equal((await f.send('复读')).status, 'submitted');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(read, '复读'); assert.equal(f.input.value, '复读');
});
test('Huya room change cancels and withdraws own pending content', async () => {
  const f = fixture(); const pending = f.send('复读'); f.context.path = '/660000';
  assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.input.value, '');
});
test('Huya preserves user edits during input delay', async () => {
  const f = fixture(); const pending = f.send('复读'); f.input.value = '用户改写';
  assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.input.value, '用户改写');
});
test('Huya settings change cancels pending send', async () => {
  const f = fixture(); const pending = f.send('复读'); f.state.revision = 1;
  assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.input.value, '');
});
test('Huya rechecks composer replacement and disabled state before click', async () => {
  for (const replace of [true, false]) {
    const f = fixture(); const pending = f.send('复读');
    if (replace) f.context.composer = null; else f.button.disabled = true;
    assert.equal((await pending).status, 'failed'); assert.equal(f.clicks(), 0); assert.equal(f.input.value, '');
  }
});
test('Huya refuses unavailable or overlength composer', async () => {
  const f = fixture(); assert.equal((await f.send('长'.repeat(31))).status, 'failed');
  f.context.composer = null; assert.equal((await f.send('复读')).status, 'failed'); assert.equal(f.clicks(), 0);
});
