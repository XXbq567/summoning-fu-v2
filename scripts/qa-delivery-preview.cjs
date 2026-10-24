'use strict';
// Only this product's isolated preview and fixed example commands. No real Pet control.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {deadline}=require('./qa-paperlab-preview.cjs');
const {buildDeliveryPlan,materialReady,pausedDeliveryReady,analyseDelivery,analysePartialPair}=require('./qa-delivery-contract.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(yes,reason)=>{if(!yes)throw Error(reason)};
async function main(args=process.argv.slice(2)){
 const root=path.resolve(__dirname,'..'),option=k=>{const i=args.indexOf(k);return i<0?null:args[i+1]};
 const output=path.join(root,'qa/delivery',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 const plan={...buildDeliveryPlan({root,output,development:args.includes('--development'),token:crypto.randomBytes(8).toString('hex')}),classification:'ISOLATED_DELIVERY_PREVIEW_NOT_REAL_PET_TARGET',naturalReadback:false};
 if(args.includes('--dry-run')){process.stdout.write(JSON.stringify(plan)+'\n');return plan;}
 await fsp.mkdir(plan.captures,{recursive:true});const reportPath=path.join(output,'report.json');
 const report={classification:plan.classification,result:'RUNNING',startedAt:new Date().toISOString(),output,profile:plan.profile,natural:[],captures:[],lifecycle:{result:'NOT_TESTED'},visual:'NOT_TESTED_PENDING_IMAGE_REVIEW',pixelClearing:'NOT_TESTED_PENDING_HIDDEN_IMAGE_REVIEW',realPetTarget:'NOT_TESTED',mixedDpi:'NOT_TESTED',otherSystems:'NOT_TESTED'};
 const persist=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600});persist();
 let app,aborted=false;const children=new Set(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const fail=reason=>{report.failure ||= reason;report.result='FAIL';persist();};
 let executable,watchdog;
 const readRows=async()=>{try{const b=await fsp.readFile(plan.diagnostics);check(b.length<16*1024*1024,'diagnostics-buffer-limit');return b.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})}catch(e){if(e.code==='ENOENT')return[];throw e}};
 const latest=async()=>(await readRows()).at(-1);
 const until=async(read,ms,reason)=>{const end=Date.now()+ms;while(Date.now()<end){check(!aborted,'total-watchdog-expired');const r=await read();if(r)return r;await sleep(40)}throw Error(reason)};
 const command=async(name,force=false)=>{
  check(force||!aborted,'total-watchdog-expired');check(plan.commands[name],'unknown-command');
  const child=spawn(executable,plan.commands[name],{cwd:root,env,shell:false,windowsHide:true,stdio:'ignore'});children.add(child);
  try{await deadline(new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('command-launch-failed')));child.once('exit',code=>code===0?resolve():reject(Error('command-exit-failed')))}),10000,'command-timeout',{onTimeout:()=>child.kill()})}finally{children.delete(child)}
 };
 const stableHidden=async(first,windowHidden=false)=>{
  const before=first.preview.evidence;
  const tail=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation===before.generation&&e.phase==='hidden'&&Date.parse(r.at)-Date.parse(first.at)>=800&&(!windowHidden||r.preview.visible===false)?r:null},5000,'hidden-stability-missing');
  const data=(await readRows()).filter(r=>r.preview?.evidence?.generation===before.generation&&Date.parse(r.at)>=Date.parse(first.at));
  check(data.every(r=>{const e=r.preview.evidence;return e.phase==='hidden'&&!e.svgVisible&&!e.paperlab.canvasVisible&&e.paperlab.actualDrawCount===before.paperlab.actualDrawCount&&e.paperlab.actualClearCount===before.paperlab.actualClearCount&&e.paperlab.textureRasterizations===before.paperlab.textureRasterizations&&e.rafCount===before.rafCount}),'hidden-kept-drawing');return tail;
 };
 const hiddenNow=async()=>until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.phase==='hidden'&&!e.playing&&!e.paperlab.canvasVisible&&!e.svgVisible?r:null},15000,'presentation-not-cleared');
 const fresh=async(name)=>{const prior=(await latest()).preview.evidence.generation;await command(name);return until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>prior&&e.playing&&materialReady(e)?r:null},10000,'new-generation-not-ready:'+name)};
 const natural=async(name,speed=1)=>{
  const start=await fresh(name),generation=start.preview.evidence.generation;
  await until(async()=>{const r=await latest(),e=r?.preview?.evidence;check(!e||e.generation===generation,'natural-generation-changed');if(e?.paperlab?.error)throw Error('material-error');return e?.phase==='hidden'&&!e.playing?r:null},25000,'natural-playback-did-not-finish');
  const firstHidden=await hiddenNow();await stableHidden(firstHidden);
  const rows=(await readRows()).filter(r=>r.preview?.evidence?.generation===generation&&Date.parse(r.at)>=Date.parse(start.at));
  const result=analyseDelivery(rows,{speed});report.natural.push({scenario:name,speed,...result});persist();check(result.result==='PASS',result.reason);return result;
 };
 const capture=async(label,evidence)=>{
  const old=new Set(await fsp.readdir(plan.captures));
  const file=await deadline((async()=>{await command('capture');return until(async()=>{const name=(await fsp.readdir(plan.captures)).find(n=>n.endsWith('-preview.png')&&!old.has(n));return name&&path.join(plan.captures,name)},3000,'capture-file-timeout')})(),3000,'capture-timeout');
  const current=(await latest()).preview.evidence;
  check(current.generation===evidence.generation&&current.paperlab.metadataHash===evidence.paperlab.metadataHash&&!current.playing,'capture-stage-changed');
  const bytes=await fsp.readFile(file);check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'capture-not-png');
  report.captures.push({stage:label,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),evidence:current,classification:'PAUSED_IMAGE_NOT_NATURAL_PLAYBACK'});persist();
 };
 const atFlight=async()=>{await fresh('target-right');return until(async()=>{const r=await latest();return r?.preview?.evidence?.phase==='flying'&&r.preview.evidence.playing?r:null},10000,'flight-not-observed')};
 try{
  const requested=option('--executable');check(process.platform==='win32'&&requested&&path.isAbsolute(requested),'absolute-workspace-executable-required');
  executable=path.resolve(requested);const relative=path.relative(root,executable);check(!relative.startsWith('..')&&!path.isAbsolute(relative),'workspace-candidate-required');await fsp.access(executable);
  report.command={executable,argv:plan.commands.start};persist();
  watchdog=setTimeout(()=>{aborted=true;fail('external-total-watchdog');for(const child of children)if(child.exitCode===null)child.kill();if(app?.exitCode===null)app.kill();process.exitCode=1},plan.totalDeadlineMs);
  app=spawn(executable,plan.commands.start,{cwd:root,env,shell:false,windowsHide:false,stdio:'ignore'});let launchFailed=false;app.once('error',()=>{launchFailed=true});
  await until(async()=>{check(!launchFailed&&app.exitCode===null,'preview-launch-failed');const r=await latest(),e=r?.preview?.evidence;return e?.playing&&r.preview.visible&&materialReady(e)?r:null},30000,'delivery-material-ready-timeout');
  for(const scenario of ['target-near','target-far','target-left','target-right'])await natural(scenario);
  await command('speed-0.5');await natural('replay',.5);await command('speed-1');
  // Only now may screenshot readback begin. All five natural runs are sealed.
  await fresh('target-right');
  for(const stage of ['hold','folding','flying','intake-tip','intake-tail']){
   const prior=(await latest()).preview.evidence.generation;await command(stage);
   const row=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>prior&&pausedDeliveryReady(e,stage)?r:null},10000,'paused-stage-not-ready:'+stage);await capture(stage,row.preview.evidence);
  }
  report.partialIntakeGeometry=analysePartialPair(report.captures.find(c=>c.stage==='intake-tip').evidence,report.captures.find(c=>c.stage==='intake-tail').evidence);check(report.partialIntakeGeometry.result==='PASS',report.partialIntakeGeometry.reason);
  await command('stop');const cleared=await hiddenNow();await stableHidden(cleared);await capture('hidden',cleared.preview.evidence);
  const checks=[];
  for(const action of ['target-move','target-hide']){
   await atFlight();await command(action);const lost=await hiddenNow();await stableHidden(lost);await command('resume');await sleep(400);const e=(await latest()).preview.evidence;check(e.phase==='hidden'&&!e.playing,'invalid-target-revived');checks.push({action,result:'PASS',generation:e.generation});
  }
  await atFlight();await command('stop');await stableHidden(await hiddenNow());checks.push({action:'stop-in-flight',result:'PASS'});
  await atFlight();await command('hide');const concealed=await hiddenNow();await stableHidden(concealed,true);await command('show');await command('resume');await sleep(400);check((await latest()).preview.evidence.phase==='hidden','window-show-revived-old-flight');checks.push({action:'window-hide-show',result:'PASS'});
  await fresh('target-right');const prePause=(await latest()).preview.evidence.generation;await command('flying');
  const paused=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>prePause&&pausedDeliveryReady(e,'flying')?r:null},5000,'pause-not-observed');
  await sleep(500);const fixed=(await latest()).preview.evidence;check(fixed.paperlab.actualDrawCount===paused.preview.evidence.paperlab.actualDrawCount&&!fixed.playing,'paused-draws-continued');
  await command('resume');const resumed=await hiddenNow();check(resumed.preview.evidence.paperlab.actualDrawCount>fixed.paperlab.actualDrawCount,'resume-did-not-draw');await stableHidden(resumed);checks.push({action:'paused-flight-resume',result:'PASS'});
  await atFlight();const old=(await latest()).preview.evidence;const replacement=await fresh('fixture-a');check(replacement.preview.evidence.paperlab.metadataHash!==old.paperlab.metadataHash,'fixture-a-retained-old-metadata');
  const second=await fresh('fixture-b'),se=second.preview.evidence;check(se.paperlab.metadataHash!==replacement.preview.evidence.paperlab.metadataHash&&se.writing===0,'replacement-first-observed-frame-not-new-blank');
  await command('stop');await stableHidden(await hiddenNow());checks.push({action:'metadata-replacement',result:'PASS',singleFrameFlash:'NOT_TESTED_SAMPLED_EVIDENCE'});
  report.lifecycle={result:'PASS',checks};check(!aborted,'total-watchdog-expired');report.result='PASS';persist();
 }catch(error){fail(error.message);process.exitCode=1;}
 finally{
  clearTimeout(watchdog);
  if(app?.exitCode===null&&!app.killed){try{await command('quit',true)}catch{fail('own-profile-shutdown-failed')}await sleep(500);if(app.exitCode===null)app.kill();}
  for(const child of children)if(child.exitCode===null)child.kill();
  report.finishedAt=new Date().toISOString();if(aborted)report.result='FAIL';persist();process.stdout.write(JSON.stringify({result:report.result,report:reportPath,failure:report.failure||null})+'\n');
 }
 return report;
}
if(require.main===module)main().catch(e=>{process.stderr.write('Delivery QA: '+e.message+'\n');process.exitCode=1});
module.exports={main};
