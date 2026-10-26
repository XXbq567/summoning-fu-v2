'use strict';
const path=require('node:path');
const activePhases=['rolling','rotating','flying','staging','intake'];
const phases=['point','travel','unfold','writing','hold',...activePhases,'hidden'];
const in01=n=>Number.isFinite(n)&&n>=0&&n<=1;
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const rect=r=>point(r)&&Number.isFinite(r.width)&&Number.isFinite(r.height)&&r.width>0&&r.height>0;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function delivery(e){return e?.delivery||e?.paperlab;}
function materialReady(e){const p=e?.paperlab;return !!(p&&p.engine==='paperlab'&&p.libraryVersion==='0.8.1'&&p.materialReady===true&&p.error===null&&Number.isSafeInteger(p.actualDrawCount)&&p.actualDrawCount>0&&typeof p.metadataHash==='string'&&typeof p.textureHash==='string');}
function actualRoll(d){
 if(!d||d.deliveryMode!=='rolled-paper'||!['rollProgress','rollFraction','actualWoundFraction','rotationProgress','flightProgress','intakeProgress'].every(k=>in01(d[k])))return false;
 if(!Number.isFinite(d.rollRadius)||d.rollRadius<=0||!Number.isFinite(d.deliveryRotationZ))return false;
 if(!['deliveryMeshId','deliveryGeometryId','deliveryUvHash','deliveryUvInitialHash','deliveryGeometryPositionHash'].every(k=>typeof d[k]==='string'&&d[k]))return false;
 if(d.deliveryUvHash!==d.deliveryUvInitialHash||Math.abs(d.actualWoundFraction-d.rollFraction)>.04)return false;
 if(!point(d.deliveryPivotLocal)||!Number.isFinite(d.deliveryPivotLocal.z)||!point(d.deliverySourcePivot)||!point(d.deliveryPosition)||!point(d.projectedAxis?.leading)||!point(d.projectedAxis?.trailing)||distance(d.projectedAxis.leading,d.projectedAxis.trailing)<8||!rect(d.deliveryBounds))return false;
 return d.backsideInkStrength===.2&&d.materialAdapter==='paper-backface-v1'&&d.material?.forceSinglePass===true&&d.material.depthTest===true&&d.material.depthWrite===true&&d.material.opacity===1;
}
function partial(d){return d?.deliveryClipped===true&&Number.isFinite(d.intakeLeadingY)&&Number.isFinite(d.intakeTrailingY)&&Number.isFinite(d.intakePlaneY)&&d.intakeLeadingY>d.intakePlaneY&&d.intakeTrailingY<d.intakePlaneY;}
function actualClip(d,maxVertices=1000000){
 const planes=d.material?.clippingPlanes;
 if(!Array.isArray(planes)||planes.length!==1||!Array.isArray(planes[0].normal)||planes[0].normal.length!==3||planes[0].normal.some(n=>!Number.isFinite(n))||Math.abs(planes[0].normal[0])>.00001||Math.abs(planes[0].normal[1]-1)>.00001||Math.abs(planes[0].normal[2])>.00001||!Number.isFinite(planes[0].constant))return false;
 if(!Number.isSafeInteger(d.deliveryVisibleVertexCount)||d.deliveryVisibleVertexCount<0||d.deliveryVisibleVertexCount>maxVertices||d.visibleGeometryBoundsSource!=='cpu-clipped-indexed-triangles'||!Number.isSafeInteger(d.deliveryClipIntersectionCount)||d.deliveryClipIntersectionCount<0)return false;
 const b=d.deliveryBounds,v=d.visibleGeometryBounds,expected=Math.max(0,Math.min(b.y+b.height,d.intakePlaneY)-b.y);
 if(expected<.000001)return v===null&&d.deliveryVisibleVertexCount===0;
 if(!rect(v)||d.deliveryVisibleVertexCount===0||Math.abs(v.y-b.y)>.5||Math.abs(v.height-expected)>.5||v.y+v.height>d.intakePlaneY+.5||v.x<b.x-.5||v.x+v.width>b.x+b.width+.5)return false;
 if(expected<b.height-.5&&(d.deliveryVisibleVertexCount>=maxVertices||d.deliveryClipIntersectionCount===0))return false;
 return true;
}
function pausedDeliveryReady(e,action){
 if(!materialReady(e)||e.playing!==false)return false;
 const p=e.paperlab,d=delivery(e);
 if(action==='hold')return e.phase==='hold'&&e.svgVisible===true&&e.writing===1&&e.visibleGlyphs===e.totalGlyphs&&e.totalGlyphs>0&&!p.canvasVisible;
 if(!activePhases.includes(e.phase)||!p.canvasVisible||e.svgVisible!==false||d?.deliveryPhase!==e.phase||d.deliveryTargetValid!==true||!actualRoll(d))return false;
 if(action==='rolling-start')return e.phase==='rolling'&&d.rollFraction>0&&d.rollFraction<.1;
 if(action==='rolling')return e.phase==='rolling'&&d.rollFraction>.4&&d.rollFraction<.6;
 if(action==='rolled')return d.rollFraction>.999&&d.rotationProgress<.3;
 if(action==='intake-tip'||action==='intake-tail')return e.phase==='intake'&&partial(d);
 return e.phase===action;
}
function analyseRolledDeparture(samples){
 const fail=reason=>({result:'FAIL',reason}),observed=samples.filter(s=>activePhases.includes(s.phase)),active=[];let repeatedPublications=0;
 for(const sample of observed){const prior=active.at(-1);if(prior&&sample.elapsedMs===prior.elapsedMs){if(sample.phase!==prior.phase||JSON.stringify(sample.paperlab)!==JSON.stringify(prior.paperlab))return fail('conflicting-same-time-departure');repeatedPublications++;continue;}active.push(sample);}
 const first=active[0]?.paperlab;
 if(active.length<9)return fail('rolled-evidence-insufficient');
 if(active.some(s=>!actualRoll(s.paperlab)))return fail('actual-roll-evidence-missing');
 const ids=['deliveryMeshId','deliveryGeometryId','deliveryUvHash'],pivot=JSON.stringify(first.deliveryPivotLocal);
 if(active.some(s=>ids.some(k=>s.paperlab[k]!==first[k])||JSON.stringify(s.paperlab.deliveryPivotLocal)!==pivot||distance(s.paperlab.deliverySourcePivot,first.deliverySourcePivot)>.001))return fail('roll-identity-uv-or-pivot-changed');
 const rolls=active.filter(s=>s.phase==='rolling'),rotations=active.filter(s=>s.phase==='rotating'),flights=active.filter(s=>s.phase==='flying'),intakes=active.filter(s=>s.phase==='intake');
 if(rolls.length<3||Math.min(...rolls.map(s=>s.paperlab.rollFraction))>.2||Math.max(...rolls.map(s=>s.paperlab.rollFraction))<.7||new Set(rolls.map(s=>s.paperlab.deliveryGeometryPositionHash)).size<3||rolls.at(-1).paperlab.rollRadius-rolls[0].paperlab.rollRadius<.025)return fail('actual-roll-not-advancing');
 if(active.some((s,i)=>i&&(s.paperlab.rollFraction<active[i-1].paperlab.rollFraction-1e-6||s.paperlab.rollRadius<active[i-1].paperlab.rollRadius-1e-6)))return fail('roll-geometry-reversed');
 const anchored=rolls.filter(s=>s.paperlab.rollFraction<.9);
 for(const {phase,paperlab:d}of active){
  const midpoint={x:(d.projectedAxis.leading.x+d.projectedAxis.trailing.x)/2,y:(d.projectedAxis.leading.y+d.projectedAxis.trailing.y)/2};
  if(distance(midpoint,d.deliveryPosition)>.5)return fail('actual-axis-disagrees-with-pivot');
  if(d.rollFraction===1&&distance({x:d.deliveryBounds.x+d.deliveryBounds.width/2,y:d.deliveryBounds.y+d.deliveryBounds.height/2},d.deliveryPosition)>.5)return fail('actual-bounds-disagree-with-pivot');
  if(phase==='rolling'&&distance(d.deliveryPosition,d.deliverySourcePivot)>.25)return fail('rolling-source-moved');
  if(phase==='rotating'&&(Math.abs(d.deliveryPosition.x-d.deliverySourcePivot.x)>.25||d.deliveryPosition.y>d.deliverySourcePivot.y+.25||d.deliveryPosition.y<d.deliverySourcePivot.y-12.25))return fail('rotation-source-jump');
 }
 for(const {paperlab:d}of anchored){const width=distance(d.projectedAxis.leading,d.projectedAxis.trailing),expectedTop=d.deliverySourcePivot.y+(d.deliveryPivotLocal.y-710/264/2)*width;if(Math.abs(d.deliveryBounds.y-expectedTop)>.5)return fail('flat-source-not-aligned-to-measured-pivot');}
 if(anchored.some(s=>Math.abs(s.paperlab.deliveryBounds.y-anchored[0].paperlab.deliveryBounds.y)>1.5))return fail('unrolled-top-drift');
 if(rolls.some(s=>Math.abs(s.paperlab.projectedAxis.leading.y-s.paperlab.projectedAxis.trailing.y)>1.5))return fail('roll-axis-not-horizontal');
 if(rotations.length<2||rotations.at(-1).paperlab.rotationProgress<=rotations[0].paperlab.rotationProgress)return fail('rotation-not-observed');
 const settled=active.filter(s=>s.paperlab.rotationProgress>.99);
 if(!settled.length||settled.some(s=>{const a=s.paperlab.projectedAxis;return Math.abs(a.leading.x-a.trailing.x)>Math.abs(a.leading.y-a.trailing.y)*.2||Math.abs(Math.abs(s.paperlab.deliveryRotationZ)-Math.PI/2)>.2;}))return fail('actual-axis-not-vertical-after-rotation');
 if(flights.some(s=>s.paperlab.flightProgress>.1&&(s.paperlab.rollFraction<.999||s.paperlab.rotationProgress<.99)))return fail('takeoff-before-roll-and-rotation');
 for(const [group,key,reason]of[[flights,'flightProgress','flight-not-advancing'],[intakes,'intakeProgress','intake-not-advancing']])if(group.length<3||group.at(-1).paperlab[key]<=group[0].paperlab[key]||group.some((s,i)=>i&&s.paperlab[key]<group[i-1].paperlab[key])||group.at(-1).paperlab.actualDrawCount<=group[0].paperlab.actualDrawCount)return fail(reason);
 for(let i=1;i<active.length;i++){const a=active[i-1],b=active[i],dt=b.elapsedMs-a.elapsedMs;if(dt<=0)return fail('departure-clock-not-progressive');if(a.phase!=='intake'&&b.phase!=='intake'&&distance(a.paperlab.deliveryPosition,b.paperlab.deliveryPosition)>3+dt*5)return fail('source-or-motion-teleport');}
 if(intakes.some(s=>!s.paperlab.deliveryClipped||!Number.isFinite(s.paperlab.intakeLeadingY)||!Number.isFinite(s.paperlab.intakeTrailingY)||!Number.isFinite(s.paperlab.intakePlaneY)||s.paperlab.intakeLeadingY<=s.paperlab.intakeTrailingY||Math.abs(s.paperlab.intakePlaneY-intakes[0].paperlab.intakePlaneY)>.01))return fail('actual-intake-plane-or-order-invalid');
 const fullVertexCount=Math.max(...active.filter(s=>s.phase!=='intake').map(s=>s.paperlab.deliveryVisibleVertexCount));
 if(!Number.isSafeInteger(fullVertexCount)||fullVertexCount<1000||intakes.some(s=>!actualClip(s.paperlab,fullVertexCount)||JSON.stringify(s.paperlab.material.clippingPlanes)!==JSON.stringify(intakes[0].paperlab.material.clippingPlanes)))return fail('actual-clipped-geometry-or-bound-plane-invalid');
 const velocity=(a,b)=>(b.paperlab.deliveryPosition.y-a.paperlab.deliveryPosition.y)/(b.elapsedMs-a.elapsedMs),early=velocity(intakes[0],intakes[1]),late=velocity(intakes.at(-2),intakes.at(-1));
 if(!(early>0&&late>early*1.15))return fail('intake-not-accelerating');
 return {result:'PASS',mode:'rolled-paper',uniqueDepartureSamples:active.length,repeatedPublications,rollSamples:rolls.length,rotationSamples:rotations.length,flightSamples:flights.length,intakeSamples:intakes.length,meshId:first.deliveryMeshId,uvHash:first.deliveryUvHash,pivotLocal:first.deliveryPivotLocal,sourcePivot:first.deliverySourcePivot,intakeEarlyVelocityDIPperMs:early,intakeLateVelocityDIPperMs:late,actualAxisVertical:true,backsideInkStrength:.2};
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
 for(const phase of ['unfold','writing','hold','rolling','rotating','flying','intake','hidden'])if(!samples.some(s=>s.e.phase===phase))return fail('phase-not-observed:'+phase);
 const paper=samples.filter(s=>s.e.elapsedMs<1950);if(!paper.length||paper.some(s=>s.e.writing!==0||s.e.visibleGlyphs!==0))return fail('ink-before-paper');
 const holds=samples.filter(s=>s.e.phase==='hold'),holdSpan=holds.at(-1).e.elapsedMs-holds[0].e.elapsedMs;
 if(holds.length<3||holdSpan<1500)return fail('hold-not-observed');
 if(holds.some(s=>s.p.actualDrawCount!==holds[0].p.actualDrawCount||s.p.actualClearCount!==holds[0].p.actualClearCount||s.p.textureRasterizations!==holds[0].p.textureRasterizations||s.e.rafCount!==holds[0].e.rafCount))return fail('hold-kept-drawing');
 if(holds.some(s=>s.e.writing!==1||s.e.visibleGlyphs!==s.e.totalGlyphs||s.e.totalGlyphs<1||s.e.svgVisible!==true||s.p.canvasVisible))return fail('hold-incomplete');
 const active=samples.filter(s=>activePhases.includes(s.e.phase)),id=active[0].d?.deliveryTargetId;
 if(typeof id!=='string'||!id||active.some(s=>s.d?.deliveryTargetId!==id))return fail('target-changed');
 if(active.some(s=>s.d.deliveryTargetValid!==true))return fail('target-invalid');
 if(active.some(s=>s.d.deliveryPhase!==s.e.phase||s.e.svgVisible!==false||!s.p.canvasVisible))return fail('delivery-evidence-invalid');
 const geometry=analyseRolledDeparture(active.map(s=>({phase:s.e.phase,elapsedMs:s.e.elapsedMs,paperlab:s.d})));if(geometry.result!=='PASS')return geometry;
 const hidden=samples.filter(s=>s.e.phase==='hidden'),hiddenSpan=Date.parse(hidden.at(-1).row.at)-Date.parse(hidden[0].row.at);
 if(hidden.length<2||hiddenSpan<600)return fail('hidden-not-observed');
 if(!Number.isSafeInteger(hidden[0].p.actualClearCount)||hidden[0].p.actualClearCount<=active.at(-1).p.actualClearCount)return fail('hidden-not-cleared');
 if(hidden.some(s=>s.p.canvasVisible||s.e.svgVisible||s.e.playing||s.p.actualDrawCount!==hidden[0].p.actualDrawCount||s.p.actualClearCount!==hidden[0].p.actualClearCount||s.p.textureRasterizations!==hidden[0].p.textureRasterizations||s.e.rafCount!==hidden[0].e.rafCount))return fail('hidden-kept-drawing');
 const wall=Date.parse(hidden[0].row.at)-Date.parse(samples[0].row.at),visual=hidden[0].e.elapsedMs-samples[0].e.elapsedMs;if(Math.abs(wall*speed-visual)>900)return fail('natural-clock-mismatch');
 return {result:'PASS',generation:samples[0].e.generation,holdContractMs:2000,observedHoldMs:holdSpan,...geometry,hiddenSpanMs:hiddenSpan,actualDraws:hidden[0].p.actualDrawCount,targetId:id,readbackDuringNatural:false,visualQuality:'NOT_TESTED_COUNTERS_ARE_NOT_PIXELS'};
}
function buildDeliveryPlan({root,output,development=false,token}){
 if(!/^[a-f0-9]{8,32}$/.test(token))throw TypeError('invalid-profile-token');
 const profile=path.join(output,'summoning-fu-preview-qa-'+token),captures=path.join(output,'captures'),diagnostics=path.join(output,'runtime.jsonl'),scope=a=>[...(development?[root]:[]),'--preview-qa-only','--user-data-dir='+profile,...a];
 const commands={start:scope(['--motion-preview','--diagnostics-file',diagnostics,'--capture-dir',captures]),capture:scope(['--capture']),quit:scope(['--quit'])};
 for(const c of ['point','unfold','writing','hold','rolling-start','rolling','rolled','rotating','flying','intake','intake-tip','intake-tail','target-near','target-far','target-left','target-right','target-move','target-hide','target-expire','target-drag','replay','stop','pause','resume','hide','show','fixture-a','fixture-b','fixture-race','speed-0.5','speed-1'])commands[c]=scope(['--preview-qa='+c]);
 return {profile,captures,diagnostics,commands,captureDeadlineMs:3000,totalDeadlineMs:240000};
}
function analysePartialPair(first,last){
 const a=delivery(first),b=delivery(last);
 if(!partial(a)||!partial(b)||!actualRoll(a)||!actualRoll(b)||!actualClip(a)||!actualClip(b)||a.deliveryTargetId!==b.deliveryTargetId||first.paperlab.metadataHash!==last.paperlab.metadataHash||a.deliveryMeshId!==b.deliveryMeshId||a.deliveryUvHash!==b.deliveryUvHash||Math.abs(a.intakePlaneY-b.intakePlaneY)>.01||b.intakeProgress<=a.intakeProgress||b.intakeTrailingY<=a.intakeTrailingY||b.visibleGeometryBounds.height>=a.visibleGeometryBounds.height-1||b.deliveryVisibleVertexCount>=a.deliveryVisibleVertexCount)return {result:'FAIL',reason:'partial-intake-not-progressive'};
 return {result:'PASS',classification:'ACTUAL_CPU_CLIPPED_TRIANGLES_AND_BOUND_MATERIAL_PLANE_NOT_GPU_PIXELS',remainingLengthFromDIP:a.visibleGeometryBounds.height,remainingLengthToDIP:b.visibleGeometryBounds.height,remainingVerticesFrom:a.deliveryVisibleVertexCount,remainingVerticesTo:b.deliveryVisibleVertexCount,meshId:a.deliveryMeshId,uvHash:a.deliveryUvHash};
}
module.exports={delivery,materialReady,actualRoll,activePhases,pausedDeliveryReady,analyseRolledDeparture,analyseDelivery,buildDeliveryPlan,analysePartialPair};
