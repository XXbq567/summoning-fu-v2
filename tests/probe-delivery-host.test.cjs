'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, analyseNatural, analyseHidden, failureRecord } = require('../scripts/probe-delivery-host.cjs');
const row = (phase, t, extra = {}) => ({ atMs: t, evidence: {
  runId: 'own-delivery-a', rafCount: 20 + t, frame: { phase, activeMs: t, writing: t < 1950 ? 0 : 1,
    visibleGlyphs: t < 1950 ? 0 : 56, totalGlyphs: 56, holdStartMs: 4150, leaveAtMs: 6150, hideAtMs: 8030,
    paperOpacity: phase === 'hidden' ? 0 : 1, opacity: phase === 'hidden' ? 0 : 1, burn: 0 },
  paperlab: { engine: 'paperlab', libraryVersion: '0.8.1', materialReady: true, error: null,
    actualDrawCount: t, actualClearCount: 1, textureRasterizations: 2, metadataHash: '12345678', textureHash: 'abcdef12',
    canvasVisible: !['writing','hold','hidden'].includes(phase), flameCount: 0, burn: 0,
    foldBottom: phase === 'folding' ? .5 : 1, foldMiddle: phase === 'folding' ? 0 : 1,
    flightProgress: phase === 'flying' ? .5 : 1, intakeProgress: phase === 'intake' ? .8 : 0,
    deliveryTargetValid: ['folding','flying','intake'].includes(phase), deliveryClipped: phase === 'intake',
    ...extra } } });
function natural(target) {
  const rows = [row('unfold', 1000), row('writing', 3000), row('hold', 4200), row('hold', 5000), row('hold', 6000)];
  for (const r of rows.filter(r => r.evidence.frame.phase === 'hold')) {
    r.evidence.paperlab.actualDrawCount = 3000; r.evidence.rafCount = 3000;
  }
  if (target) rows.push(row('folding', 6300), row('folding', 6600), row('flying', 7100, { flightProgress: .3 }),
    row('flying', 7400, { flightProgress: .7 }), row('intake', 7700, { intakeProgress: .7 }), row('intake', 7900, { intakeProgress: .9 }));
  const end = target ? 8030 : 6150, last = rows.at(-1);
  for (const t of [end + 30, end + 1100]) {
    const hidden = row('hidden', t, { actualDrawCount: last.evidence.paperlab.actualDrawCount,
      actualClearCount: 2, deliveryTargetValid: false });
    hidden.evidence.frame.hideAtMs = end;
    hidden.evidence.rafCount = last.evidence.rafCount; rows.push(hidden);
  }
  return rows;
}
test('own native probe separates actual no-target and simulated-target paths', () => {
  const p = plan();
  assert.match(p.profile, /summoning-fu-delivery-host-probe-[a-f0-9]{16}$/);
  assert.equal(p.renderer, 'desktop/pet.html+preload.cjs+pet.js');
  assert.equal(p.realPetTarget, 'NOT_TESTED');
  assert.equal(p.totalDeadlineMs, 100000);
  assert.equal(analyseNatural(natural(false), { hasTarget: false }).holdContractMs, 2000);
  assert.equal(analyseNatural(natural(true), { hasTarget: true }).classification, 'SIMULATED_OWN_TARGET');
});
test('native natural contract rejects burning, missing delivery, and active hold', () => {
  let rows = natural(true); rows[1].evidence.paperlab.flameCount = 1;
  assert.throws(() => analyseNatural(rows, { hasTarget: true }), /unexpected-fire/);
  assert.throws(() => analyseNatural(natural(false), { hasTarget: true }), /missing-folding/);
  rows = natural(false); rows[3].evidence.paperlab.actualDrawCount++;
  assert.throws(() => analyseNatural(rows, { hasTarget: false }), /hold-kept-drawing/);
});
test('normal pet retains one static hold frame while wall-clock observations cover the reading interval', () => {
  const rows = natural(false);
  for (const r of rows.filter(r => r.evidence.frame.phase === 'hold')) r.evidence.frame.activeMs = 4200;
  assert.equal(analyseNatural(rows, { hasTarget: false }).observedHoldWallMs, 1800);
});
test('native hidden contract requires clear once, invisible paper and stopped drawing', () => {
  const rows = natural(true), hidden = rows.filter(r => r.evidence.frame.phase === 'hidden');
  assert.equal(analyseHidden(hidden).result, 'PASS');
  hidden[1].evidence.paperlab.actualClearCount++;
  assert.throws(() => analyseHidden(hidden), /hidden-kept-drawing/);
  hidden[1].evidence.paperlab.actualClearCount--;
  hidden[1].evidence.frame.paperOpacity = 1;
  assert.throws(() => analyseHidden(hidden), /hidden-not-clear/);
});
test('parent process failure preserves the earlier child failure and stage', () => {
  const report = failureRecord({ result: 'FAIL', reason: 'native-unexpected-invalidation', stage: 'render-hidden' }, 'native-child-exited');
  assert.equal(report.reason, 'native-unexpected-invalidation');
  assert.equal(report.firstReason, 'native-unexpected-invalidation');
  assert.equal(report.parentFailure, 'native-child-exited');
  assert.equal(report.stage, 'render-hidden');
  assert.equal(failureRecord({ result: 'RUNNING' }, 'native-child-deadline').reason, 'native-child-deadline');
});
