'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
test('three bands map the current texture exactly once, blank backs use separate material', () => {
  const folded = require('../renderer/folded-paper.js');
  const bands = folded.textureBands();
  assert.deepEqual(bands.map(b => [b.vMin, b.vMax]), [[2 / 3, 1], [1 / 3, 2 / 3], [0, 1 / 3]]);
  assert.equal(folded.FOLD_MODEL, 'bottom-then-middle-nested-hinges');
});
test('real Three bands retain front ink, blank reverse and two nested physical hinges', async () => {
  const THREE = await import('three'), folded = require('../renderer/folded-paper.js');
  const full = new THREE.Texture(), blank = new THREE.Texture();
  const model = folded.createFoldedPaper(THREE, { full, blank });
  const front = [], back = [];
  model.root.traverse(mesh => { if (mesh.name.startsWith('front-band-')) front.push(mesh); if (mesh.name.startsWith('blank-back-')) back.push(mesh); });
  assert.equal(front.length, 3); assert.equal(back.length, 3);
  for (const mesh of front) { assert.equal(mesh.material.map, full); assert.equal(mesh.material.side, THREE.FrontSide); }
  for (const mesh of back) { assert.equal(mesh.material.map, blank); assert.equal(mesh.material.side, THREE.BackSide); }
  assert.equal(model.root.getObjectByName('bottom-hinge').parent, model.root.getObjectByName('middle-hinge'));
  const resources = []; model.root.traverse(mesh => { if (mesh.isMesh) resources.push(mesh.geometry, mesh.material); });
  let released = 0; for (const item of new Set(resources)) item.addEventListener('dispose', () => released++);
  model.dispose(); assert.equal(released, new Set(resources).size);
  assert.equal(full.version, 0, 'shared content textures are owned and released by the generation engine');
});
test('thin layer edges and crease shading sample the same blank alpha silhouette', async () => {
  const THREE = await import('three'), folded = require('../renderer/folded-paper.js');
  const full = new THREE.Texture(), blank = new THREE.Texture(), model = folded.createFoldedPaper(THREE, { full, blank });
  const ornaments = []; model.root.traverse(mesh => { if (mesh.isMesh && !/^(front-band-|blank-back-)/.test(mesh.name)) ornaments.push(mesh); });
  assert.equal(ornaments.length, 9);
  for (const mesh of ornaments) {
    assert.equal(mesh.material.map, blank, 'a solid full-width edge leaks beyond the die-cut paper');
    assert.ok(mesh.material.alphaTest > 0, 'transparent outside pixels must not write depth');
    const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) assert.ok(Math.abs(uv.getX(i) - (position.getX(i) + .5)) < 1e-6);
  }
  model.dispose();
});
test('texture ink splitting preserves the SVG writing path union instead of cancelling opposite winds', () => {
  const folded = require('../renderer/folded-paper.js');
  const d = 'M0 0H10V4H0Z M4 -2V6H6V-2Z';
  assert.deepEqual(folded.inkSubpaths(d), ['M0 0H10V4H0Z ', 'M4 -2V6H6V-2Z']);
  assert.equal(folded.inkSubpaths('M0 0C1 2 3 4 5 6Z').length, 1);
});
