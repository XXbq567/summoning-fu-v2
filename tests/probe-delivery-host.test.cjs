'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, analyseNatural, analyseHidden, failureRecord } = require('../scripts/probe-delivery-host.cjs');
const {samples:previewSamples}=require('./helpers/rolled-delivery-samples.cjs');
const probe=require('../scripts/probe-delivery-host.cjs');
const row = (phase, t, extra = {}) => ({ atMs: t, evidence: {
  runId: 'own-delivery-a', rafCount: 20 + t, frame: { phase, activeMs: t, writing: t < 1950 ? 0 : 1,
    visibleGlyphs: t < 1950 ? 0 : 56, totalGlyphs: 56, holdStartMs: 4150, leaveAtMs: 6150, hideAtMs: 8030,
    paperOpacity: phase === 'hidden' ? 0 : 1, opacity: phase === 'hidden' ? 0 : 1, burn: 0 },
  paperlab: { engine: 'paperlab', libraryVersion: '0.8.1', materialReady: true, error: null,
    actualDrawCount: t, actualClearCount: 1, textureRasterizations: 2, metadataHash: '12345678', textureHash: 'abcdef12',
    canvasVisible: !['writing','hold','hidden'].includes(phase), flameCount: 0, burn: 0,
    flightProgress: phase === 'flying' ? .5 : 1, intakeProgress: phase === 'intake' ? .8 : 0,
    deliveryTargetValid: false, deliveryClipped: false,
    ...extra } } });
function natural(target) {
  if(target)return previewSamples().map(r=>{const e=r.preview.evidence;return {atMs:e.elapsedMs,evidence:{runId:'own-delivery-a',rafCount:e.rafCount,frame:{phase:e.phase,activeMs:e.elapsedMs,writing:e.writing,visibleGlyphs:e.visibleGlyphs,totalGlyphs:e.totalGlyphs,holdStartMs:e.holdStartMs,leaveAtMs:e.leaveAtMs,hideAtMs:e.hideAtMs,paperOpacity:e.phase==='hidden'?0:1,opacity:e.phase==='hidden'?0:1,burn:0},paperlab:{...e.paperlab,burn:0}}};});
  const rows = [row('unfold', 1000), row('writing', 3000), row('hold', 4200), row('hold', 5000), row('hold', 6000)];
  for (const r of rows.filter(r => r.evidence.frame.phase === 'hold')) {
    r.evidence.paperlab.actualDrawCount = 3000; r.evidence.rafCount = 3000;
  }
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
  assert.throws(() => analyseNatural(natural(false), { hasTarget: true }), /missing-rolling/);
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
test('simulated native fixture reserves clearance for the full rotated path without relaxing real rebase safety',()=>{
 assert.equal(typeof probe.placeFixtureWithinWorkArea,'function');
 const {rebaseDeliveryLayout}=require('../desktop/host-state.cjs');
 const base={bounds:{x:40,y:40,width:281,height:513},geometry:{originRect:{x:137.8,y:423.072,width:5.2,height:5.2},targetRect:{x:36.4,y:36.4,width:208,height:439.4}}};
 const area={x:0,y:0,width:1280,height:900},now=1;
 const target={targetId:'simulated-own-native-target',revision:1,rect:{x:336,y:413,width:64,height:64},coordinateSpace:'overlay-local-dip',source:'supported-host-adapter',valid:true,visible:true,observedAtMonotonicMs:now,expiresAtMonotonicMs:30001};
 assert.equal(rebaseDeliveryLayout(base,target,{nowMs:now,workArea:area}),null,'out-of-work-area real guard must remain strict');
 const safe=probe.placeFixtureWithinWorkArea(base,area,now);assert.ok(safe);assert.deepEqual(safe.geometry,base.geometry);assert.ok(safe.bounds.y>=100);
 const layout=rebaseDeliveryLayout(safe,target,{nowMs:now,workArea:area});assert.ok(layout);assert.ok(layout.bounds.y>=24);assert.ok(layout.bounds.y+layout.bounds.height<=area.height-24);
 assert.equal(probe.placeFixtureWithinWorkArea(base,{x:0,y:0,width:300,height:300},now),null,'an unfit fixture must fail rather than bypass the work-area guard');
 assert.deepEqual(base.bounds,{x:40,y:40,width:281,height:513},'fixture placement cannot mutate its input');
});
