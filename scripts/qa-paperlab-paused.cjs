'use strict';
// Fixed local preview commands only. A PNG never substitutes for natural playback.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {buildPlan,pausedStageReady}=require('./qa-paperlab-contract.cjs');
const {deadline,naturalBaselineReady}=require('./qa-paperlab-preview.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(args=process.argv.slice(2)){
 const root=path.resolve(__dirname,'..'),option=name=>args[args.indexOf(name)+1];
 const output=path.join(root,'qa/paperlab','paused-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 const plan={...buildPlan({root,output,development:args.includes('--development'),timing:require('../renderer/entrance-timeline.js').timings,token:crypto.randomBytes(8).toString('hex')}),
  classification:'PAUSED_ONLY_NOT_NATURAL_PLAYBACK_OR_REAL_SEND',naturalPlayback:'NOT_TESTED',stages:['hold','burning'],totalDeadlineMs:60000};
 if(args.includes('--dry-run')){process.stdout.write(JSON.stringify(plan)+'\n');return plan;}
 if(process.platform!=='win32'||!args.includes('--executable'))throw Error('absolute-workspace-executable-required');
 const executable=option('--executable'),relative=path.relative(root,executable);
 if(!path.isAbsolute(executable)||relative.startsWith('..')||path.isAbsolute(relative)||relative.includes('0.4.1'))throw Error('workspace-candidate-required');
 await fs.access(executable);await fs.mkdir(plan.captures,{recursive:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const children=new Set();let app,aborted=false;
 const report={classification:plan.classification,naturalPlayback:{result:'NOT_TESTED'},actualUiSend:'NOT_TESTED',visualReview:'NOT_TESTED',profile:plan.profile,captures:[],startedAt:new Date().toISOString()};
 const command=async(name,force=false)=>{
  if(aborted&&!force)throw Error('total-watchdog-expired');
  const child=spawn(executable,plan.commands[name],{cwd:root,env,shell:false,windowsHide:true,stdio:'ignore'});children.add(child);
  try{await deadline(new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('command-launch-failed')));child.once('exit',code=>code===0?resolve():reject(Error('command-exit-failed')))}),10000,'command-timeout',{onTimeout:()=>child.kill()});}finally{children.delete(child);}
 };
 const rows=async()=>{try{const bytes=await fs.readFile(plan.diagnostics);if(bytes.length>8*1024*1024)throw Error('diagnostics-buffer-limit');return bytes.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})}catch(e){if(e.code==='ENOENT')return[];throw e;}};
 const latest=async()=>(await rows()).at(-1);
 const until=async(read,ms,reason)=>{const end=Date.now()+ms;while(Date.now()<end){if(aborted)throw Error('total-watchdog-expired');const r=await read();if(r)return r;await sleep(80);}throw Error(reason)};
 try{
  app=spawn(executable,plan.commands.start,{cwd:root,env,shell:false,windowsHide:false,stdio:'ignore'});let failed=false;app.once('error',()=>{failed=true});
  await deadline((async()=>{
   await until(async()=>{if(failed||app.exitCode!==null)throw Error('preview-launch-failed');const r=await latest();return naturalBaselineReady(r)?r:null},25000,'material-ready-timeout');
   for(const stage of plan.stages){
    const before=(await latest()).preview.evidence.generation;await command(stage);
    let stageEvidence=null;
    try{stageEvidence=await until(async()=>{const r=await latest(),e=r?.preview?.evidence;return e?.generation>before&&pausedStageReady(e,stage)?e:null},6000,'stage-evidence-unavailable');}catch(error){if(error.message!=='stage-evidence-unavailable')throw error;}
    // Even rejected telemetry must not prevent a diagnostic picture. It is
    // marked unverified and can only be assessed by actually viewing the PNG.
    const old=new Set(await fs.readdir(plan.captures));
    const filename=await deadline((async()=>{await command('capture');return until(async()=>{const names=await fs.readdir(plan.captures);return names.find(n=>n.endsWith('-preview.png')&&!old.has(n))},3000,'capture-file-timeout')})(),3000,'capture-timeout');
    const file=path.join(plan.captures,filename),bytes=await fs.readFile(file);
    if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('capture-not-png');
    report.captures.push({stage,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),stageEvidence:stageEvidence?'PASS':'NOT_TESTED_REJECTED_OR_UNAVAILABLE',evidence:stageEvidence});
   }
   report.result=report.captures.every(c=>c.stageEvidence==='PASS')?'PASS':'INCOMPLETE';
  })(),plan.totalDeadlineMs,'total-watchdog-expired',{onTimeout:()=>{aborted=true}});
 }catch(error){report.result='FAIL';report.failure=error.message;}
 finally{
  if(app){try{await command('quit',true)}catch{report.shutdown='FAILED';report.result='FAIL'}if(app.exitCode===null){await sleep(500);if(app.exitCode===null)app.kill();}}
  for(const child of children)if(child.exitCode===null)child.kill();
  report.finishedAt=new Date().toISOString();report.command={executable,argv:plan.commands.start};
  const file=path.join(output,'report.json');await fs.writeFile(file,JSON.stringify(report,null,2),{mode:0o600});
  process.stdout.write(JSON.stringify({result:report.result,report:file,captures:report.captures.map(c=>c.file)})+'\n');if(report.result!=='PASS')process.exitCode=1;
 }
 return report;
}
if(require.main===module)main().catch(error=>{process.stderr.write('Paused Paperlab QA: '+error.message+'\n');process.exitCode=1});
module.exports={main};
