'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const contract=require('../scripts/qa-delivery-contract.cjs');
function samples(){
 const specs=[[0,'point',2],[1000,'unfold',30],[2500,'writing',40],[4200,'hold',40],[4700,'hold',40],[5200,'hold',40],[5700,'hold',40],[6100,'hold',40],[6250,'folding',45],[6500,'folding',55],[6800,'folding',65],[7000,'flying',75],[7300,'flying',85],[7600,'flying',95],[7800,'intake',105],[7900,'intake',115],[8050,'intake',125],[8200,'hidden',126],[9100,'hidden',126]];
 return specs.map(([t,phase,draw])=>{const folding=phase==='folding',flying=phase==='flying',intake=phase==='intake',hidden=phase==='hidden',delivery=folding||flying||intake;
  const d={deliveryPhase:delivery?phase:hidden?'hidden':'none',foldBottom:folding?Math.min(1,(t-6150)/300):delivery||hidden?1:0,foldMiddle:folding?Math.max(0,(t-6500)/300):delivery||hidden?1:0,flightProgress:flying?(t-6900)/800:intake||hidden?1:0,intakeProgress:intake?(t-7750)/400:hidden?1:0,deliveryTargetId:'preview-right',deliveryTargetValid:!hidden,deliveryClipped:intake&&t>=7900};
  const p={engine:'paperlab',libraryVersion:'0.8.1',materialReady:true,error:null,canvasVisible:phase==='point'||phase==='unfold'||delivery,actualDrawCount:draw,actualClearCount:hidden?1:0,metadataHash:'1234abcd',textureHash:'abcdef12',textureRasterizations:2,flameCount:0};
  return {at:new Date(1700000000000+t).toISOString(),captureStatus:{},preview:{visible:true,evidence:{phase,generation:2,elapsedMs:t,playing:!hidden,svgVisible:phase==='writing'||phase==='hold',writing:t<1950?0:t<4150?.5:1,burn:0,visibleGlyphs:t<1950?0:t<4150?10:20,totalGlyphs:20,holdStartMs:4150,leaveAtMs:6150,hideAtMs:8200,rafCount:draw,paperlab:p,delivery:d}}};
 });
}
test('natural delivery requires a real ready renderer, exact 2s contract, progressive folds/flight/intake and stopped hidden output',()=>{
 assert.equal(contract.analyseDelivery(samples()).result,'PASS');
});
test('natural delivery rejects old fire, skipped intake, missing clipping, active hold and screenshots',()=>{
 for(const [mutate,reason]of [[r=>r[9].preview.evidence.paperlab.flameCount=1,'unexpected-fire'],[r=>r.splice(14,3),'phase-not-observed:intake'],[r=>r.forEach(x=>x.preview.evidence.delivery.deliveryClipped=false),'intake-not-clipped'],[r=>r[5].preview.evidence.paperlab.actualDrawCount++,'hold-kept-drawing'],[r=>r[9].captureStatus.preview='image.png','natural-readback']]){
  const r=samples();mutate(r);assert.equal(contract.analyseDelivery(r).reason,reason);
 }
});
test('unready or stale generation samples and a moving target cannot pass as natural delivery',()=>{
 for(const [mutate,reason]of [[r=>r[0].preview.evidence.paperlab.materialReady=false,'material-not-ready'],[r=>r[10].preview.evidence.generation++,'generation-changed'],[r=>r[13].preview.evidence.delivery.deliveryTargetId='other','target-changed'],[r=>r[13].preview.evidence.delivery.deliveryTargetValid=false,'target-invalid']]){const r=samples();mutate(r);assert.equal(contract.analyseDelivery(r).reason,reason);}
});
test('QA plan owns one isolated profile and permits only fixed delivery example commands',()=>{
 const p=contract.buildDeliveryPlan({root:'C:/project',output:'C:/project/qa/delivery/test',development:true,token:'aabbccdd'});
 assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,240000);
 for(const a of Object.values(p.commands)){assert.ok(a.includes('--preview-qa-only'));assert.ok(a.includes('--user-data-dir='+p.profile));}
 for(const c of ['folding','flying','intake','target-near','target-far','target-left','target-right','target-move','target-hide'])assert.ok(p.commands[c].includes('--preview-qa='+c));
});
test('slow takeoff may overlap the last hinge motion, but the travelling bundle must finish folding',()=>{
 const rows=samples(),e=rows.find(r=>r.preview.evidence.phase==='flying').preview.evidence;
 e.delivery.flightProgress=.02;e.delivery.foldMiddle=.95;
 assert.equal(contract.analyseDelivery(rows).result,'PASS');
 e.delivery.flightProgress=.2;
 assert.equal(contract.analyseDelivery(rows).reason,'takeoff-before-fold-complete');
});
test('hidden clear occurs once, then both draws and clears stop',()=>{
 const rows=samples();rows.at(-1).preview.evidence.paperlab.actualClearCount++;
 assert.equal(contract.analyseDelivery(rows).reason,'hidden-kept-drawing');
 const missing=samples();for(const r of missing)r.preview.evidence.paperlab.actualClearCount=0;
 assert.equal(contract.analyseDelivery(missing).reason,'hidden-not-cleared');
});
test('two paused intake proofs must show a tip already past the plane and a progressively shorter remaining tail',()=>{
 const a={paperlab:{metadataHash:'a'},delivery:{deliveryTargetId:'target',deliveryClipped:true,intakeLeadingY:110,intakeTrailingY:70,intakePlaneY:100,intakeProgress:.8}};
 const b={paperlab:{metadataHash:'a'},delivery:{...a.delivery,intakeLeadingY:125,intakeTrailingY:85,intakeProgress:.9}};
 assert.equal(typeof contract.analysePartialPair,'function');
 assert.equal(contract.analysePartialPair(a,b).result,'PASS');
 assert.equal(contract.analysePartialPair(a,{...b,delivery:{...b.delivery,intakeTrailingY:65}}).result,'FAIL');
 assert.equal(contract.analysePartialPair({...a,delivery:{...a.delivery,intakeLeadingY:90}},b).result,'FAIL');
});
module.exports={samples};
