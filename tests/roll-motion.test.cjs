'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const location = path.join(__dirname, '../renderer/roll-motion.js');
const motion = fs.existsSync(location) ? require(location) : null;
test('bottom-up roll has no invisible progress dead zone and holds its finished geometry', () => {
  assert.ok(motion, 'the shared roll timing/geometry contract must exist');
  const first = motion.frameAt(0), moving = motion.frameAt(1), last = motion.frameAt(850);
  assert.equal(motion.durationMs, 850); assert.equal(first.rolledFraction, 0);
  assert.ok(moving.rolledFraction > 0, 'visible rolling must begin without spending time above the flat threshold');
  assert.equal(last.rolledFraction, 1); assert.equal(last.progress, 0);
  assert.equal(last.phase, 'rolled'); assert.equal(last.needsAnimation, false);
  assert.deepEqual(motion.frameAt(5000), last);
});
test('geometry chapters mean wound paper length, not half of Paperlab progress', () => {
  assert.ok(motion, 'the shared roll timing/geometry contract must exist');
  for (const [chapter, fraction] of [['start', .03], ['half', .5], ['closing', .94], ['rolled', 1]]) {
    const frame = motion.frameAt(motion.chapterElapsed(chapter));
    assert.ok(Math.abs(frame.rolledFraction - fraction) < 1e-8, chapter);
  }
  assert.notEqual(motion.frameAt(motion.chapterElapsed('half')).progress, .5);
  assert.equal(motion.chapterElapsed('unknown'), null);
  assert.throws(() => motion.frameAt(NaN), /finite/);
});
test('the actual installed public Paperlab roll keeps TOP fixed and original UVs while BOTTOM winds inward', () => {
  assert.ok(motion, 'the shared roll timing/geometry contract must exist');
  const { getBehavior, getDeformer } = require('paperlab');
  const { Vector3, Vector2 } = require('three');
  const behavior = getBehavior('unroll'), roll = getDeformer('roll'), h = motion.sheet.height;
  const top = new Vector3(0, h / 2, 0), uv = new Vector2(.5, 1);
  let previousRadius = -1;
  for (const fraction of [0, .03, .5, .94, 1]) {
    const frame = motion.frameAt(motion.elapsedForFraction(fraction));
    const options = behavior.optionsSchema.parse({ ...motion.behavior, progress: frame.progress });
    const stack = behavior.stack(options, motion.sheet), deformer = stack[0];
    assert.equal(deformer.type, 'roll'); assert.equal(deformer.options.angle, 270);
    assert.ok(deformer.options.radius >= previousRadius); previousRadius = deformer.options.radius;
    assert.ok(Math.abs(deformer.options.radius - frame.radius) < 1e-10);
    const point = top.clone(); roll.displace(point, uv, deformer.options, { t: 0, sheet: motion.sheet });
    assert.ok(point.distanceTo(top) < 1e-10, 'the unrolled TOP must not be recentered');
    assert.deepEqual(uv.toArray(), [.5, 1]);
    const pose = { position: [0, 0, 0], rotation: [0, 0, 0] };
    behavior.transform(options, 0, pose, motion.sheet); assert.deepEqual(pose.position, [0, 0, 0]);
    if (fraction > 0) {
      const bottom = new Vector3(0, -h / 2, 0), bottomUV = new Vector2(.5, 0);
      roll.displace(bottom, bottomUV, deformer.options, { t: 0, sheet: motion.sheet });
      const centerY = -deformer.options.boundary, centerZ = deformer.options.radius;
      assert.ok(Math.abs(Math.hypot(bottom.y - centerY, bottom.z - centerZ) - motion.behavior.core) < 1e-8,
        'original bottom edge must occupy the inner core, not a second flat surface');
      assert.deepEqual(bottomUV.toArray(), [.5, 0]);
    }
  }
});
test('hidden or cancelled generations cannot draw again, but explicit replay owns a new generation', () => {
  assert.ok(motion, 'the shared roll timing/geometry contract must exist');
  const gate = motion.createGenerationGate();
  assert.equal(gate.accept({ generation: 1, visible: true }).visible, true);
  assert.equal(gate.accept({ generation: 1, visible: false }).visible, false);
  assert.equal(gate.accept({ generation: 1, visible: true }), null, 'late same-run draw must stay closed');
  assert.equal(gate.accept({ generation: 2, visible: true }).visible, true);
  assert.equal(gate.accept({ generation: 1, visible: false }), null, 'old hide cannot erase replay');
  assert.equal(gate.accept({ generation: NaN, visible: true }), null);
  gate.dispose(); assert.equal(gate.accept({ generation: 3, visible: true }), null);
});
test('the actual asynchronous session receives only the latest owned frame and cannot revive after hide or disposal', async () => {
  assert.ok(motion, 'the shared roll timing/geometry contract must exist');
  const { createSession } = require('../renderer/paperlab-session.js');
  let release, disposed = 0; const rendered = [];
  const prepared = new Promise(resolve => { release = resolve; });
  const session = motion.createPreviewSession(() => prepared, createSession);
  session.render({ generation: 1, visible: true, elapsedMs: 200 });
  session.render({ generation: 1, visible: false, elapsedMs: 200 });
  session.render({ generation: 1, visible: true, elapsedMs: 400 });
  release({ render(frame) { rendered.push(frame); }, getState() { return {}; }, dispose() { disposed++; } });
  await session.ready;
  assert.equal(rendered.length, 1); assert.equal(rendered[0].phase, 'hidden');
  session.render({ generation: 2, visible: true, elapsedMs: 0 });
  assert.equal(rendered.length, 2); assert.equal(rendered[1].phase, 'flat');
  session.dispose(); session.render({ generation: 3, visible: true, elapsedMs: 0 });
  assert.equal(rendered.length, 2); assert.equal(disposed, 1);
  assert.equal(session.getState().canvasVisible, false);
});
