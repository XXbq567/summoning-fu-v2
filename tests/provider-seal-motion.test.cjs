'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Delivery = require('../renderer/delivery-motion.js');
const { frameAt, EntranceTimeline } = require('../renderer/entrance-timeline.js');
const geometry = { originRect: { x: 280, y: 540, width: 8, height: 8 }, targetRect: { x: 100, y: 30, width: 264, height: 557.3333333333334 } };
const seal = () => ({ source: 'local-generated-seal', coordinateSpace: 'overlay-local-dip', runId: 'run-a', generation: 1, layoutVersion: 0,
  rect: { x: 420, y: 270, width: 88, height: 88 }, acceptancePoint: { x: 464, y: 314 } });

test('self generated mark has independent truthful admission and an explicit center plane', () => {
  const local = seal(), plan = Delivery.createLocalSealPlan(geometry, local);
  assert.ok(plan); assert.equal(plan.destination, 'local-generated-seal');
  assert.deepEqual(plan.arrival, local.acceptancePoint);
  assert.equal(Delivery.validateTarget(plan.target, { nowMs: 1, allowPreviewTarget: true }), false);
  assert.equal(Delivery.createPlan(geometry, plan.target, { nowMs: 1 }), null);
  assert.equal(frameAt(6500, false, { geometry, localSeal: local, deliveryPlan: plan }).visible, false, 'formal frames require explicit own-entrance branch');
  assert.equal(Delivery.localSealStillValid(plan, { ...local, generation: 2 }), false);
  assert.equal(Delivery.localSealStillValid(plan, { ...local, rect: { ...local.rect, x: 421 } }), false);
  assert.equal(Delivery.createLocalSealPlan(geometry, { ...local, acceptancePoint: { x: 2, y: 3 } }), null);
});

test('mark appears before departure without reducing reading and survives the paper for receipt and exit', () => {
  const localSeal = { ...seal(), rect: { x: 1400, y: 800, width: 88, height: 88 }, acceptancePoint: { x: 1444, y: 844 } }, deliveryPlan = Delivery.createLocalSealPlan(geometry, localSeal);
  const options = { geometry, localSeal, deliveryPlan, allowLocalSeal: true };
  assert.equal(frameAt(5949, false, options).seal.visible, false);
  const appear = frameAt(6050, false, options);
  assert.equal(appear.phase, 'hold'); assert.equal(appear.needsAnimation, true);
  assert.equal(appear.leaveAtMs - appear.holdStartMs, 2000);
  assert.equal(appear.seal.logoRotationZ, 0); assert.ok(appear.seal.opacity > 0 && appear.seal.opacity < 1);
  assert.equal(frameAt(5000, false, options).nextAnimationAtMs, 5950);
  const paperEnd = 6150 + deliveryPlan.durationMs;
  assert.ok(paperEnd + 250 > 8750, 'exercise a receipt after the legacy deadline');
  assert.equal(frameAt(paperEnd + 50, false, options).phase, 'seal-ack');
  assert.equal(frameAt(paperEnd + 250, false, options).phase, 'seal-exit');
  assert.equal(frameAt(paperEnd + 400, false, options).visible, false);
  assert.equal(frameAt(paperEnd + 400, false, options).seal.visible, false);
  const tl = new EntranceTimeline(); tl.trigger('run-a', 0);
  assert.equal(tl.snapshot(paperEnd + 250, false, options).visible, true, 'legacy totalMs must not truncate the mark');
  tl.cancel(tl.current.token);
  assert.equal(tl.snapshot(paperEnd + 260, false, options).visible, false, 'cancellation clears even a longer local plan');
});

test('local intake stays upright, clips lower end first and never uses opacity as disappearance', () => {
  const plan = Delivery.createLocalSealPlan(geometry, seal());
  let partial = 0;
  for (let ms = plan.intakeAtMs; ms < plan.durationMs; ms++) {
    const s = Delivery.sample(plan, ms);
    assert.equal(s.rotationZ, Math.PI / 2); assert.equal(s.opacity, 1);
    assert.deepEqual(s.clip.point, plan.arrival);
    if (s.leadingPoint.y > s.clip.point.y && s.trailingPoint.y < s.clip.point.y) partial++;
  }
  assert.ok(partial > 5);
  assert.ok(Object.isFrozen(plan.target.acceptancePoint));
});
