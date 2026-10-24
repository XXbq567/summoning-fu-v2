'use strict';
const path=require('node:path');
const phases=['point','travel','unfold','writing','hold','folding','flying','intake','hidden'];
const in01=n=>Number.isFinite(n)&&n>=0&&n<=1;
function delivery(e){return e?.delivery||e?.paperlab;}
function materialReady(e){const p=e?.paperlab;return !!(p&&p.engine==='paperlab'&&p.libraryVersion==='0.8.1'&&p.materialReady===true&&p.error===null&&Number.isSafeInteger(p.actualDrawCount)&&p.actualDrawCount>0&&typeof p.metadataHash==='string'&&typeof p.textureHash==='string');}
function pausedDeliveryReady(e,phase){
 const partial=phase==='intake-tip'||phase==='intake-tail';if(partial)phase='intake';
 if(!materialReady(e)||e.playing!==false||e.phase!==phase)return false;
 const p=e.paperlab,d=delivery(e);
 if(phase==='hold')return e.svgVisible===true&&e.writing===1&&e.visibleGlyphs===e.totalGlyphs&&e.totalGlyphs>0&&!p.canvasVisible;
 if(!['folding','flying','intake'].includes(phase)||!p.canvasVisible||e.svgVisible!==false||d?.deliveryPhase!==phase||d.deliveryTargetValid!==true)return false;
 if(partial&&!(d.deliveryClipped===true&&Number.isFinite(d.intakeLeadingY)&&Number.isFinite(d.intakeTrailingY)&&Number.isFinite(d.intakePlaneY)&&d.intakeLeadingY>d.intakePlaneY&&d.intakeTrailingY<d.intakePlaneY))return false;
 return ['foldBottom','foldMiddle','flightProgress','intakeProgress'].every(k=>in01(d[k]));
}
function analyseDelivery(rows,{speed=1}={}){
 const fail=reason=>({result:'FAIL',reason}),samples=rows.filter(r=>r?.preview?.evidence).map(row=>({row,e:row.preview.evidence,p:row.preview.evidence.paperlab,d:delivery(row.preview.evidence)}));
 if(!samples.length)return fail('no-evidence');
 if(samples.some(s=>!materialReady(s.e)))return fail('material-not-ready');
 if(samples.some(s=>s.e.generation!==samples[0].e.generation))return fail('generation-changed');
 if(samples.some(s=>s.row.captureStatus?.preview&&s.row.captureStatus.preview!=='skipped-hidden'))return fail('natural-readback');
 if(samples.some(s=>s.e.burn!==0||s.p.flameCount!==0))return fail('unexpected-fire');
 if(samples.some(s=>s.p.metadataHash!==samples[0].p.metadataHash||s.p.textureHash!==samples[0].p.textureHash))return fail('metadata-or-texture-changed');
 if(samples.some((s,i)=>!phases.includes(s.e.phase)||!Number.isFinite(s.e.elapsedMs)||i&&s.e.elapsedMs<samples[i-1].e.elapsedMs))return fail('clock-invalid');
 if(samples.some(s=>s.e.holdStartMs!==4150||s.e.leaveAtMs!==6150))return fail('two-second-hold-contract');
 for(const phase of ['unfold','writing','hold','folding','flying','intake','hidden'])if(!samples.some(s=>s.e.phase===phase))return fail('phase-not-observed:'+phase);
 const paper=samples.filter(s=>s.e.elapsedMs<1950);
 if(!paper.length||paper.some(s=>s.e.writing!==0||s.e.visibleGlyphs!==0))return fail('ink-before-paper');
 const holds=samples.filter(s=>s.e.phase==='hold');
 const holdSpan=holds.at(-1).e.elapsedMs-holds[0].e.elapsedMs;
 if(holds.length<3||holdSpan<1500)return fail('hold-not-observed');
 if(holds.some(s=>s.p.actualDrawCount!==holds[0].p.actualDrawCount||s.p.actualClearCount!==holds[0].p.actualClearCount||s.p.textureRasterizations!==holds[0].p.textureRasterizations||s.e.rafCount!==holds[0].e.rafCount))return fail('hold-kept-drawing');
 if(holds.some(s=>s.e.writing!==1||s.e.visibleGlyphs!==s.e.totalGlyphs||s.e.totalGlyphs<1||s.e.svgVisible!==true||s.p.canvasVisible))return fail('hold-incomplete');
 const active=samples.filter(s=>['folding','flying','intake'].includes(s.e.phase)),id=active[0].d?.deliveryTargetId;
 if(typeof id!=='string'||!id||active.some(s=>s.d?.deliveryTargetId!==id))return fail('target-changed');
 if(active.some(s=>s.d.deliveryTargetValid!==true))return fail('target-invalid');
 if(active.some(s=>s.d.deliveryPhase!==s.e.phase||s.e.svgVisible!==false||!s.p.canvasVisible||!['foldBottom','foldMiddle','flightProgress','intakeProgress'].every(k=>in01(s.d[k]))))return fail('delivery-evidence-invalid');
 const folds=active.filter(s=>s.e.phase==='folding'),flights=active.filter(s=>s.e.phase==='flying'),intakes=active.filter(s=>s.e.phase==='intake');
 if(folds.length<2||!folds.some(s=>s.d.foldBottom>0&&s.d.foldMiddle===0)||folds.some(s=>s.d.foldMiddle>s.d.foldBottom+1e-6))return fail('fold-order-not-observed');
 if(flights.some(s=>s.d.flightProgress>.1&&(s.d.foldBottom<.999||s.d.foldMiddle<.999)))return fail('takeoff-before-fold-complete');
 for(const [group,key,reason]of [[flights,'flightProgress','flight-not-advancing'],[intakes,'intakeProgress','intake-not-advancing']])if(group.length<2||group.at(-1).d[key]<=group[0].d[key]||group.at(-1).p.actualDrawCount<=group[0].p.actualDrawCount||group.some((s,i)=>i&&s.d[key]<group[i-1].d[key]))return fail(reason);
 if(!intakes.some(s=>s.d.deliveryClipped===true))return fail('intake-not-clipped');
 const hidden=samples.filter(s=>s.e.phase==='hidden'),hiddenSpan=Date.parse(hidden.at(-1).row.at)-Date.parse(hidden[0].row.at);
 if(hidden.length<2||hiddenSpan<600)return fail('hidden-not-observed');
 if(!Number.isSafeInteger(hidden[0].p.actualClearCount)||hidden[0].p.actualClearCount<=active.at(-1).p.actualClearCount)return fail('hidden-not-cleared');
 if(hidden.some(s=>s.p.canvasVisible||s.e.svgVisible||s.e.playing||s.p.actualDrawCount!==hidden[0].p.actualDrawCount||s.p.actualClearCount!==hidden[0].p.actualClearCount||s.p.textureRasterizations!==hidden[0].p.textureRasterizations||s.e.rafCount!==hidden[0].e.rafCount))return fail('hidden-kept-drawing');
 const wall=Date.parse(hidden[0].row.at)-Date.parse(samples[0].row.at),visual=hidden[0].e.elapsedMs-samples[0].e.elapsedMs;
 if(Math.abs(wall*speed-visual)>900)return fail('natural-clock-mismatch');
 return {result:'PASS',generation:samples[0].e.generation,holdContractMs:2000,observedHoldMs:holdSpan,foldSamples:folds.length,flightSamples:flights.length,intakeSamples:intakes.length,hiddenSpanMs:hiddenSpan,actualDraws:hidden[0].p.actualDrawCount,targetId:id,readbackDuringNatural:false,visualQuality:'NOT_TESTED_COUNTERS_ARE_NOT_PIXELS'};
}
function buildDeliveryPlan({root,output,development=false,token}){
 if(!/^[a-f0-9]{8,32}$/.test(token))throw TypeError('invalid-profile-token');
 const profile=path.join(output,'summoning-fu-preview-qa-'+token),captures=path.join(output,'captures'),diagnostics=path.join(output,'runtime.jsonl');
 const scope=a=>[...(development?[root]:[]),'--preview-qa-only','--user-data-dir='+profile,...a];
 const commands={start:scope(['--motion-preview','--diagnostics-file',diagnostics,'--capture-dir',captures]),capture:scope(['--capture']),quit:scope(['--quit'])};
 for(const c of ['point','unfold','writing','hold','folding','flying','intake','intake-tip','intake-tail','target-near','target-far','target-left','target-right','target-move','target-hide','replay','stop','pause','resume','hide','show','fixture-a','fixture-b','speed-0.5','speed-1'])commands[c]=scope(['--preview-qa='+c]);
 return {profile,captures,diagnostics,commands,captureDeadlineMs:3000,totalDeadlineMs:240000};
}
function analysePartialPair(first,last){
 const a=delivery(first),b=delivery(last),partial=d=>d?.deliveryClipped===true&&Number.isFinite(d.intakeLeadingY)&&Number.isFinite(d.intakeTrailingY)&&Number.isFinite(d.intakePlaneY)&&d.intakeLeadingY>d.intakePlaneY&&d.intakeTrailingY<d.intakePlaneY;
 if(!partial(a)||!partial(b)||a.deliveryTargetId!==b.deliveryTargetId||first.paperlab.metadataHash!==last.paperlab.metadataHash||Math.abs(a.intakePlaneY-b.intakePlaneY)>.01||b.intakeProgress<=a.intakeProgress||b.intakeTrailingY<=a.intakeTrailingY)return {result:'FAIL',reason:'partial-intake-not-progressive'};
 return {result:'PASS',classification:'GEOMETRY_WITH_SEPARATE_ACTUAL_PNGS_NOT_PIXEL_ANALYSIS',remainingLengthFromDIP:a.intakePlaneY-a.intakeTrailingY,remainingLengthToDIP:b.intakePlaneY-b.intakeTrailingY};
}
module.exports={delivery,materialReady,pausedDeliveryReady,analyseDelivery,buildDeliveryPlan,analysePartialPair};
