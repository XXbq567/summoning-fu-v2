'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const contract=require('../scripts/qa-delivery-contract.cjs');
const {samples}=require('./helpers/rolled-delivery-samples.cjs');
test('natural delivery requires true roll/UV/pivot, actual 90 degree axis, progressive flight and accelerated intake',()=>{
 const result=contract.analyseDelivery(samples());assert.equal(result.result,'PASS',result.reason);assert.equal(result.mode,'rolled-paper');
});
test('old fold-only telemetry cannot pass a genuine rolled-paper delivery',()=>{
 const rows=samples();for(const r of rows){const p=r.preview.evidence.paperlab;delete p.deliveryMode;p.foldBottom=1;p.foldMiddle=1;}
 assert.equal(contract.analyseDelivery(rows).result,'FAIL');
});
test('natural delivery rejects fire, missing intake, missing clipping, active hold and readback',()=>{
 for(const [mutate,reason]of [[r=>r[9].preview.evidence.paperlab.flameCount=1,'unexpected-fire'],[r=>{for(let i=r.length-1;i>=0;i--)if(r[i].preview.evidence.phase==='intake')r.splice(i,1)},'phase-not-observed:intake'],
 [r=>r.forEach(x=>x.preview.evidence.paperlab.deliveryClipped=false),'actual-intake-plane-or-order-invalid'],[r=>r[5].preview.evidence.paperlab.actualDrawCount++,'hold-kept-drawing'],[r=>r[9].captureStatus.preview='image.png','natural-readback']]){
 const rows=samples();mutate(rows);assert.equal(contract.analyseDelivery(rows).reason,reason);}
});
test('unready, stale generations, changed target identity and hidden draw/clear cannot pass',()=>{
 for(const [mutate,reason]of [[r=>r[0].preview.evidence.paperlab.materialReady=false,'material-not-ready'],[r=>r[10].preview.evidence.generation++,'generation-changed'],
 [r=>r[14].preview.evidence.paperlab.deliveryTargetId='other','target-changed'],[r=>r[14].preview.evidence.paperlab.deliveryTargetValid=false,'target-invalid'],
 [r=>r.at(-1).preview.evidence.paperlab.actualClearCount++,'hidden-kept-drawing'],[r=>r.forEach(x=>x.preview.evidence.paperlab.actualClearCount=0),'hidden-not-cleared']]){
 const rows=samples();mutate(rows);assert.equal(contract.analyseDelivery(rows).reason,reason);}
});
test('actual metrics must reject absent geometry, changing UV/pivot, fake static curvature and wrong projected axis',()=>{
 for(const mutate of [
 p=>delete p.deliveryMeshId,p=>delete p.deliveryUvInitialHash,p=>p.deliveryUvHash='remapped',p=>p.actualWoundFraction=0,
 p=>p.projectedAxis={leading:{x:0,y:0},trailing:{x:1,y:1}},p=>p.backsideInkStrength=.1,p=>p.material.opacity=.8]){
 const rows=samples();mutate(rows[15].preview.evidence.paperlab);assert.equal(contract.analyseDelivery(rows).result,'FAIL');}
 const staticRows=samples();for(const row of staticRows)row.preview.evidence.paperlab.deliveryGeometryPositionHash='static-plane';assert.equal(contract.analyseDelivery(staticRows).reason,'actual-roll-not-advancing');
 const pivot=samples();pivot[15].preview.evidence.paperlab.deliveryPivotLocal.y=0;assert.equal(contract.analyseDelivery(pivot).reason,'roll-identity-uv-or-pivot-changed');
 const horizontal=samples();for(const row of horizontal)if(row.preview.evidence.phase==='flying'){const p=row.preview.evidence.paperlab;p.projectedAxis={leading:{x:p.deliveryPosition.x+100,y:p.deliveryPosition.y},trailing:{x:p.deliveryPosition.x-100,y:p.deliveryPosition.y}};}assert.equal(contract.analyseDelivery(horizontal).reason,'actual-axis-not-vertical-after-rotation');
});
test('top drift, premature takeoff, terminal ease out and moving clip planes cannot pass',()=>{
 const drift=samples();drift[9].preview.evidence.paperlab.deliveryBounds.y+=30;assert.equal(contract.analyseDelivery(drift).reason,'flat-source-not-aligned-to-measured-pivot');
 const premature=samples();premature[15].preview.evidence.paperlab.rotationProgress=.7;assert.equal(contract.analyseDelivery(premature).reason,'takeoff-before-roll-and-rotation');
 const eased=samples();for(const row of eased.filter(r=>r.preview.evidence.phase==='intake')){const p=row.preview.evidence.paperlab,y=500+p.intakeProgress*400;Object.assign(p,{deliveryPosition:{x:400,y},projectedAxis:{leading:{x:400,y:y+100},trailing:{x:400,y:y-100}},intakeLeadingY:y+100,intakeTrailingY:y-100});p.deliveryBounds.y=y-100;const h=Math.max(0,Math.min(200,650-p.deliveryBounds.y));p.visibleGeometryBounds=h>0?{...p.deliveryBounds,height:h}:null;p.deliveryVisibleVertexCount=Math.ceil(1737*h/200);p.deliveryClipIntersectionCount=h>0&&h<200?4:0;}assert.equal(contract.analyseDelivery(eased).reason,'intake-not-accelerating');
 const plane=samples();plane[20].preview.evidence.paperlab.intakePlaneY++;assert.equal(contract.analyseDelivery(plane).reason,'actual-intake-plane-or-order-invalid');
});
test('QA profile and commands remain isolated while adding roll, rotation, drag and expiry cases',()=>{
 const p=contract.buildDeliveryPlan({root:'C:/project',output:'C:/project/qa/delivery/test',development:true,token:'aabbccdd'});
 assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,240000);
 for(const args of Object.values(p.commands)){assert.ok(args.includes('--preview-qa-only'));assert.ok(args.includes('--user-data-dir='+p.profile));}
 for(const action of ['rolling-start','rolling','rolled','rotating','flying','intake-tip','target-expire','target-drag'])assert.ok(p.commands[action].includes('--preview-qa='+action));
});
test('actual mesh partial proofs need a leading end inside and a progressively shorter visible tail',()=>{
 const first=samples()[20].preview.evidence,last=structuredClone(first);
 Object.assign(last.paperlab,{intakeProgress:.8,intakeLeadingY:760,intakeTrailingY:560,deliveryPosition:{x:400,y:660},deliveryBounds:{x:300,y:560,width:200,height:200},visibleGeometryBounds:{x:300,y:560,width:200,height:90},deliveryVisibleVertexCount:782,projectedAxis:{leading:{x:400,y:760},trailing:{x:400,y:560}}});
 assert.equal(contract.analysePartialPair(first,last).result,'PASS');
 const backwards=structuredClone(last);backwards.paperlab.intakeTrailingY=first.paperlab.intakeTrailingY-5;assert.equal(contract.analysePartialPair(first,backwards).result,'FAIL');
 const formula=structuredClone(last);delete formula.paperlab.projectedAxis;assert.equal(contract.analysePartialPair(first,formula).result,'FAIL');
});
test('repeated publication of one identical frame is deduplicated but conflicting same-time geometry or reverse clocks fail',()=>{
 const same=samples();same.splice(10,0,structuredClone(same[9]));assert.equal(contract.analyseDelivery(same).result,'PASS');
 for(const alter of [p=>p.actualDrawCount++,p=>p.deliveryGeometryPositionHash='conflict',p=>p.deliveryPosition.y++]){
  const conflict=samples(),extra=structuredClone(conflict[9]);alter(extra.preview.evidence.paperlab);conflict.splice(10,0,extra);assert.equal(contract.analyseDelivery(conflict).result,'FAIL');
 }
 const backwards=samples();backwards[10].preview.evidence.elapsedMs=backwards[9].preview.evidence.elapsedMs-1;assert.equal(contract.analyseDelivery(backwards).result,'FAIL');
});
test('source continuity uses actual measured axis and bbox, and rotation permits only the 12 DIP lift',()=>{
 for(const mutate of [
  p=>{p.deliveryPosition.x+=100;p.deliveryBounds.x+=100;p.projectedAxis.leading.x+=100;p.projectedAxis.trailing.x+=100;},
  p=>{p.deliveryBounds.x+=100;p.projectedAxis.leading.x+=100;p.projectedAxis.trailing.x+=100;},
 ]){const rows=samples();for(const row of rows)if(['rotating','flying','staging','intake'].includes(row.preview.evidence.phase))mutate(row.preview.evidence.paperlab);assert.equal(contract.analyseDelivery(rows).result,'FAIL');}
});
test('intake requires bound GPU plane plus actual clipped triangle extents and surviving vertices',()=>{
 for(const alter of [p=>p.material.clippingPlanes=[],p=>p.visibleGeometryBounds={...p.deliveryBounds},p=>p.deliveryVisibleVertexCount=9999,p=>delete p.visibleGeometryBounds,p=>p.visibleGeometryBounds.height=.0000001]){
  const rows=samples();alter(rows[20].preview.evidence.paperlab);assert.equal(contract.analyseDelivery(rows).result,'FAIL');
 }
 const a=samples()[20].preview.evidence,b=structuredClone(a);b.paperlab.intakeProgress+=.02;b.paperlab.intakeLeadingY+=5;b.paperlab.intakeTrailingY+=5;
 assert.equal(contract.analysePartialPair(a,b).result,'FAIL','intent tail counters without shorter actual geometry are insufficient');
});
module.exports={samples};
