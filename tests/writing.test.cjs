'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../renderer/ritual-core.js');

test('cancelled collects the paper and clears fire and ash; unknown preserves a quiet sheet', () => {
  globalThis.RitualCore = core;
  require('../renderer/burn-view.js');
  // Exercise render itself without constructing a browser. These minimal DOM
  // surfaces record its visible-output mutations, including stale ash clearing.
  const element = () => ({ attributes: {}, children: ['old ash'], setAttribute(key, value) { this.attributes[key] = String(value); }, replaceChildren() { this.children = []; } });
  const view = Object.create(globalThis.RitualBurn.BurnView.prototype);
  for (const name of ['cut', 'char', 'glow', 'hot', 'rims', 'paper', 'seal', 'ash']) view[name] = element();
  view.writingSteps = [];
  const frame = { state: 'cancelled', burn: .5, variant: 'bottom-up', seed: 1, opacity: 1, writing: 1, activeMs: 15000 };
  view.render(frame);
  assert.equal(view.paper.attributes.opacity, '0');
  assert.equal(view.rims.attributes.opacity, '0');
  assert.deepEqual(view.ash.children, []);
  assert.equal(view.seal.attributes.opacity, '0');
  view.render({ ...frame, state: 'unknown' });
  assert.equal(view.paper.attributes.opacity, '0.45');
  assert.equal(view.glow.attributes.opacity, '0');
  assert.equal(view.hot.attributes.opacity, '0');
});

test('writing starts with blank paper and advances groups without an initial ink flash', () => {
  assert.equal(typeof core.writingProgress, 'function');
  for (let order = 0; order < 7; order++) assert.equal(core.writingProgress(0, order), 0);
  assert.equal(core.writingProgress(0.15, 0), 1);
  assert.equal(core.writingProgress(0.15, 6), 0);
  for (let order = 0; order < 7; order++) assert.equal(core.writingProgress(1, order), 1);
});

test('mixed Chinese and Latin task keeps Latin words on horizontal lines', () => {
  const svg = core.buildTalismanSVG({ task: '修复 Electron IPC session_id 接入' });
  const region = svg.slice(svg.indexOf('id="fu-task-text"'), svg.indexOf('id="fu-heart"'));
  assert.match(region, /Electron/);
  assert.match(region, /session_id/);
  assert.doesNotMatch(region, />E<\/text>/);
});

test('long Latin model wraps with an explicit ellipsis instead of reducing below readable size', () => {
  const svg = core.buildTalismanSVG({ model: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
  const region = svg.slice(svg.indexOf('id="fu-invocation"'), svg.indexOf('id="fu-edict"'));
  assert.match(region, /…/);
  assert.ok([...region.matchAll(/font-size="([\d.]+)"/g)].every(m => Number(m[1]) >= 10));
});

test('font coverage comes from the actual bundled TTF and reports unsupported code points', () => {
  const fontModule = '../renderer/font-coverage.js';
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname, fontModule)), 'font coverage module exists');
  const coverage = require(fontModule);
  const bytes = fs.readFileSync(require('node:path').resolve(__dirname, '../assets/fonts/MaShanZheng-Regular.ttf'));
  const parsed = coverage.parseCmap(bytes);
  assert.equal(coverage.hasGlyph('召', parsed), true);
  assert.equal(coverage.hasGlyph('\u{10ffff}', parsed), false);
  const report = coverage.report('召\u{10ffff}召\u{10ffff}', parsed);
  assert.deepEqual(report.missingFromBrush, [{ character: '\u{10ffff}', codePoint: 'U+10FFFF' }]);
  assert.match(core.buildTalismanSVG({}), /Microsoft YaHei/);
});
