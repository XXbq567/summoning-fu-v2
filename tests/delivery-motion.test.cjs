'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = { originRect: { x: 260, y: 650, width: 8, height: 8 }, targetRect: { x: 180, y: 70, width: 264, height: 557.3333333333334 } };
const target = (x = 700, y = 650) => ({ targetId: 'example', revision: 1, rect: { x, y, width: 88, height: 96 }, coordinateSpace: 'overlay-local-dip', source: 'preview-example', valid: true, visible: true, observedAtMonotonicMs: 0, expiresAtMonotonicMs: 20000 });
const options = { allowPreviewTarget: true, nowMs: 100 };
test('complete lettering holds for two seconds, then missing real target clears without fire', () => {
  const { timings, frameAt } = require('../renderer/entrance-timeline.js');
  assert.equal(timings.paperEndMs, 1950); assert.equal(timings.writingEndMs, 4150);
  assert.equal(timings.holdMs, 2000); assert.equal(timings.leaveAtMs, 6150);
  assert.equal(frameAt(6149).phase, 'hold');
  const end = frameAt(6150); assert.equal(end.phase, 'hidden'); assert.equal(end.visualFireActive, false); assert.equal(end.ashOpacity, 0);
});
test('delivery target is source-qualified, visible, finite and live in one monotonic clock', () => {
  const motion = require('../renderer/delivery-motion.js');
  assert.equal(motion.validateTarget(target(), options), true);
  assert.equal(motion.validateTarget(target(), { nowMs: 100 }), false);
  for (const change of [{ visible: false }, { valid: false }, { coordinateSpace: 'screen' }, { expiresAtMonotonicMs: 99 }, { observedAtMonotonicMs: 101 }, { source: 'saved-position' }, { rect: { x: NaN, y: 0, width: 10, height: 10 } }]) {
    assert.equal(motion.validateTarget({ ...target(), ...change }, options), false);
  }
  assert.equal(motion.validateTarget({ ...target(), source: 'supported-host-adapter' }, { nowMs: 100 }), true);
});
test('one finite arc adapts to near, far, left and right targets, with continuous phase boundaries', () => {
  const motion = require('../renderer/delivery-motion.js');
  for (const [x, y] of [[220, 180], [-500, 600], [1300, 650], [360, 20]]) {
    const plan = motion.createPlan(geometry, target(x, y), options);
    assert.ok(plan.durationMs >= 1800 && plan.durationMs <= 2600);
    let previous = motion.sample(plan, 0);
    for (let ms = 4; ms < plan.durationMs; ms += 4) {
      const state = motion.sample(plan, ms);
      for (const value of [state.position.x, state.position.y, state.rotationZ, state.scale, state.scaleX, state.scaleY]) assert.ok(Number.isFinite(value));
      assert.ok(Math.hypot(state.position.x - previous.position.x, state.position.y - previous.position.y) < 40);
      assert.equal(state.opacity, 1, 'only final pixel cleanup may fade'); previous = state;
    }
    assert.equal(motion.sample(plan, plan.durationMs).phase, 'hidden');
    assert.ok(Object.isFrozen(plan));
    assert.equal(motion.targetStillValid(plan, { ...target(x, y), rect: { x: x + 40, y, width: 88, height: 96 } }, options), false);
  }
});
test('bottom folds first, middle carries the folded bottom, intake clips before hiding', () => {
  const motion = require('../renderer/delivery-motion.js');
  const plan = motion.createPlan(geometry, target(), options);
  assert.ok(motion.sample(plan, 200).foldBottom > 0);
  assert.equal(motion.sample(plan, 200).foldMiddle, 0);
  assert.ok(motion.sample(plan, 580).foldMiddle > 0);
  const frame = require('../renderer/entrance-timeline.js').frameAt(6150 + plan.intakeAtMs + 120, false, { geometry, deliveryPlan: plan, ...options });
  assert.equal(frame.phase, 'intake'); assert.equal(frame.delivery.state.clip.enabled, true);
  assert.equal(frame.visualFireActive, false); assert.equal(frame.burn, 0);
});
test('target and paper geometry are frozen, no late mutable object changes the current flight', () => {
  const motion = require('../renderer/delivery-motion.js'); const candidate = target();
  const plan = motion.createPlan(geometry, candidate, options), before = JSON.stringify(motion.sample(plan, 1700));
  candidate.rect.x += 1000; candidate.visible = false;
  assert.equal(JSON.stringify(motion.sample(plan, 1700)), before);
  assert.equal(motion.targetStillValid(plan, candidate, options), false);
});
test('late target revision and observation cannot roll a flight back, fresh heartbeats remain usable', () => {
  const motion = require('../renderer/delivery-motion.js');
  const initial = { ...target(), revision: 5, observedAtMonotonicMs: 50 };
  const plan = motion.createPlan(geometry, initial, options);
  assert.equal(motion.targetStillValid(plan, { ...initial, revision: 4 }, options), false);
  assert.equal(motion.targetStillValid(plan, { ...initial, observedAtMonotonicMs: 49 }, options), false);
  assert.equal(motion.targetStillValid(plan, { ...initial, revision: 6, observedAtMonotonicMs: 90 }, options), true);
  const { frameAt } = require('../renderer/entrance-timeline.js');
  assert.equal(frameAt(6500, false, { geometry, deliveryPlan: plan, nowMs: 100 }).visible, false, 'a raw preview plan is rejected in formal mode');
  assert.equal(frameAt(6500, false, { geometry, deliveryPlan: plan, deliveryTarget: { ...initial, rect: { ...initial.rect, x: initial.rect.x + 40 } }, ...options }).visible, false, 'an invalidated frozen plan never replans toward a moved target');
});
