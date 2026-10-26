'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const probe=require('../scripts/probe-provider-seal-host.cjs');
test('native seal fixture plan is isolated, synthetic and has no source-event or session argument',()=>{
 const p=probe.plan();assert.equal(p.classification,'SYNTHETIC_OWN_NATIVE_LOCAL_SEAL_NOT_REAL_SEND');
 assert.ok(p.totalDeadlineMs>=110000&&p.totalDeadlineMs<=120000);assert.ok(p.profile.includes('qa'));assert.ok(p.args.includes('--provider-seal-fixture-child'));
 assert.equal(p.args.some(v=>/entrance-file|session-file|codexHome|supported-host-adapter/.test(v)),false);
});
test('native final stability requires both actual paper and SVG mark to remain cleared',()=>{
 const evidence={frame:{phase:'hidden',paperOpacity:0,opacity:0},paperlab:{canvasVisible:false,markVisible:false,markOpacity:0,actualDrawCount:100,actualClearCount:2,markRenderCount:50},rafCount:150};
 const rows=[{atMs:0,evidence:structuredClone(evidence)},{atMs:1000,evidence:structuredClone(evidence)}];
 assert.equal(probe.analyseHidden(rows).result,'PASS');
 for(const mutate of [p=>p.markVisible=true,p=>p.markRenderCount++,p=>p.markOpacity=.01,p=>p.actualDrawCount++]){const bad=structuredClone(rows);mutate(bad[1].evidence.paperlab);assert.throws(()=>probe.analyseHidden(bad),/hidden-kept-drawing/);}
});

test('fixed native fixtures cover reported Sol and Luna without borrowing brand identity for unknown models',()=>{
 assert.equal(typeof probe.makeMetadata,'function');
 const p=probe.plan();assert.deepEqual(p.naturalFixtures,[{kind:'brand',provider:'brand'},{kind:'luna',provider:'brand'},{kind:'generic',provider:'generic'}]);assert.equal(p.captureFixture,'luna');
 for(const [kind,model]of [['brand','gpt-6.1-sol'],['luna','gpt-5.6-luna'],['generic','unmapped-local-fixture']]){
  const data=probe.makeMetadata(kind);assert.equal(data.model,model);assert.equal(data.sources.model,'reported');assert.equal(data.company,null);assert.equal(data.presentation.sessionId,'synthetic-own-seal-'+kind);assert.equal(Object.hasOwn(data,'prompt'),false);
 }
 assert.throws(()=>probe.makeMetadata('arbitrary'),/fixture-kind-invalid/);
 const data=probe.makeMetadata('luna');data.sources.model='demo';assert.equal(probe.makeMetadata('luna').sources.model,'reported');
});
test('native natural evidence preserves the actual frozen layout needed for offline replay without extra metadata',()=>{
 assert.equal(typeof probe.snapshotFixtureGeometry,'function');
 const {prepareLocalSealLayout}=require('../desktop/host-state.cjs');
 const actual=prepareLocalSealLayout({bounds:{x:100,y:100,width:320,height:430},geometry:{targetRect:{x:80,y:65,width:126,height:266},originRect:{x:220,y:375,width:32,height:32}}},{runId:'native-seal-luna',generation:3,layoutVersion:1,provider:{providerId:'openai',kind:'brand',assetId:'openai-blossom',source:'reported-model+reviewed-catalog'},workArea:{x:0,y:0,width:1600,height:1200}});assert.ok(actual);
 const enriched=structuredClone(actual);enriched.bounds.note='not-forwarded';enriched.geometry.targetRect.note='not-forwarded';enriched.localSeal.acceptancePoint.extra={arbitrary:'not-forwarded'};enriched.localSeal.provider.extra='not-forwarded';enriched.extra='not-forwarded';
 assert.equal(typeof probe.makeNaturalRecord,'function');
 const record=probe.makeNaturalRecord('native-seal-luna','luna',probe.makeMetadata('luna'),enriched,{result:'PASS',classification:'OWN_LOCAL_PROVIDER_SEAL_NOT_OFFICIAL_PET'});assert.equal(record.classification,'SYNTHETIC_OWN_NATIVE_LOCAL_SEAL_NOT_REAL_SEND');assert.equal(record.analysisClassification,'OWN_LOCAL_PROVIDER_SEAL_NOT_OFFICIAL_PET');assert.equal(record.fixtureModel,'gpt-5.6-luna');assert.equal(record.modelSource,'reported');assert.equal(record.company,null);assert.equal(record.fixture,'luna');assert.equal(record.run,'native-seal-luna');assert.equal(record.readbackDuringNatural,false);
 const saved=probe.snapshotFixtureGeometry(enriched);assert.deepEqual(saved.layout.bounds,actual.bounds);assert.deepEqual(saved.layout.geometry,actual.geometry);assert.deepEqual(saved.localSeal.rect,actual.localSeal.rect);assert.deepEqual(saved.localSeal.acceptancePoint,actual.localSeal.acceptancePoint);assert.equal(saved.localSeal.source,'local-generated-seal');assert.equal(saved.localSeal.runId,'native-seal-luna');assert.equal(saved.localSeal.generation,3);assert.deepEqual(saved.stageRect,{x:0,y:0,width:actual.bounds.width,height:actual.bounds.height});assert.equal(JSON.stringify(saved).includes('not-forwarded'),false);
 for(const mutate of [x=>x.bounds.x=Infinity,x=>x.bounds.width=0,x=>x.geometry.targetRect.y=NaN,x=>x.localSeal.source='supported-host-adapter',x=>x.localSeal.acceptancePoint.x++,x=>x.localSeal.provider.providerId={unbounded:'object'}]){const bad=structuredClone(actual);mutate(bad);assert.throws(()=>probe.snapshotFixtureGeometry(bad),/fixture-/);}
});
