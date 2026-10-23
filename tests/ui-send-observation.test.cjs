'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUiObservation } = require('../adapter/ui-send-observation.cjs');

function observation(overrides = {}) {
  return {
    schemaVersion: 1, kind: 'send-invoked', observerId: 'observer_1', sequence: 1,
    monotonicMs: 10, host: { package: 'OpenAI.Codex', pid: 123, hwnd: '456' },
    mode: { value: 'chat', source: 'explicit-selection' },
    coordinateSpace: 'physical-screen-px',
    anchor: { x: -20, y: 100, width: 35, height: 35 },
    viewport: { x: -700, y: 0, width: 800, height: 600 },
    evidence: { invoke: true, composerBound: true, foreground: true, minimized: false },
    ...overrides
  };
}

test('ui observation accepts only bounded explicit send evidence and freezes the result', () => {
  const raw = observation();
  const result = validateUiObservation(JSON.stringify(raw));
  assert.deepEqual(result, raw);
  assert.notEqual(result, raw);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.anchor));
});

test('ui observation rejects untrusted payload, extra content and oversized UTF-8 lines', () => {
  for (const raw of [
    '{', null, [], observation({ prompt: 'must not cross this boundary' }),
    observation({ host: { package: 'Other.Application', pid: 123, hwnd: '456' } }),
    observation({ mode: { value: 'unknown', source: 'unknown' } }),
    observation({ mode: { value: 'work', source: 'window-name' } }),
    observation({ evidence: { invoke: false, composerBound: true, foreground: true, minimized: false } }),
    observation({ evidence: { invoke: true, composerBound: false, foreground: true, minimized: false } }),
    observation({ evidence: { invoke: true, composerBound: true, foreground: false, minimized: false } }),
    observation({ evidence: { invoke: true, composerBound: true, foreground: true, minimized: true } }),
    observation({ observerId: 'x'.repeat(65) }),
    observation({ sequence: Number.MAX_SAFE_INTEGER + 1 }),
    observation({ anchor: { x: NaN, y: 0, width: 35, height: 35 } }),
    observation({ anchor: { x: Infinity, y: 0, width: 35, height: 35 } }),
    observation({ anchor: { x: 131073, y: 0, width: 35, height: 35 } }),
    observation({ viewport: { x: 0, y: 0, width: 0, height: 20 } }),
    observation({ viewport: { x: 0, y: 0, width: 32769, height: 20 } }),
    JSON.stringify(observation({ observerId: '测'.repeat(6000) }))
  ]) assert.equal(validateUiObservation(raw), null);
});

test('ui observation freshness uses local receipt time and rejects future or stale receipts', () => {
  const raw = observation({ monotonicMs: 999999 });
  assert.ok(validateUiObservation(raw, { now: 1000, receivedAt: 999 }));
  assert.equal(validateUiObservation(raw, { now: 1000, receivedAt: 1001 }), null);
  assert.equal(validateUiObservation(raw, { now: 3001, receivedAt: 1000 }), null);
  assert.equal(validateUiObservation(raw, { now: 1000, receivedAt: 999, maxAgeMs: -1 }), null);
  assert.equal(validateUiObservation(raw, { lastSequence: 1 }), null);
  assert.equal(validateUiObservation(raw, { lastMonotonicMs: 1000000 }), null);
});

test('mode epoch invalidates pending anchors without invalidating a new observer epoch', () => {
  const old = observation();
  assert.equal(validateUiObservation(old, { expectedMode: 'work' }), null);
  assert.equal(validateUiObservation(old, { observerId: 'observer_2' }), null);
  const current = observation({ observerId: 'observer_2', sequence: 1, mode: { value: 'work', source: 'explicit-selection' } });
  assert.ok(validateUiObservation(current, { observerId: 'observer_2', expectedMode: 'work', lastSequence: 0 }));
});

test('unavailable carries a fixed reason and optional verified identity, never presentation fields', () => {
  const raw = { schemaVersion: 1, kind: 'unavailable', observerId: 'observer_1', sequence: 2, monotonicMs: 20, reason: 'mode-unknown' };
  assert.deepEqual(validateUiObservation(raw), raw);
  assert.ok(validateUiObservation({ ...raw, host: observation().host }));
  assert.equal(validateUiObservation({ ...raw, reason: 'raw provider exception text' }), null);
  assert.equal(validateUiObservation({ ...raw, anchor: observation().anchor }), null);
});

module.exports = { observation };
