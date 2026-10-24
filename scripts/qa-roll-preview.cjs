'use strict';
// This runner opens only our isolated rolling preview, never the product host or official Pet.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const rollMotion=require('../renderer/roll-motion.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(yes,reason)=>{if(!yes)throw Error(reason)};
const finite=n=>Number.isFinite(n),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const engine=s=>s?.renderer||s?.engine||s?.paperlab;
function commandForRequest(sequence,action,extra={}){
 if(!Number.isSafeInteger(sequence)||sequence<1)throw TypeError('invalid-command-sequence');
 return {type:'roll-preview:command',requestId:'r'+sequence,action,...(action==='seek'?{elapsedMs:extra.elapsedMs}:{})};
}
function material(p){return p?.material||{};}
function uv(p){return p?.uvHash??p?.uvSignature;}
function meshHash(p){return p?.geometryPositionHash??p?.positionHash??p?.geometryChanged;}
function buildPlan({root,output,token,development}){
 if(!/^[a-f0-9]{8,32}$/.test(token))throw TypeError('invalid-profile-token');
 if(!development)throw TypeError('only-development-preview-is-authorized');
 const profile=path.join(output,'isolated-roll-'+token);
 return {profile,output,naturalReadback:false,totalDeadlineMs:180000,
  args:[path.join(root,'desktop/roll-preview-main.cjs'),'--qa-roll-preview','--qa-output',output,'--user-data-dir='+profile]};
}
function analyseNatural(rows,{speed=1,terminalMinMs=100}={}){
 const fail=reason=>({result:'FAIL',reason});
 const samples=rows.filter(r=>r?.state&&engine(r.state)).map(row=>({row,e:row.state,p:engine(row.state)}));
 if(samples.length<8)return fail('insufficient-continuous-samples');
 const first=samples[0],p0=first.p,poseKeys=['rootPosition','rootRotation','rootScale','cameraPosition','cameraQuaternion','cameraProjectionHash'];
 const vector=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
 const required=['meshId','geometryId','geometryPositionHash','cameraProjectionHash','uvHash','uvInitialHash','metadataHash','textureHash'];
 if(samples.some(s=>required.some(k=>typeof s.p[k]!=='string'||!s.p[k])||!vector(s.p.rootPosition,3)||!vector(s.p.rootRotation,3)||!vector(s.p.rootScale,3)||!vector(s.p.cameraPosition,3)||!vector(s.p.cameraQuaternion,4)))return fail('missing-actual-evidence');
 if(samples.some(s=>s.row.capture===true||s.row.readback===true))return fail('natural-readback');
 if(samples.some(s=>s.e.generation!==first.e.generation))return fail('generation-changed');
 if(samples.some(s=>s.p.engine!=='paperlab'||s.p.libraryVersion!=='0.8.1'||(s.p.materialReady??s.p.ready)!==true||s.p.error))return fail('material-not-ready');
 if(samples.some(s=>[s.e.rafCount,s.p.actualDrawCount,s.p.actualClearCount].some(n=>!Number.isSafeInteger(n)||n<0)||typeof s.e.playing!=='boolean'))return fail('missing-actual-counters');
 if(samples.some(s=>s.p.metadataHash!==p0.metadataHash||s.p.textureHash!==p0.textureHash))return fail('metadata-changed');
 if(samples.some(s=>typeof uv(s.p)!=='string'||uv(s.p)!==uv(p0)||(s.p.uvInitialHash&&uv(s.p)!==s.p.uvInitialHash)))return fail('uv-changed');
 if(samples.some(s=>s.p.meshId!==p0.meshId||s.p.geometryId!==p0.geometryId))return fail('mesh-changed');
 if(samples.some(s=>!finite(s.p.topDriftDIP)||s.p.topDriftDIP>.8))return fail('top-drift');
 if(samples.some(s=>poseKeys.some(k=>!same(s.p[k],p0[k]))||!same(s.p.rootScale,[1,1,1])||!same(s.p.rootRotation,[0,0,0])||(material(s.p).opacity??s.p.opacity)!==1))return fail('root-pose-changed');
 // Source admission is separate from the actual facing/contrast GPU inspection.
 // These flags alone deliberately do not claim that the reverse is visually correct.
 if(samples.some(s=>s.p.backHasReadableInk===true||(material(s.p).showThrough??s.p.showThrough)!==0||material(s.p).backSource!=='generated-paper-with-ink-difference'||material(s.p).forceSinglePass!==true||!finite(material(s.p).backsideInkStrength)||material(s.p).backsideInkStrength<0||material(s.p).backsideInkStrength>.2))return fail('readable-back');
 if(samples.some(s=>!Number.isSafeInteger(s.p.vertexCount)||s.p.vertexCount<1000||(material(s.p).depthTest??s.p.depthTest)!==true||(material(s.p).depthWrite??s.p.depthWrite)!==true||s.p.finiteNormals!==true||s.p.actualDrawCount<1||s.p.canvasVisible!==true))return fail('invalid-mesh');
 const roll=samples.filter(s=>s.e.phase==='rolling'),flat=samples.filter(s=>s.e.phase==='flat'),end=samples.filter(s=>s.e.phase==='rolled');
 if(roll.length<5||!flat.length||end.length<2)return fail('phase-not-observed');
 if(roll.some(s=>meshHash(s.p)===meshHash(p0)||meshHash(s.p)===false||!meshHash(s.p)))return fail('geometry-not-deformed');
 if(new Set(roll.map(s=>s.p.geometryPositionHash)).size<4)return fail('curved-geometry-not-advancing');
 if(samples.some((s,i)=>!finite(s.e.elapsedMs)||!finite(s.p.rolledFraction)||s.p.rolledFraction<0||s.p.rolledFraction>1||(i&&(s.e.elapsedMs<samples[i-1].e.elapsedMs||s.p.rolledFraction<samples[i-1].p.rolledFraction))))return fail('roll-not-monotonic');
 if(samples.some((s,i)=>!finite(s.p.paperlabRadius??s.p.radius)||(i&&(s.p.paperlabRadius??s.p.radius)+1e-8<(samples[i-1].p.paperlabRadius??samples[i-1].p.radius))))return fail('radius-not-growing');
 if((end[0].p.paperlabRadius??end[0].p.radius)<(p0.paperlabRadius??p0.radius)+.005)return fail('radius-not-growing');
 if(samples.some(s=>!finite(s.p.measuredWoundFraction)||s.p.measuredWoundFraction<0||s.p.measuredWoundFraction>1||Math.abs(s.p.measuredWoundFraction-s.p.rolledFraction)>.04))return fail('actual-mesh-length-mismatch');
 if(flat[0].p.rolledFraction!==0||end[0].p.rolledFraction!==1||end[0].e.elapsedMs!==850)return fail('roll-endpoints-invalid');
 const span=Date.parse(end.at(-1).row.at)-Date.parse(end[0].row.at);
 if(span<terminalMinMs)return fail('terminal-hold-not-observed');
 if(end.some(s=>s.e.playing||s.p.actualDrawCount!==end[0].p.actualDrawCount||s.p.actualClearCount!==end[0].p.actualClearCount||s.e.rafCount!==end[0].e.rafCount))return fail('terminal-kept-drawing');
 const wall=Date.parse(end[0].row.at)-Date.parse(flat[0].row.at),visual=end[0].e.elapsedMs-flat[0].e.elapsedMs;
 if(Math.abs(wall*speed-visual)>220)return fail('clock-speed-mismatch');
 return {result:'PASS',sampleCount:samples.length,rollingSamples:roll.length,generation:first.e.generation,speed,durationMs:850,terminalObservedMs:span,
  actualDraws:end[0].p.actualDrawCount,maxTopDriftDIP:Math.max(...samples.map(s=>s.p.topDriftDIP)),radiusFrom:p0.paperlabRadius??p0.radius,radiusTo:end[0].p.paperlabRadius??end[0].p.radius,
  metadataHash:p0.metadataHash,textureHash:p0.textureHash,uvHash:uv(p0),readbackDuringNatural:false,visualAcceptance:'PENDING_USER_CONTINUOUS_REVIEW'};
}
function analyseHidden(before,after,nonZeroAlphaPixels){
 const a=engine(before),b=engine(after),fail=reason=>({result:'FAIL',reason});
 const counter=n=>Number.isSafeInteger(n)&&n>=0;
 if(!a||!b||[before,after].some(s=>!counter(s.generation)||!counter(s.rafCount)||s.playing!==false)||[a,b].some(p=>!counter(p.actualDrawCount)||!counter(p.actualClearCount)||p.canvasVisible!==false))return fail('missing-hidden-evidence');
 if(before.phase!=='hidden'||after.phase!=='hidden')return fail('not-hidden');
 if(before.generation!==after.generation||a.actualDrawCount!==b.actualDrawCount||a.actualClearCount!==b.actualClearCount||before.rafCount!==after.rafCount)return fail('hidden-kept-drawing');
 if(nonZeroAlphaPixels===null||nonZeroAlphaPixels===undefined)return {result:'NOT_TESTED',reason:'painted-stage-capture-is-not-gpu-alpha-proof',counterResult:'PASS',canvasRemoved:after.canvasPresent===false};
 if(nonZeroAlphaPixels!==0)return fail('hidden-pixels-remain');
 return {result:'PASS',classification:'OWN_CANVAS_ZERO_ALPHA_NOT_OFFICIAL_PET',nonZeroAlphaPixels};
}
async function main(args=process.argv.slice(2)){
 const root=path.resolve(__dirname,'..'),output=path.join(root,'qa/roll',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 const plan=buildPlan({root,output,token:crypto.randomBytes(8).toString('hex'),development:args.length===1&&args[0]==='--development'});
 await fsp.mkdir(output,{recursive:true});
 const reportFile=path.join(output,'report.json'),report={classification:'OWN_STAGE_ONE_ROLL_PREVIEW_NO_REAL_PET',result:'RUNNING',startedAt:new Date().toISOString(),output,profile:plan.profile,natural:[],captures:[],lifecycle:{result:'NOT_TESTED'},resourceRelease:{result:'NOT_TESTED',reason:'Disposed view snapshot cannot observe delayed R3F geometry/material cleanup'},visualAcceptance:'PENDING_USER_CONTINUOUS_REVIEW',realPetPosition:'NOT_TESTED',stageTwo:'NOT_IMPLEMENTED_PENDING_USER_ROLL_APPROVAL',mixedDpi:'NOT_TESTED',otherSystems:'NOT_TESTED'};
 const persist=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});persist();
 const rows=[],acks=new Map();let app,aborted=false,watchdog,request=0,exitError=null,captureStarted=false,stderr='',stdout='';
 const fail=reason=>{report.failure??=reason;report.result='FAIL';persist()};
 const until=async(read,ms,reason)=>{const end=Date.now()+ms;while(Date.now()<end){check(!aborted,'watchdog-expired');check(!exitError,exitError);const value=read();if(value)return value;await sleep(10)}throw Error(reason)};
 const latest=()=>rows.at(-1)?.state;
 const command=async(action,extra={})=>{
  check(app?.connected,'preview-ipc-disconnected');const payload=commandForRequest(++request,action,extra),{requestId}=payload;
  app.send(payload);
  const ack=await until(()=>acks.get(requestId),15000,'command-timeout:'+action);acks.delete(requestId);check(ack.ok!==false,ack.error||'command-rejected:'+action);return ack;
 };
 const fresh=async(action)=>{const old=latest()?.generation??-1;await command(action);return until(()=>{const e=latest();return e?.ready&&e.generation>old&&engine(e)?.materialReady?e:null},25000,'generation-not-ready:'+action)};
 const awaitRolled=()=>until(()=>{const e=latest();return e?.phase==='rolled'&&!e.playing?e:null},8000,'natural-roll-not-finished');
 const atRolling=()=>until(()=>{const e=latest();return e?.phase==='rolling'&&e.elapsedMs>150&&e.elapsedMs<650&&e.playing?e:null},5000,'rolling-not-observed');
 const natural=async(action,speed,textureMode)=>{
  check(!captureStarted,'natural-after-readback');const from=rows.length,start=await fresh(action),generation=start.generation;
  await awaitRolled();await sleep(500);
  const observed=rows.slice(from).filter(r=>r.state.generation===generation&&r.state.ready);
  const result=analyseNatural(observed,{speed,terminalMinMs:350});report.natural.push({action,textureMode,...result});persist();check(result.result==='PASS',result.reason);return result;
 };
 const capture=async(label)=>{
  captureStarted=true;const e=latest();check(e&&!e.playing,'capture-requires-paused-state');const ack=await command('capture'),shot=ack.capture||ack;
  check(typeof shot.file==='string'&&path.relative(output,shot.file)&&!path.relative(output,shot.file).startsWith('..'),'capture-path-outside-output');
  const bytes=await fsp.readFile(shot.file);check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'capture-not-png');
  const item={label,...shot,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),state:e,classification:'PAUSED_IMAGE_NOT_CONTINUOUS_VISUAL_ACCEPTANCE'};report.captures.push(item);persist();return item;
 };
 const hiddenStable=async()=>{
  const before=await until(()=>latest()?.phase==='hidden'?latest():null,5000,'hidden-not-observed');await sleep(450);const after=latest();
  check(before.generation===after.generation&&before.rafCount===after.rafCount&&engine(before).actualDrawCount===engine(after).actualDrawCount,'hidden-counters-advanced');return {before,after};
 };
 try{
  check(process.platform==='win32','windows-first-stage-only');const executable=require('electron');
  check(typeof executable==='string'&&path.isAbsolute(executable)&&path.resolve(executable).startsWith(path.join(root,'node_modules')+path.sep),'workspace-electron-required');await fsp.access(executable);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  report.command={executable,argv:plan.args};persist();
  watchdog=setTimeout(()=>{aborted=true;fail('total-watchdog-expired');if(app?.exitCode===null)app.kill();process.exitCode=1},plan.totalDeadlineMs);
  app=spawn(executable,plan.args,{cwd:root,env,shell:false,windowsHide:false,stdio:['ignore','pipe','pipe','ipc']});
  app.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-5000)});app.stdout.on('data',b=>{stdout=(stdout+b.toString()).slice(-3000)});
  app.once('error',e=>{exitError='preview-spawn-error:'+e.message});app.once('exit',(code,signal)=>{if(report.result==='RUNNING')exitError='preview-exited:'+code+':'+signal});
  app.on('message',message=>{
   if(message?.type==='roll-preview:ack')acks.set(message.requestId,message);
   if(message?.type==='roll-preview:evidence'&&message.state){
    const row={at:message.at||new Date().toISOString(),state:message.state,window:message.window,environment:message.environment};rows.push(row);
    if(rows.length>12000){aborted=true;fail('evidence-row-limit');app.kill()}
    if(message.environment&&!report.environment)report.environment=message.environment;
   }
  });
  await until(()=>latest()?.ready&&engine(latest())?.materialReady,30000,'initial-material-not-ready');
  await command('speed-1');await natural('texture-bands',1,'bands');
  await command('speed-0.5');await natural('replay',.5,'bands');
  await command('speed-1');await natural('texture-talisman',1,'talisman');
  report.naturalSealedAt=new Date().toISOString();persist();
  // Readback begins only after all uninterrupted natural runs have been sealed.
  for(const mode of ['bands','talisman']){
   await fresh('texture-'+mode);await command('pause');await until(()=>latest()?.ready&&!latest().playing,5000,'capture-pause-not-observed');
   for(const chapter of ['flat','start','half','closing','rolled']){
    const expected=chapter==='flat'?0:rollMotion.chapterElapsed(chapter);
    await command(chapter);await until(()=>latest()?.ready&&!latest().playing&&Math.abs(latest().elapsedMs-expected)<.1,10000,'chapter-not-ready');await capture(mode+'-'+chapter);
   }
  }
  const checks=[];
  await fresh('replay');await atRolling();await command('pause');const paused=await until(()=>latest()?.ready&&!latest().playing?latest():null,5000,'pause-not-observed');await sleep(350);const still=latest();
  check(!still.playing&&still.elapsedMs===paused.elapsedMs&&still.rafCount===paused.rafCount&&engine(still).actualDrawCount===engine(paused).actualDrawCount,'pause-kept-drawing');
  await command('resume');await awaitRolled();checks.push({action:'pause-resume',result:'PASS'});
  await command('half');const half=await until(()=>latest()?.ready&&!latest().playing&&Math.abs(engine(latest()).rolledFraction-.5)<.002?latest():null,5000,'half-length-chapter-wrong');
  await command('seek',{elapsedMs:212.5});const scrub=await until(()=>latest()?.ready&&!latest().playing&&Math.abs(latest().elapsedMs-212.5)<.1?latest():null,5000,'scrub-not-exact');checks.push({action:'chapter-half-and-scrub',result:'PASS'});
  await fresh('replay');await atRolling();await command('stop');const clear=await hiddenStable();const shot=await capture('cancel-hidden');
  report.pixelClearing=analyseHidden(clear.before,clear.after,shot.nonZeroAlphaPixels);check(report.pixelClearing.result!=='FAIL',report.pixelClearing.reason);
  const resources=engine(clear.after)?.resources;report.resourceRelease.cancelSnapshot=resources||null;
  report.resourceRelease.ownTextures=resources&&resources.ownedTextures>0&&resources.disposedTextures===resources.ownedTextures?'PASS_SYNCHRONOUS_DISPOSE_EVENTS':'NOT_TESTED';
  await command('resume');await sleep(250);check(latest()?.phase==='hidden'&&!latest().playing,'cancelled-generation-resurrected');checks.push({action:'cancel-sticky',result:'PASS'});
  await fresh('replay');await atRolling();await command('hide');await hiddenStable();await command('show');await command('resume');await sleep(250);check(latest()?.phase==='hidden'&&!latest().playing,'window-hide-show-revived');checks.push({action:'actual-window-hide-show',result:'PASS'});
  const a=await fresh('fixture-a');await atRolling();const aHash=engine(a).metadataHash;
  const index=rows.length,b=await fresh('fixture-b');await awaitRolled();const newRows=rows.slice(index).filter(r=>r.state.generation===b.generation&&r.state.ready);
  check(engine(b).metadataHash!==aHash&&engine(b).textureHash!==engine(a).textureHash,'fixture-metadata-not-replaced');
  check(newRows.some(r=>r.state.phase==='flat'&&engine(r.state).rolledFraction===0),'replacement-did-not-start-flat');
  check(newRows.every(r=>engine(r.state).metadataHash===engine(b).metadataHash),'replacement-content-not-frozen');
  checks.push({action:'active-content-replacement',result:'PASS',classification:'FIXED_SYNTHETIC_LOCAL_TASKS',singleFrameOldFlash:'NOT_TESTED_SAMPLED_TELEMETRY'});
  // Two rapid replacements exercise pending readiness ownership; the last generation owns the result.
  const beforeRapid=latest().generation;await command('texture-bands');
  const preparing=await until(()=>latest()?.generation>beforeRapid&&latest().textureMode==='bands'&&latest().preparing?latest():null,5000,'pending-preparation-not-observed');
  await command('texture-talisman');
  const lastPrepared=await until(()=>latest()?.generation>preparing.generation&&latest().ready&&latest().textureMode==='talisman'?latest():null,30000,'last-preparation-not-ready');await awaitRolled();await sleep(350);
  check(latest().textureMode==='talisman'&&latest().generation===lastPrepared.generation,'late-ready-overwrote-new-content');checks.push({action:'rapid-pending-replacement',result:'PASS',cancelledPreparingGeneration:preparing.generation,activeGeneration:lastPrepared.generation,singleFrameOldFlash:'NOT_TESTED_SAMPLED_TELEMETRY'});
  report.lifecycle={result:'PASS',checks};report.result='PASS';persist();
 }catch(error){fail(error.message);process.exitCode=1}
 finally{
  if(app?.connected){try{await command('quit')}catch(e){report.shutdownError=e.message}}
  if(app?.exitCode===null){await sleep(350);if(app.exitCode===null)app.kill()}
  clearTimeout(watchdog);report.finishedAt=new Date().toISOString();report.stderrTail=stderr;report.stdoutTail=stdout;
  await fsp.writeFile(path.join(output,'runtime.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});persist();
  process.stdout.write(JSON.stringify({result:report.result,report:reportFile,failure:report.failure||null})+'\n');
 }
 return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write('Roll QA preflight failed: '+error.message+'\n');process.exitCode=1});
module.exports={buildPlan,analyseNatural,analyseHidden,commandForRequest,main};
