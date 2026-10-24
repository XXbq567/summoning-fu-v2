'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const host = require('../desktop/host-state.cjs');
const Delivery = require('../renderer/delivery-motion.js');
const Entrance = require('../renderer/entrance-timeline.js');
const geometry = { originRect: { x: 170, y: 640, width: 8, height: 8 }, targetRect: { x: 56, y: 56, width: 320, height: 676 } };
const target = (source = 'supported-host-adapter') => ({ targetId: 'explicit-target', revision: 1, rect: { x: 600, y: 450, width: 90, height: 70 }, coordinateSpace: 'overlay-local-dip', source, valid: true, visible: true, observedAtMonotonicMs: 100000, expiresAtMonotonicMs: 120000 });

test('formal target bridge rejects preview examples and translates a source lease into the receiving clock', () => {
  const bridge = new host.DeliveryTargetBridge();
  assert.equal(bridge.receive(target('preview-example'), { sourceNowMs: 100100, receivedAtMs: 50 }), false);
  assert.equal(bridge.targetAt(50), null);
  assert.equal(bridge.receive({ ...target(), coordinateSpace: 'physical-screen-px' }, { sourceNowMs: 100100, receivedAtMs: 50 }), false);
  assert.equal(bridge.receive(target(), { sourceNowMs: 100100, receivedAtMs: 50 }), true);
  const accepted = bridge.targetAt(50);
  assert.equal(accepted.observedAtMonotonicMs, -50); assert.equal(accepted.expiresAtMonotonicMs, 19950);
  assert.equal(Delivery.validateTarget(accepted, { nowMs: 50 }), true);
});

test('a frozen target path tolerates jitter but movement, hidden state or expiry cannot revive that generation', () => {
  for (const invalidation of ['move', 'hide', 'expire']) {
    const bridge = new host.DeliveryTargetBridge();
    bridge.receive(target(), { sourceNowMs: 100100, receivedAtMs: 50 });
    const plan = bridge.freezePlan(geometry, 50); assert.ok(plan);
    const jitter = { ...target(), revision: 2, observedAtMonotonicMs: 100200, rect: { ...target().rect, x: 604 } };
    bridge.receive(jitter, { sourceNowMs: 100200, receivedAtMs: 150 });
    assert.equal(bridge.freezePlan(geometry, 150), plan);
    if (invalidation === 'move') bridge.receive({ ...target(), revision: 3, observedAtMonotonicMs: 100300, rect: { ...target().rect, x: 640 } }, { sourceNowMs: 100300, receivedAtMs: 250 });
    if (invalidation === 'hide') bridge.receive({ ...target(), revision: 3, observedAtMonotonicMs: 100300, visible: false }, { sourceNowMs: 100300, receivedAtMs: 250 });
    if (invalidation === 'expire') bridge.targetAt(20000);
    assert.equal(bridge.cancelled, true);
    bridge.receive({ ...target(), revision: 4, observedAtMonotonicMs: 100400 }, { sourceNowMs: 100400, receivedAtMs: 20100 });
    assert.equal(bridge.freezePlan(geometry, 20100), null);
    bridge.beginGeneration(); assert.ok(bridge.freezePlan(geometry, 20100));
  }
});
test('late target revisions and old source observations cannot replace or cancel a current path', () => {
  const bridge = new host.DeliveryTargetBridge();
  bridge.receive({ ...target(), revision: 2, observedAtMonotonicMs: 100200 }, { sourceNowMs: 100200, receivedAtMs: 100 });
  const plan = bridge.freezePlan(geometry, 100), current = bridge.targetAt(100);
  for (const old of [{ ...target(), revision: 1, visible: false }, { ...target(), revision: 3, observedAtMonotonicMs: 100100, rect: { ...target().rect, x: 900 } }]) {
    assert.equal(bridge.receive(old, { sourceNowMs: 100300, receivedAtMs: 200 }), false);
    assert.equal(bridge.targetAt(200), current); assert.equal(bridge.freezePlan(geometry, 200), plan); assert.equal(bridge.cancelled, false);
  }
});

test('delivery layout rebases the complete motion union once without moving the screen paper or target', () => {
  const layout = { bounds: { x: 300, y: 250, width: 432, height: 788 }, geometry };
  const live = { ...target(), observedAtMonotonicMs: 0, expiresAtMonotonicMs: 30000 };
  const result = host.rebaseDeliveryLayout(layout, live, { nowMs: 100, workArea: { x: -1000, y: -500, width: 3000, height: 2200 } });
  assert.ok(result);
  for (const key of ['originRect', 'targetRect']) for (const axis of ['x', 'y']) assert.equal(result.bounds[axis] + result.geometry[key][axis], layout.bounds[axis] + geometry[key][axis]);
  for (const axis of ['x', 'y']) assert.equal(result.bounds[axis] + result.deliveryTarget.rect[axis], layout.bounds[axis] + live.rect[axis]);
  const union = Delivery.canvasBounds(result.deliveryPlan, { x: 0, y: 0, width: result.bounds.width, height: result.bounds.height });
  assert.ok(union.x >= 0 && union.y >= 0 && union.x + union.width <= result.bounds.width && union.y + union.height <= result.bounds.height);
  assert.equal(host.rebaseDeliveryLayout(layout, live, { nowMs: 100, workArea: { x: 0, y: 0, width: 600, height: 400 } }), null);
});

test('preview delivery freezes only at departure and cancels permanently on target loss', () => {
  const { PreviewDeliveryRun } = require('../desktop/motion-preview.js');
  const live = { ...target('preview-example'), observedAtMonotonicMs: 0, expiresAtMonotonicMs: 30000 };
  const run = new PreviewDeliveryRun(geometry);
  assert.equal(run.sample(Entrance.timings.leaveAtMs - 1, live, 100).phase, 'hold');
  assert.equal(run.plan, null);
  assert.equal(run.sample(Entrance.timings.leaveAtMs, live, 100).phase, 'folding');
  const plan = run.plan;
  run.sample(Entrance.timings.leaveAtMs + 700, { ...live, rect: { ...live.rect, x: live.rect.x + 3 } }, 200);
  assert.equal(run.plan, plan);
  assert.equal(run.sample(Entrance.timings.leaveAtMs + 800, { ...live, visible: false }, 300).visible, false);
  assert.equal(run.sample(0, live, 301).visible, false);
  assert.equal(run.cancelled, true);
  const empty = new PreviewDeliveryRun(geometry);
  assert.equal(empty.sample(Entrance.timings.leaveAtMs, null, 100).visible, false);
  assert.equal(empty.reason, 'target-unavailable');
});

async function previewFixture({ delayed = false } = {}) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let now = 1000, command, advanceOnRender = 0;
  const frames = [], reports = [], listeners = {}, resolvers = [];
  const rects = { stage: { x: 0, y: 0, width: 800, height: 700 }, 'preview-paper': { x: 260, y: 40, width: 240, height: 240 * 760 / 360 }, 'example-send': { x: 700, y: 650, width: 60, height: 30 }, 'preview-target': { x: 680, y: 400, width: 80, height: 70 } };
  const element = id => ({ id, style: {}, hidden: false, disabled: false, dataset: {}, value: '1', parentElement: null, addEventListener(name, fn) { listeners[id + ':' + name] = fn; }, getBoundingClientRect() { const rect = rects[id] || { x: 0, y: 0, width: 300, height: 600 }; return { ...rect, x: this.style.left === undefined ? rect.x : Number.parseFloat(this.style.left), y: this.style.top === undefined ? rect.y : Number.parseFloat(this.style.top) }; }, getAttribute: () => 0, setPointerCapture() {}, releasePointerCapture() {} });
  const elements = Object.fromEntries(['stage', 'preview-paper', 'preview-progress', 'preview-time', 'preview-stage', 'preview-policy', 'preview-source', 'preview-error', 'pause-preview', 'preview-speed', 'example-send', 'preview-target', 'preview-target-note'].map(id => [id, element(id)]));
  elements['example-send'].dataset.preview = 'replay';
  const document = { hidden: false, fonts: { ready: Promise.resolve() }, addEventListener(name, fn) { listeners['document:' + name] = fn; }, querySelector: selector => elements[selector === '.preview-stage' ? 'stage' : selector.slice(1)] || null, querySelectorAll: selector => selector === '[data-preview]' ? [elements['example-send']] : selector === 'button' ? [elements['example-send'], elements['pause-preview'], elements['preview-target']] : [] };
  class View {
    constructor() { this.svg = element('svg'); this.svg.querySelectorAll = () => []; this.svg.querySelector = () => null; this.setMetadata(); }
    setMetadata() { this.ready = delayed ? new Promise(resolve => resolvers.push(resolve)) : Promise.resolve(); }
    render(frame) { frames.push(frame); now += advanceOnRender; advanceOnRender = 0; }
    dispose() {}
  }
  const sandbox = { document, performance: { now: () => now }, getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: element.style.visibility || 'visible', opacity: '1' }), matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener(name, fn) { listeners['window:' + name] = fn; }, setInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    RitualEntrance: Entrance, RitualDelivery: Delivery, RitualBurn: { BurnView: View }, fuPreview: { initial: async () => ({ qaOnly: true, source: 'example', metadata: {}, coverage: {} }), subscribe(fn) { command = fn; }, report(value) { reports.push(value); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/motion-preview.js'), 'utf8'), sandbox);
  const flush = () => new Promise(resolve => setImmediate(resolve)); await flush();
  return { frames, reports, listeners, elements, document, resolvers, flush, command(action) { now += 200; command(action); }, advance(ms) { now += ms; }, crossDeadlineDuringRender(ms) { advanceOnRender = ms; } };
}

test('actual preview controller clears moved targets and cannot resume a cancelled flight', async () => {
  const f = await previewFixture(); f.command('folding');
  assert.equal(f.frames.at(-1).phase, 'folding');
  f.command('target-move'); assert.equal(f.frames.at(-1).visible, false);
  const count = f.frames.length; f.command('resume'); assert.equal(f.frames.at(-1).visible, false);
  assert.equal(f.reports.at(-1).playing, false); assert.equal(f.frames.length, count);
  f.command('replay'); assert.equal(f.frames.at(-1).visible, true);
});

test('a hidden preview rejects late material readiness and showing it never revives the old generation', async () => {
  const f = await previewFixture({ delayed: true });
  f.document.hidden = true; f.listeners['document:visibilitychange']();
  f.resolvers[0](); await f.flush();
  f.document.hidden = false; f.listeners['document:visibilitychange']();
  assert.equal(f.frames.some(frame => frame.visible), false);
  f.command('replay'); f.resolvers.at(-1)(); await f.flush();
  assert.equal(f.frames.at(-1).visible, true);
});

test('changing speed after a cancelled run changes the next replay without reviving the old run', async () => {
  const f = await previewFixture(); f.command('stop');
  const count = f.frames.length; f.command('speed-0.5');
  assert.equal(f.frames.length, count);
  f.command('replay'); f.advance(1000); f.command('pause');
  assert.equal(f.reports.at(-1).elapsedMs, 600);
});

test('a draw that crosses the clock deadline still renders terminal hidden once and stops', async () => {
  const f = await previewFixture(); f.command('intake-tail');
  assert.equal(f.frames.at(-1).phase, 'intake');
  f.crossDeadlineDuringRender(1000); f.command('resume');
  assert.equal(f.frames.at(-1).phase, 'hidden'); assert.equal(f.frames.at(-1).visible, false);
  assert.equal(f.reports.at(-1).playing, false);
  const count = f.frames.length; f.command('resume'); assert.equal(f.frames.length, count);
});

test('partial intake chapters really straddle the intake plane at two distinct positions', () => {
  const { deliveryChapterElapsed } = require('../desktop/motion-preview.js');
  const live = { ...target('preview-example'), observedAtMonotonicMs: 0, expiresAtMonotonicMs: 30000 };
  const plan = Delivery.createPlan(geometry, live, { nowMs: 100, allowPreviewTarget: true });
  const times = ['intake-tip', 'intake-tail'].map(action => deliveryChapterElapsed(plan, action));
  assert.ok(times[0] < times[1]);
  for (const time of times) {
    const state = Delivery.sample(plan, time - Entrance.timings.leaveAtMs);
    assert.ok(state.leadingPoint.y > state.clip.point.y && state.trailingPoint.y < state.clip.point.y);
  }
});

test('delivery preview IPC is fixed and telemetry rejects unbounded values without forwarding arbitrary payloads', () => {
  for (const command of ['folding', 'flying', 'intake', 'intake-tip', 'intake-tail', 'target-near', 'target-far', 'target-left', 'target-right', 'target-move', 'target-hide']) assert.equal(host.previewCommandAllowed(command), true);
  assert.equal(host.previewCommandAllowed('target=real-pet'), false);
  const value = { engine: 'paperlab', libraryVersion: '0.8.1', materialReady: true, canvasVisible: true, actualDrawCount: 2, actualClearCount: 1, phase: 'intake', writing: 1, burn: 0, presenceRemaining: 1, damageVersion: 0, metadataHash: '12345678', textureHash: '12345678', textureRasterizations: 1, error: null,
    deliveryPhase: 'intake', foldBottom: 1, foldMiddle: 1, flightProgress: 1, intakeProgress: .5, deliveryTargetId: 'preview-example-target', deliveryTargetValid: true, deliveryClipped: true, intakeLeadingY: 40, intakeTrailingY: 10, intakePlaneY: 30, secret: 'never-forward' };
  const result = host.sanitizePaperlabEvidence(value);
  assert.ok(result); assert.equal(result.actualClearCount, 1); assert.equal(result.intakeLeadingY, 40); assert.equal(result.secret, undefined);
  for (const patch of [{ intakeProgress: 2 }, { actualClearCount: -1 }, { intakeLeadingY: Infinity }, { deliveryTargetId: '<script>' }, { deliveryTargetValid: 'yes' }]) assert.equal(host.sanitizePaperlabEvidence({ ...value, ...patch }), null);
});

test('the actual renderer getState closure and session wrapper pass the complete preview evidence boundary', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.resolve(__dirname, '../renderer/paperlab-entry.jsx'), 'utf8');
  const expression = source.match(/const getState = (\(\) => \([\s\S]*?\));/)[1];
  const getState = vm.runInNewContext('(' + expression + ')', { materialReady: true, canvasVisible: true, draws: 3, clears: 1, error: null, art: { metadataHash: '12345678', textureHash: '12345678' },
    activePlan: { target: { targetId: 'preview-example-target' } }, deliveryState: { phase: 'intake', foldBottom: 1, foldMiddle: 1, travel: 1, intake: .5, clip: { enabled: true, point: { y: 30 } }, leadingPoint: { y: 40 }, trailingPoint: { y: 10 } } });
  const session = require('../renderer/paperlab-session.js').createSession(async () => ({ getState, render() {}, dispose() {} }));
  await session.ready; session.render({ phase: 'intake', writing: 1, burn: 0 });
  const result = host.sanitizePreviewEvidence({ paperlab: session.getState(), generation: 1, elapsedMs: 7900, phase: 'intake', playing: true, documentHidden: false, systemReducedMotion: false, effectiveReducedMotion: false,
    renderCount: 3, rafCount: 2, visibleGlyphs: 50, totalGlyphs: 50, paperOpacity: 0, opacity: 0, writing: 1, burn: 0, holdStartMs: 4150, leaveAtMs: 6150, hideAtMs: 8250, svgVisible: false, cancellationReason: 'none' });
  assert.ok(result); assert.equal(result.paperlab.deliveryTargetValid, true); assert.equal(result.paperlab.actualClearCount, 1);
});

test('native pet preserves one plan across IPC copies, projects host time and never revives an invalidated run', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let now = 50000, update; const frames = [], listeners = {}, invalidations = [];
  const live = { ...target(), observedAtMonotonicMs: 0, expiresAtMonotonicMs: 10000 };
  const plan = Delivery.createPlan(geometry, live, { nowMs: 1000 });
  const value = { runId: 'formal-run', presentationToken: 1, presentationPreparing: false, metadata: {}, geometry, deliveryPlan: plan, deliveryTarget: live, presentationNowMs: 1000, elapsedMs: 6150, hidden: false, visible: true, state: 'unknown' };
  const document = { hidden: false, querySelector: () => ({ style: {} }), addEventListener(name, fn) { listeners[name] = fn; } };
  class View { constructor() { this.ready = Promise.resolve(); } render(frame) { frames.push(frame); } }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/pet.js'), 'utf8'), { document, matchMedia: () => ({ matches: false, addEventListener() {} }), performance: { now: () => now }, setInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, RitualEntrance: Entrance, RitualBurn: { BurnView: View },
    fuHost: { subscribe(fn) { update = fn; }, initial: async () => ({ coverage: {}, snapshot: value }), reportReady() {}, reportRender() {}, reportInvalidation(value) { invalidations.push(value); } } });
  const flush = () => new Promise(resolve => setImmediate(resolve)); await flush();
  assert.equal(frames.at(-1).phase, 'folding'); const first = frames.at(-1).delivery.plan;
  now += 100; update(JSON.parse(JSON.stringify({ ...value, elapsedMs: 6250, presentationNowMs: 1100 })));
  assert.equal(frames.at(-1).delivery.plan, first);
  now += 100; update({ ...value, deliveryTarget: { ...live, visible: false }, elapsedMs: 6350, presentationNowMs: 1200 });
  assert.equal(frames.at(-1).visible, false);
  update({ ...value, elapsedMs: 6351, presentationNowMs: 1201 }); assert.equal(frames.at(-1).visible, false);
  assert.equal(invalidations.at(-1).reason, 'target-changed');
});

test('native hide before the terminal IPC copy distinguishes natural expiry from an early hide without reviving either', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  for (const withTarget of [false, true]) for (const natural of [true, false]) {
    let now = 50000, update; const frames = [], listeners = {}, invalidations = [];
    const live = { ...target(), observedAtMonotonicMs: 0, expiresAtMonotonicMs: 20000 };
    const plan = withTarget ? Delivery.createPlan(geometry, live, { nowMs: 1000 }) : null;
    const end = Entrance.timings.leaveAtMs + (plan?.durationMs || 0);
    const value = { runId: 'native-hide-run', presentationToken: 1, presentationPreparing: false, metadata: {}, geometry, deliveryPlan: plan, deliveryTarget: withTarget ? live : null, presentationNowMs: 1000, elapsedMs: end - 100, hidden: false, visible: true, state: 'unknown' };
    const document = { hidden: false, querySelector: () => ({ style: {} }), addEventListener(name, fn) { listeners[name] = fn; } };
    class View { constructor() { this.ready = Promise.resolve(); } render(frame) { frames.push(frame); } }
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/pet.js'), 'utf8'), { document, matchMedia: () => ({ matches: false, addEventListener() {} }), performance: { now: () => now }, setInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, RitualEntrance: Entrance, RitualBurn: { BurnView: View },
      fuHost: { subscribe(fn) { update = fn; }, initial: async () => ({ coverage: {}, snapshot: value }), reportReady() {}, reportRender() {}, reportInvalidation(value) { invalidations.push(value); } } });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(frames.at(-1).visible, true);
    now += natural ? 100 : 99; document.hidden = true; listeners.visibilitychange();
    assert.equal(frames.at(-1).visible, false);
    assert.equal(invalidations.length, natural ? 0 : 1, JSON.stringify({ withTarget, natural }));
    if (natural) { assert.equal(frames.at(-1).elapsedMs, end); assert.equal(frames.at(-1).hideAtMs, end); }
    else assert.equal(invalidations[0].reason, 'document-hidden');
    document.hidden = false; listeners.visibilitychange(); update(JSON.parse(JSON.stringify(value)));
    assert.equal(frames.at(-1).visible, false, 'a late visible clone cannot revive the completed or cancelled generation');
  }
});
