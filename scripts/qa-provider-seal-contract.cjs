'use strict';
const path=require('node:path');
const {materialReady,analyseRolledDeparture,activePhases,analysePartialPair:analyseExternalPartialPair,pausedDeliveryReady}=require('./qa-delivery-contract.cjs');
const phases=['point','travel','unfold','writing','hold',...activePhases,'seal-ack','seal-exit','hidden'];
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const rect=r=>finitePoint(r)&&Number.isFinite(r.width)&&r.width>0&&Number.isFinite(r.height)&&r.height>0;
const angle=s=>{const m=typeof s==='string'&&/^rotate\((-?[\d.e+]+) 50 50\)$/.exec(s);return m?Number(m[1]):NaN};
function analyseProviderSeal(rows,{provider='brand',speed=1,native=false}={}){
 const fail=reason=>({result:'FAIL',reason});
 const samples=rows.filter(r=>r?.preview?.evidence).map(r=>({r,e:r.preview.evidence,p:r.preview.evidence.paperlab}));
 if(!samples.length)return fail('no-evidence');
 if(samples.some(s=>!materialReady(s.e)))return fail('material-not-ready');
 if(samples.some(s=>s.r.captureStatus?.preview&&s.r.captureStatus.preview!=='skipped-hidden'))return fail('natural-readback');
 if(samples.some(s=>s.e.generation!==samples[0].e.generation||s.p.metadataHash!==samples[0].p.metadataHash||s.p.textureHash!==samples[0].p.textureHash))return fail('run-content-changed');
 if(samples.some((s,i)=>!phases.includes(s.e.phase)||!Number.isFinite(s.e.elapsedMs)||(i&&s.e.elapsedMs<samples[i-1].e.elapsedMs)))return fail('clock-or-phase-invalid');
 for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(a.e.phase!=='hidden'&&b.e.phase!=='hidden'&&a.e.elapsedMs===b.e.elapsedMs&&(a.e.phase!==b.e.phase||JSON.stringify(a.p)!==JSON.stringify(b.p)))return fail('conflicting-same-time-seal');}
 if(samples.some(s=>s.e.holdStartMs!==4150||s.e.leaveAtMs!==6150))return fail('two-second-hold-contract');
 if(samples.some(s=>s.e.burn!==0||s.p.flameCount!==0))return fail('unexpected-fire');
 for(const phase of ['unfold','writing','hold','rolling','rotating','flying','intake','seal-ack','seal-exit','hidden'])if(!samples.some(s=>s.e.phase===phase))return fail('phase-not-observed:'+phase);
 const paper=samples.filter(s=>s.e.elapsedMs<1950);if(!paper.length||paper.some(s=>s.e.writing!==0||s.e.visibleGlyphs!==0))return fail('ink-before-paper');
 const hold=samples.filter(s=>s.e.phase==='hold'),holdSpan=native?Date.parse(hold.at(-1)?.r.at)-Date.parse(hold[0]?.r.at):hold.at(-1)?.e.elapsedMs-hold[0]?.e.elapsedMs;
 if(hold.length<3||holdSpan<1500||hold.some(s=>s.e.writing!==1||s.e.visibleGlyphs!==s.e.totalGlyphs||s.e.totalGlyphs<1||!s.e.svgVisible||s.p.canvasVisible))return fail('hold-incomplete');
 const beforeMark=hold.filter(s=>s.e.elapsedMs<5950);
 if(beforeMark.some(s=>s.p.actualDrawCount!==beforeMark[0].p.actualDrawCount||s.p.actualClearCount!==beforeMark[0].p.actualClearCount))return fail('paper-hold-kept-drawing');
 const visible=samples.filter(s=>s.p.markVisible),appearing=hold.filter(s=>s.e.elapsedMs>=5950);
 if(!appearing.length||appearing.some(s=>!s.p.markVisible)||samples.some(s=>s.e.elapsedMs<5950&&s.p.markVisible))return fail('mark-reveal-timing');
 const first=visible[0]?.p;if(!first)return fail('mark-never-visible');
 if(visible.some(s=>s.p.source!=='local-generated-seal'||s.p.markClassification!=='OWN_SVG_DOM_GEOMETRY'||s.p.markPointerEvents!=='none'||!s.p.markAttached))return fail('mark-origin-or-dom-evidence-invalid');
 if(visible.some(s=>!Number.isFinite(angle(s.p.markLogoTransform))||Math.abs(angle(s.p.markLogoTransform))>.000001))return fail('actual-logo-rotated');
 if(visible.some(s=>!Number.isFinite(angle(s.p.markRingTransform)))||Math.max(...visible.map(s=>angle(s.p.markRingTransform)))-Math.min(...visible.map(s=>angle(s.p.markRingTransform)))<1)return fail('actual-ring-not-rotating');
 if(visible.some(s=>s.p.providerAssetId!==first.providerAssetId||s.p.providerId!==first.providerId||s.p.providerKind!==first.providerKind||s.p.providerSource!==first.providerSource))return fail('provider-identity-changed');
 if(provider==='brand'&&(first.providerId!=='openai'||first.providerKind!=='brand'||first.providerAssetId!=='openai-blossom'||!['demo-preview','reported-model+reviewed-catalog'].includes(first.providerSource)))return fail('unverified-brand');
 if(provider==='generic'&&(first.providerId!==null||first.providerKind!=='generic'||first.providerAssetId!=='generic'||first.providerSource!=='unknown'))return fail('unknown-used-brand');
 const active=samples.filter(s=>activePhases.includes(s.e.phase)),target=active[0]?.p.deliveryTargetId;
 if(typeof target!=='string'||!target.startsWith('local-seal:')||active.some(s=>s.p.deliveryTargetId!==target||!s.p.deliveryTargetValid||!s.p.canvasVisible||s.e.svgVisible))return fail('local-delivery-evidence-invalid');
 const inside=(b,stage)=>rect(b)&&rect(stage)&&b.x>=-2&&b.y>=-2&&b.x+b.width<=stage.width+2&&b.y+b.height<=stage.height+2;
 const compositions=[];
 for(const s of active){
  const b=s.p.deliveryClipped?s.p.visibleGeometryBounds:s.p.deliveryBounds,stage=s.e.stageRect;
  if(b===null&&s.p.deliveryClipped&&s.p.deliveryVisibleVertexCount===0)continue;
  if(!inside(b,stage))return fail('actual-paper-cropped');
  const mark=s.p.markBounds;
  if(s.p.markVisible&&rect(mark)){
   const x=Math.min(b.x,mark.x-stage.x),y=Math.min(b.y,mark.y-stage.y),right=Math.max(b.x+b.width,mark.x-stage.x+mark.width),bottom=Math.max(b.y+b.height,mark.y-stage.y+mark.height);
   const union={x,y,width:right-x,height:bottom-y};if(!inside(union,stage))return fail('actual-composition-cropped');compositions.push(union);
  }
 }
 for(const s of visible){const seal=s.e.localSeal,a=seal?.acceptancePoint,stage=s.e.stageRect,b=s.p.markBounds;
  if(seal?.source!=='local-generated-seal'||seal.coordinateSpace!=='overlay-local-dip'||!rect(seal.rect)||!finitePoint(a)||Math.abs(a.x-seal.rect.x-seal.rect.width/2)>.01||Math.abs(a.y-seal.rect.y-seal.rect.height/2)>.01)return fail('local-center-contract-invalid');
  if(!seal.provider||seal.provider.providerId!==s.p.providerId||seal.provider.kind!==s.p.providerKind||seal.provider.assetId!==s.p.providerAssetId||seal.provider.source!==s.p.providerSource)return fail('actual-mark-disagrees-with-frozen-provider');
  if(!rect(stage)||!rect(b)||Math.abs(b.x+b.width/2-stage.x-a.x)>1||Math.abs(b.y+b.height/2-stage.y-a.y)>1)return fail('actual-mark-center-misaligned');
  if(b.x<stage.x-1||b.y<stage.y-1||b.x+b.width>stage.x+stage.width+1||b.y+b.height>stage.y+stage.height+1)return fail('mark-cropped');
  if(s.e.phase==='intake'&&Math.abs(s.p.intakePlaneY-a.y)>.5)return fail('intake-not-at-mark-center');
 }
 const geometry=analyseRolledDeparture(active.map(s=>({phase:s.e.phase,elapsedMs:s.e.elapsedMs,paperlab:s.p})));if(geometry.result!=='PASS')return geometry;
 const ack=samples.filter(s=>s.e.phase==='seal-ack'),exit=samples.filter(s=>s.e.phase==='seal-exit');
 const hideAt=samples[0].e.hideAtMs;
 const firstHiddenSample=samples.find(s=>s.e.phase==='hidden');
 // Once hidden and released, a finished preview may discard its plan. Its
 // later diagnostic fallback deadline is not an active animation domain.
 // All visible frames and the actual transition-to-hidden must agree.
 if(!Number.isFinite(hideAt)||samples.some(s=>s.e.phase!=='hidden'&&s.e.hideAtMs!==hideAt)||firstHiddenSample?.e.hideAtMs!==hideAt)return fail('receipt-deadline-changed');
 const timing=[];
 for(const [phase,group,start,end]of [['seal-ack',ack,hideAt-400,hideAt-200],['seal-exit',exit,hideAt-200,hideAt]]){
  const unique=group.filter((s,i)=>!i||s.e.elapsedMs!==group[i-1].e.elapsedMs),first=unique[0],last=unique.at(-1);
  if(unique.length<2)return fail('receipt-unique-evidence-insufficient');
  if(group.some(s=>s.e.elapsedMs<start||s.e.elapsedMs>=end))return fail('receipt-phase-outside-interval');
  const before=samples[samples.indexOf(first)-1],after=samples[samples.lastIndexOf(group.at(-1))+1];
  const startEdge=first.e.elapsedMs-start,endEdge=end-last.e.elapsedMs,leadingGap=first.e.elapsedMs-before?.e.elapsedMs,trailingGap=after?.e.elapsedMs-last.e.elapsedMs;
  if(!before||!after||before.e.elapsedMs>start||after.e.elapsedMs<end||startEdge>100||endEdge>100||!Number.isFinite(leadingGap)||!Number.isFinite(trailingGap)||leadingGap>100||trailingGap>100)return fail('receipt-boundaries-not-bracketed');
  if(last.p.markRenderCount<=first.p.markRenderCount)return fail('receipt-actual-mark-not-advancing');
  timing.push({phase,classification:'ACTUAL_PHASE_SAMPLES_BRACKET_SHARED_TIMELINE_DOMAIN',contractStartMs:start,contractEndMs:end,contractDurationMs:200,observedSpanMs:last.e.elapsedMs-first.e.elapsedMs,uniqueSamples:unique.length,startEdgeMs:startEdge,endEdgeMs:endEdge,leadingTransitionGapMs:leadingGap,trailingTransitionGapMs:trailingGap,maxUnobservedBoundaryMs:100});
 }
 if([...ack,...exit].some(s=>s.p.canvasVisible||s.e.svgVisible||!s.p.markVisible)||exit.at(-1).p.markOpacity>=exit[0].p.markOpacity)return fail('paper-or-mark-retirement-invalid');
 const hidden=samples.filter(s=>s.e.phase==='hidden'),span=Date.parse(hidden.at(-1).r.at)-Date.parse(hidden[0].r.at);
 if(hidden.length<2||span<600)return fail('hidden-not-observed');
 const h=hidden[0];if(h.p.actualClearCount<=active.at(-1).p.actualClearCount)return fail('hidden-not-cleared');
 if(hidden.some(s=>s.p.canvasVisible||s.e.svgVisible||s.e.playing||s.p.markVisible||s.p.markOpacity!==0||s.p.actualDrawCount!==h.p.actualDrawCount||s.p.actualClearCount!==h.p.actualClearCount||s.p.markRenderCount!==h.p.markRenderCount||s.e.rafCount!==h.e.rafCount))return fail('hidden-kept-drawing');
 const wall=Date.parse(h.r.at)-Date.parse(samples[0].r.at),visual=h.e.elapsedMs-samples[0].e.elapsedMs;if(!native&&Math.abs(wall*speed-visual)>900)return fail('natural-clock-mismatch');
 return {result:'PASS',classification:'OWN_LOCAL_PROVIDER_SEAL_NOT_OFFICIAL_PET',providerId:first.providerId,providerAssetId:first.providerAssetId,providerSource:first.providerSource,holdContractMs:2000,observedHoldMs:holdSpan,markFirstObservedMs:visible[0].e.elapsedMs,logoActualTransform:first.markLogoTransform,ringActualFirst:first.markRingTransform,ringActualLast:visible.at(-1).p.markRingTransform,ackObservedMs:ack.at(-1).e.elapsedMs-ack[0].e.elapsedMs,exitObservedMs:exit.at(-1).e.elapsedMs-exit[0].e.elapsedMs,receiptTiming:timing,hiddenSpanMs:span,readbackDuringNatural:false,actualCompositionBoundsChecked:compositions.length,compositionToleranceDIP:2,...geometry,visualQuality:'NOT_TESTED_COUNTERS_ARE_NOT_PIXELS'};
}
function buildProviderSealPlan({root,output,development=false,token}){
 if(!/^[a-f0-9]{8,32}$/.test(token))throw TypeError('invalid-profile-token');
 const profile=path.join(output,'summoning-fu-preview-qa-'+token),captures=path.join(output,'captures'),diagnostics=path.join(output,'runtime.jsonl'),scope=a=>[...(development?[root]:[]),'--preview-qa-only','--user-data-dir='+profile,...a];
 const commands={start:scope(['--motion-preview','--diagnostics-file',diagnostics,'--capture-dir',captures]),capture:scope(['--capture']),quit:scope(['--quit'])};
 for(const c of ['point','unfold','writing','hold','rolling-start','rolling','rolled','rotating','flying','intake-tip','intake-tail','seal-brand','seal-generic','seal-receipt','seal-exit','bg-dark','bg-light','layout-compact','layout-wide','geometry-resize','replay','stop','pause','resume','hide','show','fixture-a','fixture-b','fixture-race','speed-0.5','speed-1'])commands[c]=scope(['--preview-qa='+c]);
 return {profile,captures,diagnostics,commands,captureDeadlineMs:3000,totalDeadlineMs:300000};
}
function pausedSealReady(e,action){
 if(['seal-receipt','seal-exit'].includes(action))return materialReady(e)&&!e.playing&&e.phase===(action==='seal-receipt'?'seal-ack':'seal-exit')&&e.paperlab.markVisible&&!e.paperlab.canvasVisible&&!e.svgVisible;
 return pausedDeliveryReady(e,action);
}
function analysePartialPair(first,last){
 if(typeof first?.paperlab?.textureHash!=='string'||first.paperlab.textureHash!==last?.paperlab?.textureHash||['frontTextureHash','backTextureHash'].some(k=>(first.paperlab[k]!==undefined||last?.paperlab?.[k]!==undefined)&&(typeof first.paperlab[k]!=='string'||first.paperlab[k]!==last?.paperlab?.[k])))return{result:'FAIL',reason:'paused-chapter-texture-changed'};
 if(first?.paperlab?.deliveryTargetId===last?.paperlab?.deliveryTargetId)return analyseExternalPartialPair(first,last);
 const signature=e=>{const s=e?.localSeal;if(s?.source!=='local-generated-seal'||s.coordinateSpace!=='overlay-local-dip'||!rect(s.rect)||!finitePoint(s.acceptancePoint)||!s.provider)return null;return JSON.stringify({rect:s.rect,acceptancePoint:s.acceptancePoint,provider:s.provider})};
 const a=signature(first),b=signature(last);
 if(!a||a!==b||!first?.paperlab?.deliveryTargetId?.startsWith('local-seal:')||!last?.paperlab?.deliveryTargetId?.startsWith('local-seal:'))return{result:'FAIL',reason:'independent-local-chapter-layout-changed'};
 // Chapter controls intentionally create new generations. Compare their
 // demonstrably equivalent own-layout geometry without falsifying stored IDs.
 // Natural playback separately requires one immutable target within each run.
 const left=structuredClone(first),right=structuredClone(last);right.paperlab.deliveryTargetId=left.paperlab.deliveryTargetId;
 const result=analyseExternalPartialPair(left,right);
 return{...result,comparison:'INDEPENDENT_PAUSED_CHAPTER_REPLAYS_SAME_CONTENT_AND_LOCAL_LAYOUT',firstGeneration:first.generation,lastGeneration:last.generation,firstTargetId:first.paperlab.deliveryTargetId,lastTargetId:last.paperlab.deliveryTargetId};
}
module.exports={analyseProviderSeal,buildProviderSealPlan,pausedSealReady,materialReady,analysePartialPair,activePhases};
