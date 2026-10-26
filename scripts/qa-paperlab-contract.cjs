'use strict';
const path = require('node:path');
const hashLike = value => typeof value === 'string' && /^[a-f0-9]{8,128}$/i.test(value);
function validMaterial(p) {
  return p && p.engine === 'paperlab' && p.libraryVersion === '0.8.1' && typeof p.materialReady === 'boolean' &&
    typeof p.canvasVisible === 'boolean' && ['actualDrawCount','damageVersion','textureRasterizations'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0) &&
    ['writing','burn'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1) && (p.presenceRemaining===null||Number.isFinite(p.presenceRemaining)&&p.presenceRemaining>=0&&p.presenceRemaining<=1) && hashLike(p.metadataHash) && hashLike(p.textureHash) && p.error === null;
}
function pausedStageReady(e, stage) {
  const p=e?.paperlab;
  if(!e||e.playing!==false||e.phase!==stage||!validMaterial(p)||!p.materialReady||p.actualDrawCount<1||p.phase!==stage) return false;
  if(stage==='hidden')return !p.canvasVisible&&e.svgVisible===false;
  if(['writing','hold'].includes(stage)) {
    if(p.canvasVisible||e.svgVisible!==true||e.opacity!==1||e.paperOpacity!==1||!Number.isSafeInteger(e.totalGlyphs)||e.totalGlyphs<1)return false;
    return stage==='writing'?p.writing>0&&p.writing<1&&e.visibleGlyphs>0&&e.visibleGlyphs<e.totalGlyphs:p.writing===1&&p.burn===0&&e.visibleGlyphs===e.totalGlyphs;
  }
  if(!p.canvasVisible)return false;
  if(['point','travel','unfold'].includes(stage))return p.writing===0;
  if(stage==='burning')return p.burn>0&&p.burn<1&&p.damageVersion>0&&p.presenceRemaining<1;
  return true;
}
function analyseNatural(rows,timing) {
  const fail=reason=>({result:'FAIL',reason});
  const samples=rows.filter(row=>row?.preview?.evidence).map(row=>({row,e:row.preview.evidence,p:row.preview.evidence.paperlab}));
  if(!samples.length)return fail('no-evidence');
  if(samples.some(s=>!validMaterial(s.p)||!s.p.materialReady))return fail('material-not-ready');
  if(Math.max(...samples.map(s=>s.p.actualDrawCount))<1)return fail('no-actual-draws');
  const generation=samples[0].e.generation;
  if(samples.some(s=>s.e.generation!==generation))return fail('generation-changed');
  if(samples.some(s=>s.row.captureStatus?.preview&&s.row.captureStatus.preview!=='skipped-hidden'))return fail('natural-readback');
  if(timing.holdMs!==5000||timing.leaveAtMs-timing.holdStartMs!==5000||samples.some(s=>s.e.holdStartMs!==timing.holdStartMs||s.e.leaveAtMs!==timing.leaveAtMs||s.e.hideAtMs!==timing.totalMs))return fail('timing-invalid');
  if(samples.some((s,i)=>s.e.elapsedMs<0||i&&s.e.elapsedMs<samples[i-1].e.elapsedMs||s.e.phase!==s.p.phase))return fail('clock-or-phase-invalid');
  if(samples.some(s=>s.p.metadataHash!==samples[0].p.metadataHash))return fail('metadata-changed');
  const paper=samples.filter(s=>s.e.elapsedMs<timing.paperEndMs);
  if(!paper.length||paper.some(s=>s.p.writing!==0||s.e.visibleGlyphs!==0||!s.p.canvasVisible))return fail('writing-before-paper');
  const writings=samples.filter(s=>s.e.phase==='writing');
  if(!writings.length||writings.some(s=>s.p.canvasVisible||s.e.svgVisible!==true||s.e.opacity!==1||s.e.paperOpacity!==1||!(s.e.visibleGlyphs>=0&&s.e.visibleGlyphs<=s.e.totalGlyphs))||!writings.some(s=>s.e.visibleGlyphs>0))return fail('writing-layer-unavailable');
  const holds=samples.filter(s=>s.e.phase==='hold'&&s.e.elapsedMs>=timing.holdStartMs+100);
  if(holds.length<3||holds.at(-1).e.elapsedMs-holds[0].e.elapsedMs<timing.holdMs-1500)return fail('hold-not-observed');
  if(holds.some(s=>s.p.actualDrawCount!==holds[0].p.actualDrawCount||s.p.textureRasterizations!==holds[0].p.textureRasterizations))return fail('hold-kept-drawing');
  if(holds.some(s=>s.p.writing!==1||s.p.burn!==0||s.p.textureHash!==holds[0].p.textureHash||s.p.canvasVisible||s.e.svgVisible!==true||s.e.opacity!==1||s.e.paperOpacity!==1||s.e.visibleGlyphs!==s.e.totalGlyphs||s.e.totalGlyphs<1))return fail('hold-content-incomplete');
  const burns=samples.filter(s=>s.e.phase==='burning');
  if(burns.length<2||burns.at(-1).p.actualDrawCount<=burns[0].p.actualDrawCount||burns.at(-1).p.damageVersion<=burns[0].p.damageVersion||burns.at(-1).p.presenceRemaining>=burns[0].p.presenceRemaining||burns.some(s=>!s.p.canvasVisible||!Number.isFinite(s.p.presenceRemaining)||s.p.burn<=0||s.p.burn>=1))return fail('burn-not-advancing');
  const hidden=samples.filter(s=>s.e.phase==='hidden');
  if(hidden.length<2||Date.parse(hidden.at(-1).row.at)-Date.parse(hidden[0].row.at)<600)return fail('hidden-not-observed');
  if(hidden.some(s=>s.e.svgVisible!==false||s.e.opacity!==0||s.p.canvasVisible||s.p.actualDrawCount!==hidden[0].p.actualDrawCount||s.p.textureRasterizations!==hidden[0].p.textureRasterizations||s.e.rafCount!==hidden[0].e.rafCount))return fail('hidden-kept-drawing');
  const first=samples[0],last=hidden[0],wall=Date.parse(last.row.at)-Date.parse(first.row.at),visual=last.e.elapsedMs-first.e.elapsedMs;
  if(!Number.isFinite(wall)||Math.abs(wall-visual)>1500)return fail('natural-clock-mismatch');
  return {result:'PASS',generation,engine:'paperlab',libraryVersion:'0.8.1',holdDurationMs:5000,observedHoldMs:holds.at(-1).e.elapsedMs-holds[0].e.elapsedMs,
    holdActualDrawCount:holds[0].p.actualDrawCount,actualDraws:hidden[0].p.actualDrawCount,burnSamples:burns.length,presenceFrom:burns[0].p.presenceRemaining,presenceTo:burns.at(-1).p.presenceRemaining,
    hiddenSamples:hidden.length,elapsedWallMs:wall,elapsedVisualMs:visual,readbackDuringNatural:false};
}
function buildPlan({root,output,development=false,timing,token}) {
  if(!/^[a-f0-9]{8,32}$/.test(token))throw new TypeError('invalid QA profile token');
  const profile=path.join(output,'summoning-fu-preview-qa-'+token),captures=path.join(output,'captures'),diagnostics=path.join(output,'runtime.jsonl');
  const scope=argv=>[...(development?[root]:[]),'--preview-qa-only','--user-data-dir='+profile,...argv];
  const commands={start:scope(['--motion-preview','--diagnostics-file',diagnostics,'--capture-dir',captures]),capture:scope(['--capture']),quit:scope(['--quit']),reopen:scope(['--motion-preview'])};
  for(const command of ['point','unfold','writing','hold','burning','ash','replay','pause','resume','stop','hide','show','close','fixture-a','fixture-b'])commands[command]=scope(['--preview-qa='+command]);
  return {profile,captures,diagnostics,commands,holdMs:timing.holdMs,totalMs:timing.totalMs,captureDeadlineMs:3000,totalDeadlineMs:120000,initialWindowsHide:false,commandWindowsHide:true};
}
function analyseFireEvidence(rows) {
  const samples=rows.flatMap(row=>row?.preview?.evidence?.paperlab?[row.preview.evidence.paperlab]:[]);
  if(!samples.length||samples.every(p=>p.flameCount===undefined&&p.maxFlameHeightDIP===undefined&&p.colorPipeline===undefined))return {result:'NOT_TESTED',reason:'fire-telemetry-unavailable'};
  const fail=reason=>({result:'FAIL',reason});
  if(samples.some(p=>p.colorPipeline!=='srgb-no-tone-mapping'||!Number.isSafeInteger(p.flameCount)||p.flameCount<0||p.flameCount>16||!Number.isFinite(p.maxFlameHeightDIP)||p.maxFlameHeightDIP<0||p.maxFlameHeightDIP>50))return fail('fire-telemetry-invalid');
  if(samples.some(p=>p.phase!=='burning'&&(p.flameCount!==0||p.maxFlameHeightDIP!==0)))return fail('fire-outside-burn');
  const burning=samples.filter(p=>p.phase==='burning');
  if(!burning.some(p=>p.flameCount>0&&p.maxFlameHeightDIP>0))return fail('no-fire-observed');
  return {result:'PASS',samplesWithFlames:burning.filter(p=>p.flameCount>0).length,maximumFlames:Math.max(...burning.map(p=>p.flameCount)),maximumNominalHeightDIP:Math.max(...burning.map(p=>p.maxFlameHeightDIP)),heightMeaning:'NOMINAL_SHAPE_NOT_SCREEN_PIXEL_MEASUREMENT'};
}
module.exports={validMaterial,pausedStageReady,analyseNatural,buildPlan,analyseFireEvidence};
