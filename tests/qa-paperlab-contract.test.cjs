'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseNatural, pausedStageReady, buildPlan, analyseFireEvidence } = require('../scripts/qa-paperlab-contract.cjs');
const timing = { paperEndMs: 1200, holdStartMs: 3400, leaveAtMs: 8400, burnEndMs: 11000, totalMs: 11300, holdMs: 5000 };
function samples() {
  return [[0,'point',1,0,1],[500,'unfold',10,0,1],[2000,'writing',40,0,1],[3500,'hold',50,0,1],
    [4500,'hold',50,0,1],[5500,'hold',50,0,1],[6500,'hold',50,0,1],[7500,'hold',50,0,1],
    [8600,'burning',90,4,.9],[9600,'burning',120,10,.5],[10600,'burning',160,20,.1],
    [11300,'hidden',160,20,0],[12300,'hidden',160,20,0]].map(([t,phase,draw,damage,presence]) => {
      const writing = t < 1200 ? 0 : t < 3400 ? .5 : 1;
      const paperlab = { engine:'paperlab',libraryVersion:'0.8.1',materialReady:true,canvasVisible:['point','unfold','burning'].includes(phase),actualDrawCount:draw,
        phase,writing,burn:phase==='burning'?(t-8400)/2600:phase==='hidden'?1:0,presenceRemaining:presence,damageVersion:damage,
        metadataHash:'a'.repeat(16),textureHash:(writing===0?'b':'c').repeat(16),textureRasterizations:writing===0?1:8,error:null };
      return { at:new Date(1700000000000+t).toISOString(),captureStatus:{},preview:{visible:true,evidence:{generation:1,elapsedMs:t,phase,playing:phase!=='hidden',documentHidden:false,svgVisible:['writing','hold'].includes(phase),paperOpacity:phase==='hidden'?0:1,opacity:['writing','hold'].includes(phase)?1:0,visibleGlyphs:writing===0?0:writing===1?20:10,totalGlyphs:20,holdStartMs:3400,leaveAtMs:8400,hideAtMs:11300,rafCount:draw,renderCount:draw,paperlab}} };
    });
}
test('Paperlab natural QA requires actual ready draws, five-second static hold, burn progress and stopped hidden canvas', () => {
  const result = analyseNatural(samples(), timing);
  assert.equal(result.result,'PASS');assert.equal(result.holdDurationMs,5000);assert.equal(result.actualDraws,160);
});
test('Paperlab QA permits absent pre-burn damage metrics but requires real numeric burn progression', () => {
  const rows=samples();for(const row of rows)if(row.preview.evidence.phase!=='burning')row.preview.evidence.paperlab.presenceRemaining=null;
  assert.equal(analyseNatural(rows,timing).result,'PASS');
  rows.find(row=>row.preview.evidence.phase==='burning').preview.evidence.paperlab.presenceRemaining=null;
  assert.equal(analyseNatural(rows,timing).reason,'burn-not-advancing');
});
test('Paperlab natural QA rejects legacy placeholders, readback, replay and fabricated static burn evidence', () => {
  for (const [change,reason] of [
    [rows=>{rows[0].preview.evidence.paperlab.materialReady=false},'material-not-ready'],
    [rows=>{for(const row of rows)row.preview.evidence.paperlab.actualDrawCount=0},'no-actual-draws'],
    [rows=>{rows[6].preview.evidence.paperlab.actualDrawCount++},'hold-kept-drawing'],
    [rows=>{for(const row of rows)row.preview.evidence.paperlab.presenceRemaining=1},'burn-not-advancing'],
    [rows=>{rows.at(-1).preview.evidence.paperlab.actualDrawCount++},'hidden-kept-drawing'],
    [rows=>{rows[5].preview.evidence.generation++},'generation-changed'],
    [rows=>{rows[2].captureStatus.preview='capture.png'},'natural-readback']
  ]) { const rows=samples();change(rows);assert.equal(analyseNatural(rows,timing).reason,reason); }
});
test('Paperlab paused stage proof cannot pass with DOM-only or still-playing evidence', () => {
  const e=samples()[5].preview.evidence;e.playing=false;
  assert.equal(pausedStageReady(e,'hold'),true);
  assert.equal(pausedStageReady({...e,paperlab:undefined},'hold'),false);
  assert.equal(pausedStageReady({...e,playing:true},'hold'),false);
  assert.equal(pausedStageReady({...e,visibleGlyphs:e.totalGlyphs-1},'hold'),false);
  assert.equal(pausedStageReady({...e,opacity:0},'hold'),false);
  assert.equal(pausedStageReady({...e,svgVisible:false},'hold'),false);
});
test('Paperlab GUI QA plans every command in one isolated profile with bounded capture and total deadlines', () => {
  const p=buildPlan({root:'C:/work/project',output:'C:/work/project/qa/paperlab/test',development:true,timing,token:'a1b2c3d4'});
  assert.equal(p.captureDeadlineMs,3000);assert.equal(p.totalDeadlineMs,120000);
  assert.equal(p.initialWindowsHide,false);assert.equal(p.commandWindowsHide,true);
  for(const argv of Object.values(p.commands)){assert.ok(argv.includes('--preview-qa-only'));assert.ok(argv.includes('--user-data-dir='+p.profile));}
  assert.ok(p.commands.quit.includes('--quit'));assert.ok(p.commands.start.includes('--motion-preview'));
});
test('fire QA distinguishes missing telemetry from a cold false-positive or fire remaining after hide',()=>{
 assert.equal(typeof analyseFireEvidence,'function');
 const rows=samples();assert.equal(analyseFireEvidence(rows).result,'NOT_TESTED');
 for(const row of rows){const p=row.preview.evidence.paperlab;Object.assign(p,{colorPipeline:'srgb-no-tone-mapping',flameCount:p.phase==='burning'?8:0,maxFlameHeightDIP:p.phase==='burning'?40:0});}
 assert.equal(analyseFireEvidence(rows).result,'PASS');
 for(const row of rows)row.preview.evidence.paperlab.flameCount=0;
 assert.equal(analyseFireEvidence(rows).reason,'no-fire-observed');
 rows.at(-1).preview.evidence.paperlab.flameCount=1;
 assert.equal(analyseFireEvidence(rows).reason,'fire-outside-burn');
});
module.exports={samples,timing};
