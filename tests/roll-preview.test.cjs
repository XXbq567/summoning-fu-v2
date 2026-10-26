'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let api;
try { api = require('../desktop/roll-preview.js'); } catch {}

test('roll preview has an observational clock that cannot swallow its terminal frame', () => {
  assert.equal(typeof api?.RollClock, 'function');
  const clock = new api.RollClock(850);
  clock.replay(100);
  assert.equal(clock.snapshot(1000).elapsedMs, 850);
  assert.equal(clock.playing, true);
  assert.equal(clock.snapshot(1001).elapsedMs, 850);
  clock.finish(1001);
  assert.equal(clock.playing, false);
});

test('roll clock keeps half speed through paused seeks and resumes without a jump', () => {
  assert.equal(typeof api?.RollClock, 'function');
  const clock = new api.RollClock(850);
  clock.setSpeed(.5, 0); clock.replay(0);
  assert.equal(clock.snapshot(200).elapsedMs, 100);
  clock.pause(200); clock.seek(400, 300);
  assert.equal(clock.snapshot(900).elapsedMs, 400);
  clock.resume(1000);
  assert.equal(clock.snapshot(1200).elapsedMs, 500);
  assert.equal(clock.speed, .5);
});

function fixture() {
  let now = 0, callback = null, frames = 0;
  const views = [], ready = [];
  const makeView = config => {
    let resolve;
    const view = { config, frames: [], disposed: false,
      ready: new Promise(value => { resolve = value; }),
      render(frame) { this.frames.push(frame); },
      getState() { return { actualDrawCount: this.frames.filter(x => x.visible).length, canvasVisible: this.frames.at(-1)?.visible === true }; },
      dispose() { this.disposed = true; } };
    views.push(view); ready.push(resolve); return view;
  };
  const controller = new api.RollController({ durationMs: 850, makeView, now: () => now,
    requestFrame: value => { callback = value; return ++frames; }, cancelFrame: () => { callback = null; } });
  return { controller, views, ready, at(value) { now = value; }, tick(value) { now = value; const cb = callback; callback = null; cb?.(); }, pending: () => callback };
}

test('readiness starts the clock only after preparation and terminal scroll stops rendering', async () => {
  assert.equal(typeof api?.RollController, 'function');
  const f = fixture(), started = f.controller.start({ metadata: { model: 'test' }, textureMode: 'bands' });
  assert.equal(f.views[0].config.backsideInkStrength, .2, 'accepted paper-back ink is the actual default sent to the renderer');
  f.at(5000); f.ready[0](); await started;
  assert.equal(f.views[0].frames[0].elapsedMs, 0);
  f.tick(5850);
  assert.equal(f.views[0].frames.at(-1).elapsedMs, 850);
  assert.equal(f.views[0].frames.at(-1).visible, true);
  assert.equal(f.controller.evidence().phase, 'rolled');
  const count = f.views[0].frames.length;
  f.at(9000); f.controller.evidence(); f.tick(10000);
  assert.equal(f.views[0].frames.length, count);
  assert.equal(f.pending(), null);
});

test('cancel while preparing disposes resources and late readiness cannot resurrect the paper', async () => {
  assert.equal(typeof api?.RollController, 'function');
  const f = fixture(), started = f.controller.start({ textureMode: 'bands' });
  f.controller.cancel('document-hidden'); f.ready[0](); await started;
  assert.equal(f.views[0].disposed, true);
  assert.equal(f.views[0].frames.some(x => x.visible), false);
  assert.equal(f.controller.resume(), false);
  assert.equal(f.controller.evidence().phase, 'hidden');
});

test('new content fences late preparation and owns a fresh frozen generation', async () => {
  assert.equal(typeof api?.RollController, 'function');
  const f = fixture(), metadata = { model: 'first' };
  const first = f.controller.start({ metadata, textureMode: 'bands' });
  metadata.model = 'mutated';
  const second = f.controller.start({ metadata: { model: 'second' }, textureMode: 'talisman' });
  f.ready[1](); await second; f.ready[0](); await first;
  assert.equal(f.views[0].disposed, true);
  assert.equal(f.views[0].config.metadata.model, 'first');
  assert.equal(f.views[1].frames[0].elapsedMs, 0);
  assert.equal(f.controller.evidence().textureMode, 'talisman');
  assert.equal(f.views[0].frames.some(x => x.visible), false);
});

test('pause and scrubbing remain static and hide cannot resume without replay', async () => {
  assert.equal(typeof api?.RollController, 'function');
  const f = fixture(), started = f.controller.start({ textureMode: 'bands' });
  f.ready[0](); await started; f.at(200); f.controller.pause();
  f.controller.seek(600); const count = f.views[0].frames.length;
  f.tick(500);
  assert.equal(f.views[0].frames.length, count);
  assert.equal(f.controller.evidence().elapsedMs, 600);
  assert.equal(f.controller.evidence().playing, false);
  f.controller.cancel('geometry-changed');
  assert.equal(f.views[0].frames.at(-1).visible, false);
  assert.equal(f.views[0].disposed, true);
  assert.equal(f.controller.resume(), false);
});

test('every ready generation presents an exact flat frame before starting its wall clock', async () => {
  let now = 500, rendered = [];
  const controller = new api.RollController({ durationMs: 850, now: () => ++now,
    makeView: () => ({ ready: Promise.resolve(), render: frame => rendered.push(frame), getState: () => ({}), dispose() {} }),
    requestFrame: () => 1, cancelFrame() {} });
  await controller.start({ textureMode: 'bands' });
  assert.equal(rendered[0].elapsedMs, 0);
  assert.equal(rendered[0].visible, true);
  assert.equal(controller.clock.playing, true);
});

test('the isolated Electron preview starts even when default-app loading does not set require.main', () => {
  const main = require('../desktop/roll-preview-main.cjs');
  assert.equal(typeof main.shouldStartEntry, 'function');
  assert.equal(main.shouldStartEntry({ electron: '44.9.3', argv: ['electron', 'entry.cjs', '--qa-roll-preview'], isMain: false }), true);
  assert.equal(main.shouldStartEntry({ electron: '44.9.3', argv: ['electron', 'entry.cjs', '--roll-preview-only'], isMain: false }), true);
  assert.equal(main.shouldStartEntry({ electron: undefined, argv: ['node', 'test.cjs'], isMain: false }), false);
});

test('actual native hide and minimize cancel the renderer even when Page Visibility stays visible', () => {
  const { EventEmitter } = require('node:events');
  const main = require('../desktop/roll-preview-main.cjs'), win = new EventEmitter(), sent = [];
  assert.equal(typeof main.registerNativeLifecycle, 'function');
  win.isDestroyed = () => false; win.webContents = { send: (...args) => sent.push(args) };
  main.registerNativeLifecycle(win);
  win.emit('hide'); win.emit('minimize'); win.emit('show');
  assert.deepEqual(sent, [
    ['roll-preview:command', { action: 'window-hidden' }],
    ['roll-preview:command', { action: 'window-hidden' }]
  ]);
});

test('a renderer-reported context loss or lost readiness cancels without a thrown render error', async () => {
  for (const failure of [{ error: 'context-lost', materialReady: true }, { error: null, materialReady: false }]) {
    let lost = false, callback = null, now = 0, disposed = false;
    const controller = new api.RollController({ durationMs: 850, now: () => now,
      makeView: () => ({ ready: Promise.resolve(), render() {},
        getState: () => lost ? failure : { error: null, materialReady: true },
        dispose() { disposed = true; } }),
      requestFrame: value => { callback = value; return 1; }, cancelFrame: () => { callback = null; } });
    assert.equal(await controller.start({ textureMode: 'bands' }), true);
    lost = true; now = 200; const pending = callback; callback = null; pending();
    const evidence = controller.evidence();
    assert.equal(evidence.phase, 'hidden');
    assert.equal(evidence.cancelReason, 'render-failed');
    assert.equal(evidence.ready, false);
    assert.equal(evidence.playing, false);
    assert.equal(disposed, true);
    assert.equal(callback, null);
  }
});

test('a failed first paint never restarts the clock or schedules a stale frame after cancellation', async () => {
  for (const throws of [true, false]) {
    let scheduled = 0, disposed = false;
    const controller = new api.RollController({ durationMs: 850, now: () => 100,
      makeView: () => ({ ready: Promise.resolve(), render(frame) { if (throws && frame.visible) throw Error('failed-first-paint'); },
        getState: () => ({ error: throws ? null : 'context-lost', materialReady: !disposed }),
        dispose() { disposed = true; } }),
      requestFrame: () => ++scheduled, cancelFrame() {} });
    assert.equal(await controller.start({ textureMode: 'bands' }), false);
    assert.equal(controller.evidence().phase, 'hidden');
    assert.equal(controller.evidence().cancelReason, 'render-failed');
    assert.equal(controller.evidence().playing, false);
    assert.equal(controller.evidence().ready, false);
    assert.equal(scheduled, 0);
    assert.equal(disposed, true);
  }
});

test('material inspection accepts only fixed poses, strengths and diagnostic choices', () => {
  const { validateCommand } = require('../desktop/roll-preview-main.cjs');
  const request = { type: 'roll-preview:command', requestId: 'back1', action: 'material-inspect', pose: 'back', backsideInkStrength: .1, background: 'light' };
  assert.deepEqual(validateCommand(request), { requestId: 'back1', action: 'material-inspect', pose: 'back', backsideInkStrength: .1, background: 'light', shader: 'art', legacyDoublePass: false, behind: 'none', clip: 'none', innerInk: 'original' });
  for (const fields of [{ pose: 'arbitrary' }, { backsideInkStrength: '0.1' }, { backsideInkStrength: NaN }, { backsideInkStrength: .21 }, { backsideInkStrength: .15 }, { background: 'url(https://example.test)' }, { shader: 'custom' }, { legacyDoublePass: 1 }, { behind: 'image' }, { clip: 'custom' }, { innerInk: 'task' }, { path: 'C:/outside' }]) assert.equal(validateCommand({ ...request, ...fields }), null);
  for (const strength of [0, .1, .2]) assert.equal(validateCommand({ ...request, backsideInkStrength: strength }).backsideInkStrength, strength);
});

test('static material inspection owns a frozen generation and cannot start the natural rolling clock', async () => {
  const f = fixture();
  const config = { metadata: { model: 'frozen-paper' }, textureMode: 'talisman', backsideInkStrength: .1, materialInspection: { pose: 'back', shader: 'art' } };
  const started = f.controller.start(config);
  config.materialInspection.pose = 'front'; config.backsideInkStrength = .2;
  f.ready[0](); await started;
  assert.equal(f.views[0].config.materialInspection.pose, 'back');
  assert.equal(f.views[0].config.backsideInkStrength, .1);
  assert.equal(f.controller.evidence().inspectionMode, true);
  assert.equal(f.controller.evidence().playing, false);
  assert.equal(f.controller.resume(), false);
  assert.equal(f.pending(), null);
  f.at(1000); f.controller.setSpeed(.5);
  assert.equal(f.controller.evidence().playing, false);
  assert.equal(f.pending(), null);
  const normal = f.controller.start({ textureMode: 'talisman' }); f.ready[1](); await normal;
  assert.equal(f.views[0].disposed, true);
  assert.equal(f.views[1].config.materialInspection, null);
  assert.equal(f.views[1].config.backsideInkStrength, .2);
  assert.equal(f.views[1].frames[0].elapsedMs, 0);
  assert.equal(f.controller.evidence().inspectionMode, false);
  assert.equal(f.controller.evidence().playing, true);
});
