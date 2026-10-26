'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('published quality capacity and the drawn geometry both obey the sixteen-tongue budget', async () => {
  const { fxQualityFor, DamageField, flameAnchors } = await import('paperlab/fx');
  const { limitFlameInstances, syncFireField } = require('../renderer/paperlab-fire.js');
  assert.equal(fxQualityFor('low').flames, 16, 'verify the actual published low tier rather than the stale d.ts comment');
  assert.ok(fxQualityFor('medium').flames > 16, 'fixture exposes the published medium-tier mismatch');
  const { bakeBurn, sampleBurn } = require('../renderer/paperlab-damage.js');
  const recording = bakeBurn(DamageField), source = { size: 64, pixels: new Uint8Array(16384), version: 0 };
  sampleBurn(recording, .5, source); syncFireField(source, true);
  const count = flameAnchors(source, (u,v) => ({ x: u, y: v, z: 0 }), fxQualityFor('medium').flames, []);
  assert.ok(count > 16);
  const geometry = { instanceCount: count };
  limitFlameInstances(geometry, true);
  assert.equal(geometry.instanceCount, 16, 'the actual geometry is limited, not just evidence');
  limitFlameInstances(geometry, false); assert.equal(geometry.instanceCount, 0);
});

test('non-264-DIP paper reports a strictly bounded height after Float32 GPU storage', () => {
  const { measureFlameHeightDIP } = require('../renderer/paperlab-fire.js');
  const paperW = 320 * 264 / 360;
  const storedWorldHeight = Math.fround(50 / paperW);
  assert.ok(storedWorldHeight * paperW > 50, 'fixture reproduces the actual GPU rounding overflow');
  assert.equal(measureFlameHeightDIP(storedWorldHeight, paperW), 50);
  for (const viewportW of [180, 320, 340, 360, 520]) {
    const width = viewportW * 264 / 360;
    const height = measureFlameHeightDIP(Math.fround(50 / width), width);
    assert.ok(Number.isFinite(height) && height >= 0 && height <= 50);
  }
});

test('recorded burn drives real Paperlab flames, stays seekable and extinguishes outside burn', async () => {
  const file = path.resolve(__dirname, '../renderer/paperlab-fire.js');
  assert.ok(fs.existsSync(file), 'a bounded flame adapter is required');
  const { syncFireField } = require(file);
  const { DamageField, flameAnchors } = await import('paperlab/fx');
  const { bakeBurn, sampleBurn } = require('../renderer/paperlab-damage.js');
  const recording = bakeBurn(DamageField);
  const source = { size: 64, pixels: new Uint8Array(64 * 64 * 4), version: 0 };
  const locate = (u, v) => ({ x: u - .5, y: (v - .5) * 710 / 264, z: 0 });
  sampleBurn(recording, .5, source); syncFireField(source, true);
  assert.ok(source.frontCount > 0 && source.frontCount <= 4096);
  const flames = [], count = flameAnchors(source, locate, 16, flames);
  assert.ok(count > 0 && count <= 16, 'hot edges must produce actual library flame anchors');
  const expected = structuredClone(flames.slice(0, count));
  syncFireField(source, false);
  assert.equal(flameAnchors(source, locate, 16, []), 0, 'hold, pause teardown and hidden have no free-running fire');
  sampleBurn(recording, 1, source); syncFireField(source, true);
  assert.equal(flameAnchors(source, locate, 16, []), 0, 'consumed paper cannot leave a floating fire ring');
  sampleBurn(recording, .5, source); syncFireField(source, true);
  const replay = []; assert.equal(flameAnchors(source, locate, 16, replay), count);
  assert.deepEqual(replay.slice(0, count), expected);
});

test('cold or uncut paper cannot emit tongues even if the adapter is enabled', () => {
  const file = path.resolve(__dirname, '../renderer/paperlab-fire.js');
  assert.ok(fs.existsSync(file));
  const { syncFireField } = require(file);
  const source = { size: 64, pixels: new Uint8Array(64 * 64 * 4) };
  for (let i = 0; i < source.pixels.length; i += 4) { source.pixels[i + 2] = 255; source.pixels[i + 3] = 255; }
  syncFireField(source, true); assert.equal(source.frontCount, 0);
  source.pixels[32 * 64 * 4 + 3] = 0;
  syncFireField(source, false); assert.equal(source.frontCount, 0);
});
