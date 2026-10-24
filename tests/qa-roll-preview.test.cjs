'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const location=require('node:path').join(__dirname,'../scripts/qa-roll-preview.cjs');
const qa=fs.existsSync(location)?require(location):null;
const good=()=>Array.from({length:21},(_,i)=>{
 const elapsed=Math.min(i*50,850),fraction=elapsed/850,phase=elapsed===0?'flat':elapsed===850?'rolled':'rolling';
 return {at:new Date(1700000000000+i*50).toISOString(),state:{generation:1,phase,elapsedMs:elapsed,speed:1,playing:elapsed<850,ready:true,rafCount:Math.min(i,17),textureMode:'bands',renderer:{
  engine:'paperlab',libraryVersion:'0.8.1',materialReady:true,error:null,phase,canvasVisible:true,actualDrawCount:Math.min(i,17)+1,actualClearCount:0,metadataHash:'meta-a',textureHash:'texture-a',uvHash:'same-uv',uvInitialHash:'same-uv',meshId:'one-mesh',geometryId:'one-geometry',vertexCount:12000,
  rolledFraction:fraction,measuredWoundFraction:fraction,radius:.025+.15*fraction,topDriftDIP:0,rootPosition:[0,0,0],rootRotation:[0,0,0],rootScale:[1,1,1],backHasReadableInk:false,finiteNormals:true,geometryPositionHash:elapsed===0?'flat':('positions-'+elapsed),
  cameraPosition:[0,0,10],cameraQuaternion:[0,0,0,1],cameraProjectionHash:'fixed-camera',
  material:{opacity:1,showThrough:0,backSource:'generated-blank-paper',depthTest:true,depthWrite:true,frontTextureId:'front',backTextureId:'back'},
 }}};
});
test('roll QA requires the actual shared Paperlab geometry and stationary original UV/pose',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 assert.equal(qa.analyseNatural(good()).result,'PASS');
 for(const [field,value,reason]of [['uvHash','changed','uv-changed'],['meshId','duplicate','mesh-changed'],['topDriftDIP',8,'top-drift'],['rootScale',[1,.2,1],'root-pose-changed'],['rootRotation',[0,0,1],'root-pose-changed'],['backHasReadableInk',true,'readable-back'],['vertexCount',4,'invalid-mesh'],['geometryPositionHash','flat','geometry-not-deformed']]){
  const rows=good();rows[8].state.renderer[field]=value;
  assert.equal(qa.analyseNatural(rows).reason,reason,field);
 }
});
test('roll natural QA rejects screenshot readback, metadata replacement and moving terminal geometry',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 for(const mutate of [r=>r[8].capture=true,r=>r[8].state.renderer.metadataHash='new-content',r=>r.at(-1).state.renderer.actualDrawCount++]){
  assert.equal(qa.analyseNatural((r=>{mutate(r);return r})(good())).result,'FAIL');
 }
});
test('roll QA does not accept only endpoints, reverse progression, flat scale illusion or transparent final state',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 assert.equal(qa.analyseNatural([good()[0],good().at(-1)]).result,'FAIL');
 for(const change of [r=>r[8].state.renderer.rolledFraction=0,r=>r[8].state.renderer.radius=.001,r=>r[8].state.renderer.material.opacity=.1,r=>r.at(-1).state.renderer.canvasVisible=false]){
  const rows=good();change(rows);assert.equal(qa.analyseNatural(rows).result,'FAIL');
 }
});
test('roll hidden evidence must be blank and terminal counters must stop, without asserting user visual acceptance',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 const visible=good().at(-1).state,hidden={...visible,phase:'hidden',playing:false,renderer:{...visible.renderer,phase:'hidden',canvasVisible:false,actualClearCount:1}};
 assert.equal(qa.analyseHidden(hidden,{...hidden},0).result,'PASS');
 assert.equal(qa.analyseHidden(hidden,{...hidden,rafCount:hidden.rafCount+1},0).result,'FAIL');
 assert.equal(qa.analyseHidden(hidden,hidden,1).result,'FAIL');
 assert.equal(qa.analyseHidden(hidden,hidden,null).result,'NOT_TESTED','a painted HTML stage must not be labelled GPU alpha zero');
 assert.equal(qa.analyseNatural(good()).visualAcceptance,'PENDING_USER_CONTINUOUS_REVIEW');
});
test('roll runner plan uses only the isolated local preview and exact approved mode',()=>{
 assert.ok(qa,'the independent roll runner must exist');
 const plan=qa.buildPlan({root:'C:/project',output:'C:/project/qa/roll/one',token:'0123abcd',development:true});
 assert.match(plan.args[0],/desktop[\\/]roll-preview-main\.cjs$/);
 assert.ok(plan.args.includes('--qa-roll-preview'));
 assert.ok(!plan.args.join(' ').includes('desktop/main.cjs'));
 assert.equal(plan.naturalReadback,false);
 assert.throws(()=>qa.buildPlan({root:'C:/project',output:'C:/project/qa/roll/one',token:'../escape',development:true}),/token/);
});
test('roll QA rejects absent actual geometry and camera evidence instead of accepting undefined equality',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 for(const field of ['meshId','geometryId','geometryPositionHash','cameraPosition','cameraQuaternion','cameraProjectionHash','rootPosition','uvInitialHash','metadataHash','textureHash']){
  const rows=good();for(const row of rows)delete row.state.renderer[field];
  assert.equal(qa.analyseNatural(rows).result,'FAIL',field);
 }
});
test('actual preview command validator accepts runner request identities and fixed seek payload',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 assert.equal(typeof qa.commandForRequest,'function','runner commands need an explicit testable boundary');
 const {validateCommand}=require('../desktop/roll-preview-main.cjs');
 for(const action of ['pause','resume','replay','stop','capture','quit']){
  const command=qa.commandForRequest(1,action);assert.deepEqual(validateCommand(command),{requestId:'r1',action});
 }
 const seek=qa.commandForRequest(2,'seek',{elapsedMs:212.5});
 assert.deepEqual(validateCommand(seek),{requestId:'r2',action:'seek',elapsedMs:212.5});
 assert.equal(validateCommand({...seek,requestId:2}),null,'the main process must retain its strict string identity contract');
});
test('roll QA requires measured vertex evidence and rejects missing, invalid or static wound length',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 for(const mutate of [p=>delete p.measuredWoundFraction,p=>p.measuredWoundFraction=NaN,p=>p.measuredWoundFraction=0,p=>delete p.vertexCount,p=>p.vertexCount=NaN,p=>p.vertexCount=1200.5]){
  const rows=good();for(const row of rows)mutate(row.state.renderer);
  assert.equal(qa.analyseNatural(rows).result,'FAIL');
 }
});
test('roll QA requires real growth and multiple changing curved mesh snapshots',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 const constantRadius=good();for(const row of constantRadius)row.state.renderer.radius=.1;
 assert.equal(qa.analyseNatural(constantRadius).result,'FAIL');
 const constantCurve=good();for(const row of constantCurve)if(row.state.phase!=='flat')row.state.renderer.geometryPositionHash='one-curved-frame';
 assert.equal(qa.analyseNatural(constantCurve).result,'FAIL');
});
test('hidden evidence cannot infer stopped counters or a cleared canvas from absent fields',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 const sample=good().at(-1).state,hidden={...sample,phase:'hidden',playing:false,renderer:{...sample.renderer,phase:'hidden',canvasVisible:false,actualClearCount:1}};
 for(const field of ['generation','rafCount','playing']){
  const missing=structuredClone(hidden);delete missing[field];assert.equal(qa.analyseHidden(missing,missing,0).result,'FAIL',field);
 }
 for(const field of ['actualDrawCount','actualClearCount','canvasVisible']){
  const missing=structuredClone(hidden);delete missing.renderer[field];assert.equal(qa.analyseHidden(missing,missing,0).result,'FAIL',field);
 }
});
test('natural terminal counter equality requires actual finite nonnegative counters',()=>{
 assert.ok(qa,'the independent roll evidence validator must exist');
 for(const [scope,field]of [['state','rafCount'],['renderer','actualDrawCount'],['renderer','actualClearCount']])for(const invalid of [undefined,NaN,-1,1.5]){
  const rows=good();for(const row of rows)(scope==='state'?row.state:row.state.renderer)[field]=invalid;
  assert.equal(qa.analyseNatural(rows).result,'FAIL',scope+'.'+field);
 }
});
