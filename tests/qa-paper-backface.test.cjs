'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const location = path.join(__dirname, '../scripts/qa-paper-backface.cjs');
const qa = fs.existsSync(location) ? require(location) : null;
const image = (color, width = 40, height = 40) => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = color[2]; data[i + 1] = color[1]; data[i + 2] = color[0]; data[i + 3] = 255; }
  return { width, height, data, channelOrder: 'BGRA' };
};
test('paper-backface bitmap comparisons reject absent pixels, mismatched size and empty masks', () => {
  assert.ok(qa, 'independent pixel validator must exist');
  assert.throws(() => qa.pixelStats({}, image([255, 255, 255])), /bitmap/);
  assert.throws(() => qa.pixelStats(image([255, 255, 255]), image([255, 255, 255], 41)), /size/);
  assert.equal(qa.pixelStats(image([255, 255, 255]), image([255, 255, 255]), []).result, 'FAIL');
  const stats = qa.pixelStats(image([255, 255, 255]), image([255, 255, 255]));
  assert.equal(stats.result, 'PASS'); assert.equal(stats.changedPixels, 0); assert.equal(stats.pixelCount, 1600);
});
test('backface evidence requires current material, actual facing, strict body depth and matching frozen inputs', () => {
  assert.ok(qa, 'independent material evidence validator must exist');
  const sample = qa.syntheticSampleForTest({ pose: 'back', backsideInkStrength: .1 });
  assert.equal(qa.validateSample(sample).result, 'PASS');
  for (const alter of [s => delete s.state.renderer.material.forceSinglePass, s => s.state.renderer.material.forceSinglePass = false,
    s => s.state.renderer.material.opacity = .8, s => delete s.state.renderer.backTextureHash,
    s => s.state.renderer.material.depthWrite = false, s => s.state.renderer.material.depthTest = false,
    s => s.state.renderer.inspection.pose = 'front', s => s.state.renderer.material.backsideInkStrength = 1,
    s => s.state.renderer.materialReady = false, s => s.state.renderer.error = 'render-failed',
    s => delete s.state.renderer.material.compiledFacingBranch, s => s.state.renderer.material.compiledBackSampler = false,
    s => s.state.renderer.material.compiledBackTextureId = 'unbound-texture']) {
    const changed = structuredClone(sample); alter(changed); assert.equal(qa.validateSample(changed).result, 'FAIL');
  }
});
test('ink contrast is actual pixel-derived, weak and monotonic instead of a uniform-only pass', () => {
  assert.ok(qa, 'independent ink contrast validator must exist');
  const blank = image([250, 245, 230]), full = image([150, 30, 20]);
  const good = qa.analyseInkContrast({ blank, full, zero: image([250, 245, 230]), tenth: image([245, 235, 220]), fifth: image([240, 225, 210]) });
  assert.equal(good.result, 'PASS'); assert.ok(good.tenthRatio > 0); assert.ok(good.fifthRatio > good.tenthRatio);
  for (const values of [
    { zero: full, tenth: full, fifth: full },
    { zero: blank, tenth: full, fifth: full },
    { zero: blank, tenth: image([235, 220, 200]), fifth: image([248, 242, 225]) },
  ]) assert.equal(qa.analyseInkContrast({ blank, full, ...values }).result, 'FAIL');
  assert.equal(qa.analyseInkContrast({ blank, full: blank, zero: blank, tenth: blank, fifth: blank }).result, 'FAIL');
});
test('facing proof needs back pixels in corrected pass and front substitution in actual legacy pass', () => {
  assert.ok(qa, 'independent facing validator must exist');
  assert.equal(qa.analyseFacing(image([255, 0, 0]), image([0, 255, 0])).result, 'PASS');
  assert.equal(qa.analyseFacing(image([255, 0, 0]), image([255, 0, 0])).result, 'FAIL');
  assert.equal(qa.analyseFacing(image([0, 0, 0]), image([0, 0, 0])).result, 'FAIL');
  assert.equal(qa.analyseFacing(image([255, 0, 0]), image([2, 245, 2])).result, 'FAIL', 'partially covered silhouette pixels cannot establish opaque paper');
});
test('occlusion needs unchanged opaque interior and independently visible changed hidden backdrop', () => {
  assert.ok(qa, 'independent occlusion validator must exist');
  const a = image([250, 245, 230]), b = image([250, 245, 230]);
  for (let i = 0; i < 100; i++) { a.data[i * 4] = 255; a.data[i * 4 + 1] = 255; a.data[i * 4 + 2] = 0; b.data[i * 4] = 255; b.data[i * 4 + 1] = 0; b.data[i * 4 + 2] = 255; }
  const inside = Array.from({ length: 1500 }, (_, i) => i + 100), outside = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(qa.analyseOcclusion(a, b, inside, outside).result, 'PASS');
  assert.equal(qa.analyseOcclusion(a, a, inside, outside).result, 'FAIL');
  b.data[100 * 4] = 0; assert.equal(qa.analyseOcclusion(a, b, inside, outside).result, 'FAIL');
});
test('matrix admission rejects missing permutations, reused generations and absent actual pixels', () => {
  assert.ok(qa, 'independent matrix validator must exist');
  const matrix = qa.syntheticMatrixForTest();
  assert.equal(qa.validateMatrix(matrix).result, 'PASS');
  assert.equal(qa.validateMatrix(matrix.slice(1)).result, 'FAIL');
  const reused = structuredClone(matrix); reused[1].state.generation = reused[0].state.generation;
  assert.equal(qa.validateMatrix(reused).result, 'FAIL');
  const noPixels = structuredClone(matrix); delete noPixels[1].bitmap;
  assert.equal(qa.validateMatrix(noPixels).result, 'FAIL');
});
test('runner launches only isolated local own preview with bounded token and exact approved mode', () => {
  assert.ok(qa, 'independent runner must exist');
  const plan = qa.buildPlan({ root: 'C:/project', output: 'C:/project/qa/backface/one', token: '0123abcd', development: true });
  assert.match(plan.args[0], /desktop[\\/]roll-preview-main\.cjs$/); assert.ok(plan.args.includes('--qa-roll-preview'));
  assert.equal(plan.readbackClassification, 'PAUSED_OWN_STAGE_MATERIAL_PIXELS_NOT_NATURAL_PLAYBACK');
  assert.throws(() => qa.buildPlan({ root: 'C:/project', output: 'C:/project/qa/backface/one', token: '../escape', development: true }), /token/);
  assert.throws(() => qa.buildPlan({ root: 'C:/project', output: 'C:/project/qa/backface/one', token: '0123abcd', development: false }), /development/);
});
test('own Electron child omits RUN_AS_NODE entirely instead of passing an empty presence flag', () => {
  assert.ok(qa);
  assert.equal(typeof qa.childEnvironment, 'function');
  for (const value of ['', '0', '1']) {
    const parent = { ELECTRON_RUN_AS_NODE: value, USERPROFILE: 'local-profile' }, env = qa.childEnvironment(parent);
    assert.equal(Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE'), false);
    assert.equal(env.USERPROFILE, 'local-profile'); assert.equal(parent.ELECTRON_RUN_AS_NODE, value);
  }
});
