'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const host = require('../desktop/host-state.cjs');
const D = require('../renderer/delivery-motion.js');
const layout = { bounds: { x: 700, y: 240, width: 432, height: 788 }, geometry: { originRect: { x: 212, y: 650, width: 8, height: 8 }, targetRect: { x: 56, y: 56, width: 320, height: 676 } } };
test('normal local-seal layout freezes its own identity and composition before playback without Pet admission', () => {
  assert.equal(typeof host.prepareLocalSealLayout, 'function');
  const result = host.prepareLocalSealLayout(layout, { runId: 'reported-run', generation: 2, layoutVersion: 1, provider: { kind: 'generic', providerId: 'unknown', label: '通用印记', assetId: 'generic' }, workArea: { x: 0, y: 0, width: 1600, height: 1200 } });
  assert.ok(result); assert.equal(result.localSeal.source, 'local-generated-seal');
  assert.equal(result.localSeal.generation, 2); assert.equal(result.deliveryPlan.destination, 'local-generated-seal');
  assert.equal(D.validateTarget(result.localSeal, { nowMs: 0 }), false);
  for (const key of ['originRect', 'targetRect']) for (const axis of ['x', 'y']) assert.equal(result.bounds[axis] + result.geometry[key][axis], layout.bounds[axis] + layout.geometry[key][axis]);
  assert.equal(result.localSeal.acceptancePoint.x, result.localSeal.rect.x + result.localSeal.rect.width / 2);
  assert.equal(result.localSeal.acceptancePoint.y, result.localSeal.rect.y + result.localSeal.rect.height / 2);
  assert.equal(Object.isFrozen(result.localSeal.provider), true);
});
test('local seal layout refuses an impossible work area instead of clipping or guessing a Pet location', () => {
  assert.equal(typeof host.prepareLocalSealLayout, 'function');
  assert.equal(host.prepareLocalSealLayout(layout, { runId: 'tiny', generation: 1, layoutVersion: 0, provider: {}, workArea: { x: 0, y: 0, width: 60, height: 60 } }), null);
});

test('actual provider mark source survives telemetry and unsupported origin is rejected',()=>{
 const actual={engine:'paperlab',libraryVersion:'0.8.1',materialReady:true,canvasVisible:true,phase:'seal-ack',actualDrawCount:4,damageVersion:0,textureRasterizations:2,writing:1,burn:0,presenceRemaining:0,metadataHash:'12345678',textureHash:'23456789',error:null,source:'local-generated-seal',providerId:null,providerKind:'generic',providerAssetId:'generic',providerSource:'unknown',markPhase:'acknowledging',markVisible:true,markAttached:true,markRenderCount:25,markOpacity:1,markLogoTransform:'rotate(0 50 50)',markRingTransform:'rotate(20 50 50)',markGroupTransform:'translate(50 50) scale(1) translate(-50 -50)',markPointerEvents:'none',markClassification:'OWN_SVG_DOM_GEOMETRY',markBounds:{x:90,y:100,width:70,height:70}};
 assert.equal(host.sanitizePaperlabEvidence(actual).source,'local-generated-seal');
 for(const source of [undefined,null,'supported-host-adapter','preview-example',{}])assert.equal(host.sanitizePaperlabEvidence({...actual,source}),null);
});

test('local seal telemetry copies only geometry numbers and validates provider identity',()=>{
 const localSeal={source:'local-generated-seal',coordinateSpace:'overlay-local-dip',runId:'fixture',generation:1,layoutVersion:0,rect:{x:100,y:200,width:60,height:60,extra:{unbounded:'payload'}},acceptancePoint:{x:130,y:230,svg:'arbitrary'},provider:{providerId:null,kind:'generic',assetId:'generic',source:'unknown'}};
 const packet={localSeal,systemReducedMotion:false,effectiveReducedMotion:false,documentHidden:false,playing:false,phase:'hold',generation:1,renderCount:1,rafCount:0,visibleGlyphs:1,totalGlyphs:1,elapsedMs:5000,holdStartMs:4150,leaveAtMs:6150,hideAtMs:9000,paperOpacity:1,opacity:1,writing:1};
 const checked=host.sanitizePreviewEvidence(packet);assert.ok(checked);assert.deepEqual(checked.localSeal.rect,{x:100,y:200,width:60,height:60});assert.deepEqual(checked.localSeal.acceptancePoint,{x:130,y:230});
 for(const providerId of [{raw:'object'},[],2,undefined,'<script>','a'.repeat(65)])assert.equal(host.sanitizePreviewEvidence({...packet,localSeal:{...localSeal,provider:{...localSeal.provider,providerId}}}),null);
 for(const providerId of [null,'openai'])assert.ok(host.sanitizePreviewEvidence({...packet,localSeal:{...localSeal,provider:{...localSeal.provider,providerId}}}));
});
