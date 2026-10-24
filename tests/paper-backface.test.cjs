'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const location = path.join(__dirname, '../renderer/paper-backface.js');
const backface = fs.existsSync(location) ? require(location) : null;
const linear = byte => { const x = byte / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; };
test('paper-back strength is independently bounded, defaults to .1 and never accepts a whole-paper opacity', () => {
  assert.ok(backface, 'the shared paper-back material adapter must exist');
  assert.equal(backface.normalizeStrength(), .1);
  for (const value of [0, .1, .2]) assert.equal(backface.normalizeStrength(value), value);
  for (const value of [-.1, .200001, 2, NaN, Infinity, null, '.1']) assert.throws(() => backface.normalizeStrength(value), /strength/);
});
test('back pixels preserve paper alpha in physical UVs, compensate Paperlab x flip and leave the front untouched', () => {
  assert.ok(backface, 'the shared paper-back material adapter must exist');
  const blank = new Uint8ClampedArray([250, 241, 225, 255, 238, 231, 211, 17]);
  const front = new Uint8ClampedArray([154, 34, 20, 255, 200, 180, 120, 17]);
  const original = front.slice();
  const result = backface.createBackPixels({ front, blank, width: 2, height: 1 }, 0);
  assert.deepEqual([...result], [...blank.slice(4), ...blank.slice(0, 4)]);
  assert.deepEqual(front, original);
  assert.notEqual(result, blank); assert.notEqual(result, front);
  for (const strength of [.1, .2]) {
    const pixels = backface.createBackPixels({ front, blank, width: 2, height: 1 }, strength);
    for (let source = 0; source < 2; source++) {
      const target = 1 - source;
      assert.equal(pixels[target * 4 + 3], blank[source * 4 + 3]);
      for (let c = 0; c < 3; c++) {
        const paper = linear(blank[source * 4 + c]), ink = linear(front[source * 4 + c]);
        const actual = linear(pixels[target * 4 + c]);
        assert.ok(Math.abs(actual - (paper + strength * (ink - paper))) < .005,
          'only the bounded ink difference is mixed in linear light');
      }
    }
  }
  assert.throws(() => backface.createBackPixels({ front, blank, width: 1, height: 1 }, .1), /pixels/);
});
test('the same actual Three material uses one genuine DoubleSide pass without weakening depth, alpha or clipping', async () => {
  assert.ok(backface, 'the shared paper-back material adapter must exist');
  const THREE = await import('three');
  const clipping = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1)];
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1, alphaTest: .01, depthWrite: true, clippingPlanes: clipping });
  assert.equal(material.forceSinglePass, false, 'the installed Three default reproduces the two-pass risk');
  backface.configureFacing(material);
  assert.equal(material.forceSinglePass, true); assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.opacity, 1); assert.equal(material.alphaTest, .01);
  assert.equal(material.depthWrite, true); assert.equal(material.depthTest, true);
  assert.equal(material.clippingPlanes, clipping); assert.equal(material.transparent, true);
  material.dispose();
});
test('inspection admission is fixed, strict and never changes the normal roll by default', () => {
  assert.ok(backface, 'the shared paper-back material adapter must exist');
  assert.equal(backface.normalizeInspection(), null);
  const config = backface.normalizeInspection({ pose: 'back', shader: 'facing', legacyDoublePass: true });
  assert.equal(config.pose, 'back'); assert.equal(config.shader, 'facing'); assert.equal(config.legacyDoublePass, true);
  assert.ok(Object.isFrozen(config));
  assert.equal(backface.normalizeInspection({ pose: 'back', shader: 'paper-reference' }).shader, 'paper-reference');
  for (const config of [{ pose: 'fly' }, { pose: 'back', callback: 'anything' }, { pose: 'front', legacyDoublePass: 'true' }, { pose: 'front', legacyDoublePass: null }, { pose: 'front', shader: null }, { pose: 'front', behind: 'saved-position' }]) assert.throws(() => backface.normalizeInspection(config), /inspection/);
});
