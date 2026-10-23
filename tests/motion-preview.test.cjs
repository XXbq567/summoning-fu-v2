'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PreviewClock, shouldAnimateFrame } = require('../desktop/motion-preview.js');
const { previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate } = require('../desktop/host-state.cjs');
test('preview clock pauses, seeks and replays independently without advancing hidden time', () => {
  const one = new PreviewClock(14000), two = new PreviewClock(14000);
  one.replay(0); one.pause(500); assert.equal(one.snapshot(9000).elapsedMs, 500);
  one.resume(10000); assert.equal(one.snapshot(11000).elapsedMs, 1500);
  one.seek(13500, 11000); assert.equal(one.snapshot(30000).elapsedMs, 13500);
  assert.equal(two.snapshot(30000).elapsedMs, 0);
  one.replay(30000); assert.equal(one.snapshot(45000).playing, false); assert.equal(one.snapshot(45000).elapsedMs, 14000);
});
test('preview command and animation gates do not allow arbitrary IPC or omit paper/seal', () => {
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
