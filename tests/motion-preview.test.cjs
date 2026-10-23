'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PreviewClock, shouldAnimateFrame } = require('../desktop/motion-preview.js');
const { previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate } = require('../desktop/host-state.cjs');
test('visible SVG evidence follows computed ancestor visibility and real layout bounds', () => {
  const { svgIsVisible } = require('../desktop/motion-preview.js');
  const parent = { parentElement: null, computed: { display: 'block', visibility: 'visible', opacity: '1' } };
  const svg = { parentElement: parent, computed: { display: 'block', visibility: 'visible', opacity: '1' }, getBoundingClientRect: () => ({ width: 300, height: 600 }) };
  const styleOf = element => element.computed;
  assert.equal(svgIsVisible(svg, false, styleOf), true);
  parent.computed.visibility = 'hidden'; assert.equal(svgIsVisible(svg, false, styleOf), false);
  parent.computed.visibility = 'visible'; svg.computed.display = 'none'; assert.equal(svgIsVisible(svg, false, styleOf), false);
  svg.computed.display = 'block'; assert.equal(svgIsVisible(svg, true, styleOf), false);
  svg.getBoundingClientRect = () => ({ width: 0, height: 600 }); assert.equal(svgIsVisible(svg, false, styleOf), false);
});
test('preview uses the actual example button bounds in local coordinates without scaling twice', () => {
  const { localPreviewGeometry } = require('../desktop/motion-preview.js');
  const geometry = localPreviewGeometry({ x: 100, y: 50 }, { x: 600, y: 700, width: 60, height: 30 }, { x: 300, y: 100, width: 240, height: 506.6667 });
  assert.deepEqual(geometry.originRect, { x: 500, y: 650, width: 60, height: 30 });
  assert.deepEqual(geometry.targetRect, { x: 200, y: 50, width: 240, height: 506.6667 });
});
test('preview clock pauses, seeks and replays independently without advancing hidden time', () => {
  const one = new PreviewClock(14000), two = new PreviewClock(14000);
  one.replay(0); one.pause(500); assert.equal(one.snapshot(9000).elapsedMs, 500);
  one.resume(10000); assert.equal(one.snapshot(11000).elapsedMs, 1500);
  one.seek(13500, 11000); assert.equal(one.snapshot(30000).elapsedMs, 13500);
  assert.equal(two.snapshot(30000).elapsedMs, 0);
  one.replay(30000); assert.equal(one.snapshot(45000).playing, false); assert.equal(one.snapshot(45000).elapsedMs, 14000);
});
test('slow preview changes speed without jumping position or advancing while paused', () => {
  const clock = new PreviewClock(12500); clock.replay(0);
  clock.setSpeed(.5, 1000); assert.equal(clock.snapshot(3000).elapsedMs, 2000);
  clock.pause(3000); clock.setSpeed(.25, 4000); assert.equal(clock.snapshot(9000).elapsedMs, 2000);
  clock.resume(10000); assert.equal(clock.snapshot(12000).elapsedMs, 2500);
});
test('preview command and animation gates do not allow arbitrary IPC or omit paper/seal', () => {
  assert.equal(previewCommandAllowed('unfold'), true); assert.equal(previewCommandAllowed('burning'), true);
  assert.equal(previewCommandAllowed('paper'), true); assert.equal(previewCommandAllowed('replay'), true);
  assert.equal(previewCommandAllowed('executeScript'), false); assert.equal(previewCommandAllowed({ command: 'paper' }), false);
  for (const phase of ['paper', 'writing', 'seal', 'leaving']) assert.equal(shouldAnimateFrame({ visible: true, reducedMotion: false, needsAnimation: true, phase }, false), true);
  assert.equal(shouldAnimateFrame({ visible: true, needsAnimation: true }, true), false);
  assert.equal(shouldAnimateFrame({ visible: false, needsAnimation: true }, false), false);
});
test('preview telemetry keeps actual system preference distinct from effective explicit preview', () => {
  const checked = sanitizePreviewEvidence({ generation: 1, elapsedMs: 300, phase: 'paper', playing: true, documentHidden: false, systemReducedMotion: true, effectiveReducedMotion: false, renderCount: 20, rafCount: 19, paperOpacity: .4, opacity: 1, writing: 0, visibleGlyphs: 0, totalGlyphs: 50, holdStartMs: 3000, leaveAtMs: 13000, hideAtMs: 14000, task: 'secret' });
  assert.equal(checked.systemReducedMotion, true); assert.equal(checked.effectiveReducedMotion, false); assert.equal(checked.task, undefined);
  assert.equal(sanitizePreviewEvidence({ ...checked, effectiveReducedMotion: true }), null);
  assert.equal(sanitizePreviewEvidence({ ...checked, visibleGlyphs: -1 }), null);
});
test('preview-only startup and quit preserve an existing persistent binding and unrelated preferences', () => {
  const previous = { binding: { sessionId: 'real-session', file: 'C:\\existing\\rollout.jsonl' }, preference: 'retained' };
  const result = desktopSettingsSnapshot({ settings: previous, binding: null, bindingChanged: false, position: { x: 100, y: 200 } });
  assert.deepEqual(result.binding, previous.binding); assert.equal(result.preference, 'retained');
  assert.equal(desktopSettingsSnapshot({ settings: previous, binding: null, bindingChanged: true }).binding, null);
  assert.deepEqual(previous.binding, { sessionId: 'real-session', file: 'C:\\existing\\rollout.jsonl' });
});
test('preview reopen queues once before initialization and replays immediately after readiness', () => {
  const gate = new PreviewReplayGate();
  assert.equal(gate.request(), false); assert.equal(gate.request(), false);
  assert.equal(gate.readyNow(), true); assert.equal(gate.readyNow(), false);
  assert.equal(gate.request(), true);
  const clock = new PreviewClock(14000); clock.replay(0); clock.snapshot(15000); clock.replay(16000);
  assert.deepEqual(clock.snapshot(16000), { elapsedMs: 0, playing: true, generation: 2 });
});

test('automatic QA disables human replay while its narrow IPC and manual preview remain interactive', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  for (const qaOnly of [true, false]) {
    let now = 1000, ipcCommand;
    let resolveMaterial;
    const materialReady = new Promise(resolve => { resolveMaterial = resolve; });
    const reports = [], listeners = {};
    const element = id => ({ id, style: {}, disabled: false, dataset: id === 'example-send' ? { preview: 'replay' } : {}, addEventListener(name, fn) { listeners[id + ':' + name] = fn; }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 360, height: 760 }) });
    const elements = Object.fromEntries(['preview-paper', 'preview-progress', 'preview-time', 'preview-stage', 'preview-policy', 'preview-source', 'pause-preview', 'example-send', 'stage'].map(id => [id, element(id)]));
    const buttons = [elements['example-send'], elements['pause-preview']];
    const document = { hidden: false, fonts: { ready: Promise.resolve() }, addEventListener() {}, querySelector: selector => elements[selector === '.preview-stage' ? 'stage' : selector.slice(1)], querySelectorAll: selector => selector === '[data-preview]' ? [buttons[0]] : selector === 'button' ? buttons : [] };
    const sandbox = { document, performance: { now: () => now }, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, setInterval() {}, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
      RitualEntrance: require('../renderer/entrance-timeline.js'), RitualBurn: { BurnView: class { constructor() { this.svg = { querySelectorAll: () => [], querySelector: () => null }; this.ready = materialReady; } render() {} } },
      fuPreview: { initial: async () => ({ qaOnly, source: 'example', metadata: {}, coverage: {} }), subscribe: fn => { ipcCommand = fn; }, report: value => reports.push(value) } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/motion-preview.js'), 'utf8'), sandbox);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reports.length, 0, 'preview clock must wait for the real material readiness');
    resolveMaterial(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(buttons.every(button => button.disabled === qaOnly), true);
    const firstGeneration = reports.at(-1).generation;
    now += 200; listeners['example-send:click']();
    assert.equal(reports.at(-1).generation, firstGeneration + (qaOnly ? 0 : 1));
    now += 200; ipcCommand('replay');
    assert.equal(reports.at(-1).generation, firstGeneration + (qaOnly ? 1 : 2));
  }
});
