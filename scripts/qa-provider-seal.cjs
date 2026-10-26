'use strict';
// Fixed commands in our isolated local preview. Never observes a host app/Pet.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {deadline}=require('./qa-paperlab-preview.cjs');
const {buildProviderSealPlan,materialReady,pausedSealReady,analyseProviderSeal,analysePartialPair}=require('./qa-provider-seal-contract.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),check=(yes,reason)=>{if(!yes)throw Error(reason)};
async function main(args=process.argv.slice(2)){
 const root=path.resolve(__dirname,'..'),option=k=>{const i=args.indexOf(k);return i<0?null:args[i+1]};
 const output=path.join(root,'qa/provider-seal',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 const plan={...buildProviderSealPlan({root,output,development:args.includes('--development'),token:crypto.randomBytes(8).toString('hex')}),classification:'ISOLATED_OWN_LOCAL_PROVIDER_SEAL',naturalReadback:false};
 if(args.includes('--dry-run')){process.stdout.write(JSON.stringify(plan)+'\n');return plan;}
 await fsp.mkdir(plan.captures,{recursive:true});const reportPath=path.join(output,'report.json');
 const report={classification:plan.classification,result:'RUNNING',startedAt:new Date().toISOString(),output,profile:plan.profile,natural:[],captures:[],lifecycle:{result:'NOT_TESTED'},visual:'NOT_TESTED_PENDING_CONTINUOUS_HUMAN_REVIEW',pixelClearing:'NOT_TESTED_PREVIEW_OPAQUE_STAGE',realSendHook:'NOT_TESTED',realPet:'NOT_APPLICABLE_LOCAL_SEAL',mixedDpi:'NOT_TESTED',otherSystems:'NOT_TESTED'};
 const persist=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});persist();
 let app,aborted=false,executable,watchdog;const children=new Set(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const fail=reason=>{report.failure ||= reason;report.result='FAIL';persist()};
 const readRows=async()=>{try{const b=await fsp.readFile(plan.diagnostics);check(b.length<64*1024*1024,'diagnostics-buffer-limit');return b.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})}catch(e){if(e.code==='ENOENT')return[];throw e}};
 const latest=async()=>(await readRows()).at(-1);
 const until=async(read,ms,reason)=>{const end=Date.now()+ms;while(Date.now()<end){check(!aborted,'total-watchdog-expired');const r=await read();if(r)return r;await sleep(35)}throw Error(reason)};
 const command=async(name,force=false)=>{
  check(force||!aborted,'total-watchdog-expired');check(plan.commands[name],'unknown-command');
  const child=spawn(executable,plan.commands[name],{cwd:root,env,shell:false,windowsHide:true,stdio:'ignore'});children.add(child);
  try{await deadline(new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('command-launch-failed')));child.once('exit',code=>code===0?resolve():reject(Error('command-exit-failed')))}),10000,'command-timeout',{onTimeout:()=>child.kill()})}finally{children.delete(child)}
 };
 const hiddenNow=async()=>until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.phase==='hidden'&&!e.playing&&!e.paperlab.canvasVisible&&!e.svgVisible&&!e.paperlab.markVisible?r:null},25000,'presentation-not-cleared');
 const stableHidden=async(first,windowHidden=false)=>{
  const b=first.preview.evidence;
  const tail=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation===b.generation&&e.phase==='hidden'&&Date.parse(r.at)-Date.parse(first.at)>=800&&(!windowHidden||r.preview.visible===false)?r:null},5000,'hidden-stability-missing');
  const rows=(await readRows()).filter(r=>r.preview?.evidence?.generation===b.generation&&Date.parse(r.at)>=Date.parse(first.at));
  check(rows.every(r=>{const e=r.preview.evidence,p=e.paperlab;return e.phase==='hidden'&&!e.svgVisible&&!p.canvasVisible&&!p.markVisible&&p.markOpacity===0&&p.actualDrawCount===b.paperlab.actualDrawCount&&p.actualClearCount===b.paperlab.actualClearCount&&p.markRenderCount===b.paperlab.markRenderCount&&e.rafCount===b.rafCount}),'hidden-kept-drawing');return tail;
 };
 const fresh=async(name)=>{const prior=(await latest()).preview.evidence.generation;await command(name);return until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>prior&&e.playing&&materialReady(e)?r:null},15000,'new-generation-not-ready:'+name)};
 const natural=async(scenario)=>{
  for(const c of [scenario.background,scenario.layout,'speed-'+scenario.speed])await command(c);
  const start=await fresh('seal-'+scenario.provider),generation=start.preview.evidence.generation;
  await until(async()=>{const r=await latest(),e=r?.preview?.evidence;check(!e||e.generation===generation,'natural-generation-changed');if(e?.paperlab?.error)throw Error('material-error');return e?.phase==='hidden'&&!e.playing?r:null},35000,'natural-playback-did-not-finish');
  await stableHidden(await hiddenNow());
  const rows=(await readRows()).filter(r=>r.preview?.evidence?.generation===generation&&Date.parse(r.at)>=Date.parse(start.at));
  const result=analyseProviderSeal(rows,scenario);report.natural.push({...scenario,...result});persist();check(result.result==='PASS',result.reason);
 };
 const capture=async(label,evidence)=>{
  const old=new Set(await fsp.readdir(plan.captures));await command('capture');
  const file=await until(async()=>{const n=(await fsp.readdir(plan.captures)).find(n=>n.endsWith('-preview.png')&&!old.has(n));return n&&path.join(plan.captures,n)},4000,'capture-file-timeout');
  const current=(await latest()).preview.evidence;check(current.generation===evidence.generation&&current.paperlab.metadataHash===evidence.paperlab.metadataHash&&!current.playing,'capture-stage-changed');
  const bytes=await fsp.readFile(file);check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'capture-not-png');
  report.captures.push({stage:label,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),evidence:current,classification:'PAUSED_OWN_PREVIEW_IMAGE_NOT_NATURAL_PLAYBACK'});persist();
 };
 const atFlight=async()=>{await command('speed-1');await command('layout-wide');await fresh('seal-brand');return until(async()=>{const r=await latest();return r?.preview?.evidence?.phase==='flying'&&r.preview.evidence.playing?r:null},12000,'flight-not-observed')};
 try{
  const requested=option('--executable');check(process.platform==='win32'&&requested&&path.isAbsolute(requested),'absolute-workspace-executable-required');
  executable=path.resolve(requested);const relative=path.relative(root,executable);check(!relative.startsWith('..')&&!path.isAbsolute(relative),'workspace-candidate-required');await fsp.access(executable);
  report.command={executable,argv:plan.commands.start};persist();
  watchdog=setTimeout(()=>{aborted=true;fail('external-total-watchdog');for(const c of children)if(c.exitCode===null)c.kill();if(app?.exitCode===null)app.kill();process.exitCode=1},plan.totalDeadlineMs);
  app=spawn(executable,plan.commands.start,{cwd:root,env,shell:false,windowsHide:false,stdio:'ignore'});let launchFailed=false;app.once('error',()=>{launchFailed=true});
  await until(async()=>{check(!launchFailed&&app.exitCode===null,'preview-launch-failed');const r=await latest();return r?.preview?.evidence?.playing&&materialReady(r.preview.evidence)?r:null},30000,'material-ready-timeout');
  for(const scenario of [
   {provider:'brand',background:'bg-dark',layout:'layout-wide',speed:1},
   {provider:'generic',background:'bg-dark',layout:'layout-wide',speed:1},
   {provider:'brand',background:'bg-light',layout:'layout-wide',speed:1},
   {provider:'generic',background:'bg-light',layout:'layout-compact',speed:1},
   {provider:'brand',background:'bg-dark',layout:'layout-compact',speed:1},
   {provider:'generic',background:'bg-dark',layout:'layout-wide',speed:.5}])await natural(scenario);
  report.naturalSealedAt=new Date().toISOString();persist();await command('speed-1');await command('layout-wide');await fresh('seal-brand');
  for(const stage of ['hold','rolling-start','rolling','rolled','rotating','flying','intake-tip','intake-tail','seal-receipt','seal-exit']){
   const prior=(await latest()).preview.evidence.generation;await command(stage);
   const row=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>prior&&pausedSealReady(e,stage)?r:null},12000,'paused-stage-not-ready:'+stage);await capture(stage,row.preview.evidence);
  }
  report.partialIntakeGeometry=analysePartialPair(report.captures.find(c=>c.stage==='intake-tip').evidence,report.captures.find(c=>c.stage==='intake-tail').evidence);check(report.partialIntakeGeometry.result==='PASS',report.partialIntakeGeometry.reason);
  await command('stop');const cleared=await hiddenNow();await stableHidden(cleared);await capture('hidden',cleared.preview.evidence);
  const checks=[];
  for(const action of ['stop','geometry-resize']){await atFlight();await command(action);await stableHidden(await hiddenNow());await command('resume');await sleep(400);check((await latest()).preview.evidence.phase==='hidden','cancelled-run-revived');checks.push({action,result:'PASS'})}
  await atFlight();await command('hide');await stableHidden(await hiddenNow(),true);await command('show');await command('resume');await sleep(400);check((await latest()).preview.evidence.phase==='hidden','show-revived-old-run');checks.push({action:'window-hide-show',result:'PASS'});
  await atFlight();await command('pause');const paused=(await latest()).preview.evidence;await sleep(500);const fixed=(await latest()).preview.evidence;
  check(!fixed.playing&&fixed.paperlab.actualDrawCount===paused.paperlab.actualDrawCount&&fixed.paperlab.markRenderCount===paused.paperlab.markRenderCount,'paused-draws-continued');
  await command('resume');await stableHidden(await hiddenNow());checks.push({action:'pause-resume',result:'PASS'});
  await atFlight();const old=(await latest()).preview.evidence;const a=await fresh('fixture-a'),b=await fresh('fixture-b'),be=b.preview.evidence;
  check(a.preview.evidence.paperlab.metadataHash!==old.paperlab.metadataHash&&be.paperlab.metadataHash!==a.preview.evidence.paperlab.metadataHash&&be.writing===0,'replacement-not-new-blank');await command('stop');await stableHidden(await hiddenNow());checks.push({action:'metadata-replacement',result:'PASS',singleFrameFlash:'NOT_TESTED_SAMPLED_EVIDENCE'});
  const racing=await fresh('fixture-race'),raceStart=racing.preview.evidence;check(raceStart.writing===0&&raceStart.visibleGlyphs===0,'pending-replacement-not-blank');
  const settled=await until(async()=>{const r=await latest(),p=r?.preview?.evidence?.pendingReplacement;return p?.stalePreparationSettled&&p.activePreparationReady?r:null},15000,'pending-replacement-not-settled');
  check(settled.preview.evidence.generation===raceStart.generation&&settled.preview.evidence.paperlab.metadataHash===be.paperlab.metadataHash,'stale-preparation-overwrote-content');
  await command('stop');await stableHidden(await hiddenNow());checks.push({action:'pending-metadata-replacement',result:'PASS',pendingReplacement:settled.preview.evidence.pendingReplacement});
  await fresh('replay');await command('stop');await stableHidden(await hiddenNow());checks.push({action:'replay',result:'PASS'});
  report.lifecycle={result:'PASS',checks};report.result='PASS';persist();
 }catch(e){fail(e.message);process.exitCode=1}
 finally{
  clearTimeout(watchdog);if(app?.exitCode===null&&!app.killed){try{await command('quit',true)}catch{fail('own-profile-shutdown-failed')}await sleep(500);if(app.exitCode===null)app.kill()}
  for(const c of children)if(c.exitCode===null)c.kill();report.finishedAt=new Date().toISOString();if(aborted)report.result='FAIL';persist();process.stdout.write(JSON.stringify({result:report.result,report:reportPath,failure:report.failure||null})+'\n');
 }
 return report;
}
if(require.main===module)main().catch(e=>{process.stderr.write('Provider seal QA: '+e.message+'\n');process.exitCode=1});
module.exports={main};
