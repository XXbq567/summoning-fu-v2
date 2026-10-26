'use strict';
// Uses only this product's isolated QA profile and fixed command allowlist.
// Natural playback has no capture/readback requests; paused PNGs are a separate result.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {buildPlan,analyseNatural,pausedStageReady,validMaterial,analyseFireEvidence}=require('./qa-paperlab-contract.cjs');
function deadline(promise,ms,label,{setTimer=setTimeout,clearTimer=clearTimeout,onTimeout=()=>{}}={}) {
 let timer;const timeout=new Promise((_,reject)=>{timer=setTimer(()=>{onTimeout();reject(new Error(label));},ms);});
 return Promise.race([promise,timeout]).finally(()=>clearTimer(timer));
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,reason)=>{if(!ok)throw new Error(reason);};
function naturalBaselineReady(row){const e=row?.preview?.evidence,p=e?.paperlab;return !!(row?.preview?.visible&&e?.playing&&validMaterial(p)&&p.materialReady&&p.actualDrawCount>0);}
async function readRows(file){try{const text=await fs.readFile(file,'utf8');check(Buffer.byteLength(text)<8*1024*1024,'diagnostic-buffer-limit');return text.split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});}catch(error){if(error.code==='ENOENT')return[];throw error;}}
async function main(args=process.argv.slice(2)) {
 const root=path.resolve(__dirname,'..'),timing=require('../renderer/entrance-timeline.js').timings;
 const value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1]};
 const output=path.join(root,'qa/paperlab',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 const plan=buildPlan({root,output,development:args.includes('--development'),timing,token:crypto.randomBytes(8).toString('hex')});
 if(args.includes('--dry-run')){process.stdout.write(JSON.stringify(plan)+'\n');return plan;}
 check(process.platform==='win32'&&value('--executable'),'Usage: node scripts/qa-paperlab-preview.cjs --executable <absolute candidate exe> [--development]');
 const executable=path.resolve(value('--executable')),relative=path.relative(root,executable);
 check(path.isAbsolute(value('--executable'))&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!/[\\/]0\.4\.1(?:[\\/]|$)|0\.4\.1/i.test(relative),'candidate-executable-must-be-current-workspace-not-0.4.1');
 await fs.access(executable);await fs.mkdir(plan.captures,{recursive:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const report={classification:'ISOLATED_PAPERLAB_LOCAL_PREVIEW_NOT_REAL_SEND_ACCEPTANCE',output,profile:plan.profile,startedAt:new Date().toISOString(),
  naturalPlayback:{result:'NOT_TESTED'},fireTelemetry:{result:'NOT_TESTED'},pausedScreenshots:{result:'NOT_TESTED'},lifecycle:{result:'NOT_TESTED'},metadataReplacement:{result:'NOT_TESTED'},
  visualReview:'NOT_TESTED_AUTOMATIC_COUNTERS_DO_NOT_PROVE_VISUAL_QUALITY',mixedDpi:'NOT_TESTED',otherOperatingSystems:'NOT_TESTED',actualUiSend:'NOT_TESTED'};
 let app,aborted=false;const commandChildren=new Set();
 const command=async(name,force=false)=>{
  check(force||!aborted,'total-watchdog-expired');check(plan.commands[name],'unknown-qa-command');
  const child=spawn(executable,plan.commands[name],{cwd:root,env,shell:false,windowsHide:plan.commandWindowsHide,stdio:'ignore'});commandChildren.add(child);
  try{return await deadline(new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error('qa-command-launch-failed')));child.once('exit',code=>code===0?resolve():reject(new Error('qa-command-exit-failed')))}),10000,'qa-command-timeout',{onTimeout:()=>{if(child.exitCode===null)child.kill();}})}finally{commandChildren.delete(child)}
 };
 const latest=async()=>(await readRows(plan.diagnostics)).at(-1);
 const until=async(read,ms,reason)=>{const end=performance.now()+ms;while(performance.now()<end){check(!aborted,'total-watchdog-expired');const result=await read();if(result)return result;await sleep(80);}throw new Error(reason)};
 const stableHidden=async(first,windowHidden=false)=>{
  const rows=await until(async()=>{const found=(await readRows(plan.diagnostics)).filter(row=>Date.parse(row.at)>=Date.parse(first.at)+800&&row.preview?.evidence&&(!windowHidden||!row.preview.visible));return found.length>=2?found:null;},5000,'hidden-stability-not-observed');
  const initial=first.preview.evidence;
  for(const row of rows){const e=row.preview.evidence;check(e.paperlab.actualDrawCount===initial.paperlab.actualDrawCount&&e.paperlab.textureRasterizations===initial.paperlab.textureRasterizations&&e.rafCount===initial.rafCount,'hidden-rendering-continued');}
  return rows.at(-1);
 };
 const capture=async(stage,before)=>{
  const old=new Set(await fs.readdir(plan.captures));
  const filename=await deadline((async()=>{await command('capture');return until(async()=>{const file=(await fs.readdir(plan.captures)).find(name=>name.endsWith('-preview.png')&&!old.has(name));return file||null;},plan.captureDeadlineMs,'capture-file-timeout')})(),plan.captureDeadlineMs,'capture-timeout');
  const after=await latest(),e=after.preview.evidence;
  check(e.generation===before.generation&&e.paperlab.metadataHash===before.paperlab.metadataHash&&pausedStageReady(e,stage),'capture-stage-changed');
  const full=path.join(plan.captures,filename),bytes=await fs.readFile(full);check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'capture-not-png');
  return {stage,file:full,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),evidence:e,result:'PASS'};
 };
 try{
  app=spawn(executable,plan.commands.start,{cwd:root,env,shell:false,windowsHide:plan.initialWindowsHide,stdio:'ignore'});
  let launchError=false;app.once('error',()=>{launchError=true});
  const flow=(async()=>{
   const baseline=await until(async()=>{check(!launchError&&app.exitCode===null,'preview-launch-failed');const row=await latest(),p=row?.preview?.evidence?.paperlab;if(p?.error)throw new Error('paperlab-'+p.error);return naturalBaselineReady(row)?row:null;},25000,'paperlab-material-ready-timeout');
   const generation=baseline.preview.evidence.generation;
   await until(async()=>{const row=await latest(),e=row?.preview?.evidence;check(!e||e.generation===generation,'natural-generation-changed');return e?.phase==='hidden'&&!e.playing&&!e.paperlab.canvasVisible?row:null;},timing.totalMs+5000,'natural-playback-did-not-finish');
   await until(async()=>{const rows=(await readRows(plan.diagnostics)).filter(row=>Date.parse(row.at)>=Date.parse(baseline.at));const hidden=rows.filter(row=>row.preview?.evidence?.phase==='hidden');return hidden.length>=2&&Date.parse(hidden.at(-1).at)-Date.parse(hidden[0].at)>=600?rows:null;},4000,'natural-hidden-stability-timeout');
   const natural=(await readRows(plan.diagnostics)).filter(row=>Date.parse(row.at)>=Date.parse(baseline.at));
   report.naturalPlayback=analyseNatural(natural,timing);check(report.naturalPlayback.result==='PASS',report.naturalPlayback.reason);
   report.fireTelemetry=analyseFireEvidence(natural);check(report.fireTelemetry.result!=='FAIL',report.fireTelemetry.reason);
   report.naturalPlayback.startedAt=baseline.at;report.naturalPlayback.finishedAt=natural.at(-1).at;
   const screenshots=[];
   for(const stage of ['unfold','writing','hold','burning']){
    const prior=(await latest()).preview.evidence.generation;await command(stage);
    const row=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e?.generation>prior&&pausedStageReady(e,stage)?row:null;},7000,'paused-'+stage+'-not-ready');
    screenshots.push(await capture(stage,row.preview.evidence));
   }
   report.pausedScreenshots={result:'PASS',classification:'PAUSED_KEYFRAMES_SEPARATE_FROM_NATURAL_PLAYBACK',captures:screenshots};
   const beforeReplay=(await latest()).preview.evidence.generation;
   await command('replay');await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e?.playing&&e.generation>beforeReplay?row:null},5000,'replay-not-started');
   await command('stop');const stopped=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e?.phase==='hidden'&&!e.playing&&!e.paperlab.canvasVisible?row:null},5000,'cancel-did-not-clear');await stableHidden(stopped);
   const beforeSecondReplay=(await latest()).preview.evidence.generation;
   await command('replay');await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e?.playing&&e.generation>beforeSecondReplay?row:null},5000,'second-replay-not-started');
   await command('hide');const hidden=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return row?.preview?.open&&!row.preview.visible&&e?.documentHidden&&!e.playing?row:null},5000,'window-hide-not-paused');await stableHidden(hidden,true);
   await command('show');const shown=await until(async()=>{const row=await latest();return row?.preview?.visible&&!row.preview.evidence.documentHidden?row:null},5000,'window-show-failed');check(!shown.preview.evidence.playing,'show-silently-resumed');
   report.lifecycle={result:'PASS',cancelClearedCanvas:true,hiddenStoppedDraws:true,showDidNotResume:true,seekVerifiedByPausedStages:true};
   const beforeFixture=(await latest()).preview.evidence.generation;
   await command('fixture-a');const a=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e?.playing&&e.generation>beforeFixture&&e.paperlab?.materialReady?row:null},7000,'fixture-a-not-ready');
   await command('hold');const aHold=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e&&pausedStageReady(e,'hold')&&e.paperlab.metadataHash===a.preview.evidence.paperlab.metadataHash?row:null},7000,'fixture-a-hold-not-ready');
   const fullA=aHold.preview.evidence.paperlab;await command('fixture-b');
   const b=await until(async()=>{const row=await latest(),e=row?.preview?.evidence,p=e?.paperlab;return e?.playing&&p?.materialReady&&p.metadataHash!==fullA.metadataHash?row:null},7000,'fixture-b-not-ready');
   check(b.preview.evidence.paperlab.writing===0&&b.preview.evidence.paperlab.textureHash!==fullA.textureHash,'replacement-showed-previous-complete-texture');
   await command('hold');const bHold=await until(async()=>{const row=await latest(),e=row?.preview?.evidence;return e&&pausedStageReady(e,'hold')&&e.paperlab.metadataHash===b.preview.evidence.paperlab.metadataHash?row:null},7000,'fixture-b-hold-not-ready');
   report.metadataReplacement={result:'PASS',classification:'FIXED_LOCAL_QA_FIXTURES_NOT_REAL_TASKS',firstMetadataHash:fullA.metadataHash,secondMetadataHash:bHold.preview.evidence.paperlab.metadataHash,newMetadataReadyWithWritingZeroAtFirstObservedFrame:true,textureHashMeaning:'FULL_SOURCE_SVG_NOT_CURRENT_GPU_PIXELS',capture:await capture('hold',bHold.preview.evidence),singleFrameFlash:'NOT_TESTED_TELEMETRY_IS_SAMPLED'};
   report.result='PASS';
  })();
  await deadline(flow,plan.totalDeadlineMs,'total-watchdog-expired',{onTimeout:()=>{aborted=true}});
 }catch(error){report.result='FAIL';report.failure=error.message;process.exitCode=1;}
 finally{
  if(app){try{await command('quit',true)}catch{report.shutdown='FAILED';report.result='FAIL';process.exitCode=1}if(app.exitCode===null&&!app.killed){await sleep(500);if(app.exitCode===null)app.kill();}}
  for(const child of commandChildren)if(child.exitCode===null)child.kill();
  report.finishedAt=new Date().toISOString();report.command={executable,argv:plan.commands.start};
  const target=path.join(output,'report.json');await fs.writeFile(target,JSON.stringify(report,null,2),{mode:0o600});
  process.stdout.write(JSON.stringify({result:report.result,report:target,failure:report.failure||null})+'\n');
 }
 return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write('Paperlab QA preflight failed: '+error.message+'\n');process.exitCode=1});
module.exports={main,deadline,naturalBaselineReady};
