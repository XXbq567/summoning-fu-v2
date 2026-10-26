'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {samples:oldSamples}=require('./helpers/rolled-delivery-samples.cjs');
const contract=require('../scripts/qa-provider-seal-contract.cjs');
function samples(){
 const rows=oldSamples();
 for(const row of rows){const e=row.preview.evidence,p=e.paperlab,t=e.elapsedMs;
  for(const value of [p.deliverySourcePivot,p.deliveryPosition,p.deliveryBounds,p.visibleGeometryBounds,p.projectedAxis?.leading,p.projectedAxis?.trailing])if(value)value.y+=20;
  for(const key of ['intakeLeadingY','intakeTrailingY','intakePlaneY'])if(Number.isFinite(p[key]))p[key]+=20;
  e.hideAtMs=8800;e.localSeal={source:'local-generated-seal',coordinateSpace:'overlay-local-dip',runId:'fixture',generation:2,layoutVersion:1,rect:{x:350,y:620,width:100,height:100},acceptancePoint:{x:400,y:670},provider:{providerId:'openai',kind:'brand',assetId:'openai-blossom',source:'demo-preview'}};
  e.stageRect={x:10,y:20,width:900,height:1000};
  Object.assign(p,{source:'local-generated-seal',providerId:'openai',providerKind:'brand',providerAssetId:'openai-blossom',providerSource:'demo-preview',markPhase:t<5950?'hidden':t<6150?'appearing':t<8400?'receiving':'hidden',markVisible:t>=5950&&t<8400,markRenderCount:t<5950?0:Math.floor(t/10),markLogoTransform:'rotate(0 50 50)',markRingTransform:'rotate('+t/100+' 50 50)',markGroupTransform:'translate(50 50) scale(1) translate(-50 -50)',markOpacity:t>=5950&&t<8400?1:0,markBounds:t>=5950&&t<8400?{x:360,y:640,width:100,height:100}:null,markPointerEvents:'none',markClassification:'OWN_SVG_DOM_GEOMETRY',markAttached:true});
  p.deliveryTargetId='local-seal:fixture:2';
 }
 const proto=structuredClone(rows.find(r=>r.preview.evidence.phase==='staging'));
 const added=[];for(const [t,phase]of [[8400,'seal-ack'],[8480,'seal-ack'],[8570,'seal-ack'],[8620,'seal-exit'],[8700,'seal-exit'],[8780,'seal-exit']]){
  const r=structuredClone(proto),e=r.preview.evidence,p=e.paperlab;r.at=new Date(1700000000000+t).toISOString();e.phase=phase;e.elapsedMs=t;e.svgVisible=false;p.canvasVisible=false;p.markVisible=true;p.markPhase=phase==='seal-ack'?'acknowledging':'disappearing';p.markOpacity=phase==='seal-ack'?1:(8800-t)/200;p.markRingTransform='rotate('+t/100+' 50 50)';p.markRenderCount=t;p.markBounds={x:360,y:640,width:100,height:100};p.actualDrawCount=160;p.actualClearCount=1;e.rafCount=t;added.push(r);
 }
 const hidden=rows.filter(r=>r.preview.evidence.phase==='hidden');for(const r of hidden){r.preview.evidence.elapsedMs+=400;r.at=new Date(Date.parse(r.at)+400).toISOString();r.preview.evidence.rafCount=8800;r.preview.evidence.paperlab.markRenderCount=8780;}
 return [...rows.filter(r=>r.preview.evidence.phase!=='hidden'),...added,...hidden];
}
test('provider seal validator accepts actual local geometry, stationary logo, rotating ring and complete receipt',()=>{
 const result=contract.analyseProviderSeal(samples(),{provider:'brand'});assert.equal(result.result,'PASS',result.reason);assert.equal(result.holdContractMs,2000);
});
test('actual DOM rotation, static ring, forged provider, false source, missing clip, shortened hold and truncated receipt fail',()=>{
 const changes=[r=>r[15].preview.evidence.paperlab.markLogoTransform='rotate(24 50 50)',
 r=>r.forEach(v=>v.preview.evidence.paperlab.markRingTransform='rotate(0 50 50)'),
 r=>r[15].preview.evidence.paperlab.providerAssetId='evil',
 r=>r[15].preview.evidence.paperlab.source='supported-host-adapter',
 r=>r.find(v=>v.preview.evidence.phase==='intake').preview.evidence.paperlab.material.clippingPlanes=[],
 r=>r.forEach(v=>v.preview.evidence.leaveAtMs=6000),
 r=>{for(let i=r.length-1;i>=0;i--)if(r[i].preview.evidence.phase==='seal-exit')r.splice(i,1)},
 r=>r.at(-1).preview.evidence.paperlab.markVisible=true,
 r=>r[15].preview.evidence.localSeal.acceptancePoint.y+=20,
    r=>r[15].preview.evidence.localSeal.provider.assetId='generic',
    r=>r.find(v=>v.preview.evidence.phase==='rotating').preview.evidence.paperlab.deliveryBounds.y=-3,
    r=>r.find(v=>v.preview.evidence.phase==='intake').preview.evidence.paperlab.visibleGeometryBounds.x=-3,
 r=>r.find(v=>v.preview.evidence.phase==='hold'&&v.preview.evidence.elapsedMs>5950).preview.evidence.paperlab.markVisible=false];
 for(const change of changes){const rows=samples();change(rows);assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).result,'FAIL');}
 assert.equal(contract.analyseProviderSeal(samples(),{provider:'generic'}).result,'FAIL');
});
test('QA CLI uses own isolated profile, bounded commands and no target/Pet controls',()=>{
 const p=contract.buildProviderSealPlan({root:'C:/project',output:'C:/project/qa/seal/test',development:true,token:'aabbccdd'});
 for(const args of Object.values(p.commands)){assert.ok(args.includes('--preview-qa-only'));assert.ok(args.includes('--user-data-dir='+p.profile));assert.equal(args.some(x=>/entrance-file|session-file|target-drag/.test(x)),false);}
 for(const c of ['seal-brand','seal-generic','seal-receipt','seal-exit','bg-dark','bg-light','layout-compact','layout-wide','geometry-resize'])assert.ok(p.commands[c]);
});
test('visible paper and the full local composition must fit the stage even when the logo fits',()=>{
 const rows=samples();for(const row of rows)row.preview.evidence.stageRect.width=450;
 assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).reason,'actual-paper-cropped');
});
test('independent paused chapters require identical local layout/content before comparing progressive clip geometry',()=>{
 const rows=samples(),first=structuredClone(rows.filter(r=>r.preview.evidence.phase==='intake')[2].preview.evidence),last=structuredClone(first);
 last.paperlab.intakeProgress+=.1;for(const b of [last.paperlab.deliveryPosition,last.paperlab.deliveryBounds,last.paperlab.visibleGeometryBounds,last.paperlab.projectedAxis.leading,last.paperlab.projectedAxis.trailing])b.y+=40;
 last.paperlab.intakeLeadingY+=40;last.paperlab.intakeTrailingY+=40;last.paperlab.visibleGeometryBounds.height-=40;last.paperlab.deliveryVisibleVertexCount-=100;
 last.generation++;last.localSeal.generation++;last.localSeal.runId='next-chapter';last.paperlab.deliveryTargetId='local-seal:next-chapter:3';
 assert.equal(contract.analysePartialPair(first,last).result,'PASS');
 last.localSeal.acceptancePoint.y++;assert.equal(contract.analysePartialPair(first,last).result,'FAIL');
});
test('200ms receipt domains require unique actual frames and bounded transition brackets, not an arbitrary sampled span',()=>{
 const rows=samples(),lastIntake=rows.filter(r=>r.preview.evidence.phase==='intake').at(-1);lastIntake.preview.evidence.elapsedMs=8390;lastIntake.at=new Date(1700000008390).toISOString();
 const ack=rows.filter(r=>r.preview.evidence.phase==='seal-ack'),exit=rows.filter(r=>r.preview.evidence.phase==='seal-exit');
 for(const [row,t]of [...ack.map((r,i)=>[r,[8440,8490,8570][i]]),...exit.map((r,i)=>[r,[8670,8714,8758][i]])]){row.preview.evidence.elapsedMs=t;row.at=new Date(1700000000000+t).toISOString();}
 assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).result,'PASS');
 assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).exitObservedMs,88);
 for(const mutate of [
  r=>{const group=r.filter(v=>v.preview.evidence.phase==='seal-exit');group[0].preview.evidence.elapsedMs=8710;group[1].preview.evidence.elapsedMs=8720;},
  r=>{r.filter(v=>v.preview.evidence.phase==='seal-ack')[0].preview.evidence.elapsedMs=8510;},
  r=>{r.filter(v=>v.preview.evidence.phase==='seal-exit')[0].preview.evidence.elapsedMs=8590;},
  r=>{for(const x of r.filter(v=>v.preview.evidence.phase==='seal-exit'))x.preview.evidence.elapsedMs=8710;},
 ]){const bad=structuredClone(rows);mutate(bad);assert.equal(contract.analyseProviderSeal(bad,{provider:'brand'}).result,'FAIL');}
});
test('identical receipt publications may repeat; conflicting actual DOM at the same animation clock fails',()=>{
 const rows=samples(),index=rows.findIndex(r=>r.preview.evidence.phase==='seal-ack');rows.splice(index+1,0,structuredClone(rows[index]));
 assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).result,'PASS');
 rows[index+1].preview.evidence.paperlab.markRenderCount++;
 assert.equal(contract.analyseProviderSeal(rows,{provider:'brand'}).result,'FAIL');
});
test('independent chapter comparison rejects a different frozen texture including any available front/back hashes',()=>{
 const rows=samples(),first=structuredClone(rows.filter(r=>r.preview.evidence.phase==='intake')[2].preview.evidence),last=structuredClone(first);
 last.paperlab.intakeProgress+=.1;for(const b of [last.paperlab.deliveryPosition,last.paperlab.deliveryBounds,last.paperlab.visibleGeometryBounds,last.paperlab.projectedAxis.leading,last.paperlab.projectedAxis.trailing])b.y+=40;
 last.paperlab.intakeLeadingY+=40;last.paperlab.intakeTrailingY+=40;last.paperlab.visibleGeometryBounds.height-=40;last.paperlab.deliveryVisibleVertexCount-=100;
 last.generation++;last.localSeal.generation++;last.localSeal.runId='next-chapter';last.paperlab.deliveryTargetId='local-seal:next-chapter:3';
 assert.equal(contract.analysePartialPair(first,last).result,'PASS');
 for(const key of ['textureHash','frontTextureHash','backTextureHash']){const a=structuredClone(first),b=structuredClone(last);a.paperlab[key]='first-texture';b.paperlab[key]='changed-texture';assert.equal(contract.analysePartialPair(a,b).result,'FAIL');}
});
module.exports={samples};
