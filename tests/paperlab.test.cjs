'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('material sequence finishes the paper before ink and gives complete text exactly two seconds', () => {
  const { frameAt, timings } = require('../renderer/entrance-timeline.js');
  assert.equal(timings.paperEndMs, 1950);
  assert.equal(frameAt(1949).writing, 0);
  assert.equal(frameAt(1950).writing, 0);
  assert.equal(frameAt(4150).writing, 1);
  for (const t of [4150, 5000, 6149]) {
    assert.equal(frameAt(t).phase, 'hold');
    assert.equal(frameAt(t).needsAnimation, false);
  }
  assert.equal(timings.leaveAtMs-timings.holdStartMs,2000);
  assert.equal(frameAt(6150).phase, 'hidden');
  assert.equal(frameAt(6150).burn, 0);
  assert.equal(frameAt(6150).visualFireActive, false);
  assert.equal(frameAt(6150).paperOpacity, 0);
  assert.equal(frameAt(6150).visible, false);
});

function controller() {
  const file = path.resolve(__dirname, '../renderer/paperlab-session.js');
  assert.ok(fs.existsSync(file), 'the shared material lifecycle controller must exist');
  return require(file);
}

test('late material preparation applies only the latest frame and disposal cannot resurrect it', async () => {
  const { createSession } = controller();
  let finish, draws = [], released = 0;
  const session = createSession(() => new Promise(resolve => { finish = resolve; }), { metadataHash: '1234abcd' });
  await Promise.resolve();
  session.render({ phase: 'travel', visible: true });
  session.render({ phase: 'hidden', visible: false });
  finish({ render: f => draws.push(f.phase), dispose: () => released++, getState: () => ({ materialReady: true }) });
  await session.ready;
  assert.deepEqual(draws, ['hidden']);
  session.dispose(); session.dispose();
  session.render({ phase: 'travel', visible: true });
  assert.equal(released, 1);
  assert.deepEqual(draws, ['hidden']);
  assert.equal(session.getState().error, 'disposed');
  assert.ok(Object.isFrozen(session.getState()));
});

test('replacement during texture decoding releases the late engine without a draw', async () => {
  const { createSession } = controller();
  let finish, released = 0, draws = 0;
  const session = createSession(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  session.render({ phase: 'travel', visible: true }); session.dispose();
  finish({ render: () => draws++, dispose: () => released++, getState: () => ({ materialReady: true }) });
  await assert.rejects(session.ready, /disposed/);
  assert.equal(draws, 0); assert.equal(released, 1);
});

test('preparation errors are bounded evidence and never a silent fallback', async () => {
  const { createSession } = controller();
  const session = createSession(async () => { throw Object.assign(new Error('private browser detail'), { code: 'texture-failed' }); });
  await assert.rejects(session.ready);
  assert.equal(session.getState().error, 'texture-failed');
  assert.equal(JSON.stringify(session.getState()).includes('private'), false);
});

test('actual published DamageField consumes paper monotonically and recorded seeking is deterministic', async () => {
  const { DamageField } = await import('paperlab/fx');
  const { bakeBurn, sampleBurn } = require('../renderer/paperlab-damage.js');
  const recording = bakeBurn(DamageField);
  assert.equal(recording.frames[0].remaining, 1);
  assert.equal(recording.frames.at(-1).remaining, 0);
  let previous = 1;
  for (const frame of recording.frames) { assert.ok(frame.remaining <= previous + 1e-6); previous = frame.remaining; }
  const source = { pixels: new Uint8Array(64 * 64 * 4), version: 0 };
  const middle = sampleBurn(recording, .5, source), pixels = source.pixels.slice();
  assert.ok(middle > 0 && middle < 1);
  sampleBurn(recording, 1, source);
  assert.ok(source.pixels.every((value, index) => index % 4 !== 3 || value === 0), 'all paper and ink share zero presence at the end');
  sampleBurn(recording, .5, source); assert.deepEqual(source.pixels, pixels);
  sampleBurn(recording, 0, source); assert.equal(source.pixels[3], 255);
});
