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

test('send sequence hands one complete paper-and-ink snapshot to delivery without independent fire or ash', () => {
  const { frameAt } = require('../renderer/entrance-timeline.js');
  globalThis.RitualCore = core;
  globalThis.RitualSendGeometry = require('../renderer/send-geometry.js');
  require('../renderer/burn-view.js');
  const element = () => ({ style: {}, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = String(value); }, append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); }, replaceChildren() { this.children = []; }, querySelectorAll() { return []; } });
  const svg = element(), defs = element(), paper = element(), base = element(), ink = element();
  paper.append(base, ink);
  svg.querySelector = selector => ({ defs, '#ritual-paper-content': paper, '#ritual-paper-base': base })[selector] || null;
  const previousDocument = globalThis.document, previousParser = globalThis.DOMParser;
  globalThis.document = { createElementNS: () => element(), importNode: value => value };
  globalThis.DOMParser = class { parseFromString() { return { documentElement: svg, querySelector() { return null; } }; } };
  try {
    const view = new globalThis.RitualBurn.BurnView(element(), {});
    const delegated = [];
    view.material = { render: frame => delegated.push(frame) };
    const geometry = { originRect: { x: 880, y: 680, width: 40, height: 40 }, targetRect: { x: 340, y: 62, width: 320, height: 676 } };
    const target={targetId:'preview',revision:1,rect:{x:800,y:800,width:80,height:80},coordinateSpace:'overlay-local-dip',source:'preview-example',valid:true,visible:true,observedAtMonotonicMs:0,expiresAtMonotonicMs:20000};
    const options={geometry,deliveryTarget:target,allowPreviewTarget:true,nowMs:100};
    const render = time => view.render({ ...frameAt(time,false,options), geometry });
    assert.equal(paper.attributes.mask, 'url(#ritual-burn-mask)');
    assert.deepEqual(paper.children, [base, ink], 'paper and ink stay inside their common mask');
    assert.equal(view.rims.attributes.mask, paper.attributes.mask);
    render(5000);
    assert.equal(view.cut.attributes.d, '');
    assert.equal(view.rims.attributes.opacity, '0');
    render(6250);
    assert.equal(delegated.at(-1).burn, 0);
    assert.equal(delegated.at(-1).phase, 'rolling');
    assert.equal(delegated.at(-1).delivery.plan.target.targetId,'preview');
    assert.equal(delegated.at(-1).visible, true);
    assert.equal(svg.style.display, 'none', 'the SVG cannot leave independent floating ink or fire rings');
    assert.equal(view.cut.attributes.d, '');
    assert.equal(view.rims.attributes.opacity, '0');
    assert.equal(view.ash.children.length,0);
    render(7000);
    assert.equal(delegated.at(-1).phase,'rotating');
    assert.equal(view.ash.children.length,0);
    render(frameAt(7000,false,options).hideAtMs);
    assert.equal(view.cut.attributes.d, '');
    assert.equal(paper.attributes.opacity, '0');
    assert.equal(view.rims.attributes.opacity, '0');
    assert.equal(view.hot.attributes.d, '');
    assert.equal(view.glow.attributes.opacity, '0');
    assert.equal(view.ash.children.length,0);
    assert.equal(svg.style.visibility, 'hidden');
    assert.equal(view.ash.children.length, 0);
    assert.equal(view.seal.attributes.opacity, '0');
  } finally {
    globalThis.document = previousDocument;
    globalThis.DOMParser = previousParser;
  }
});

test('send sequence completes every glyph and trace before its two-second hold without independent ink fading', () => {
  const { frameAt } = require('../renderer/entrance-timeline.js');
  globalThis.RitualCore = core;
  globalThis.RitualSendGeometry = require('../renderer/send-geometry.js');
  require('../renderer/burn-view.js');
  const element = () => ({ style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); }, replaceChildren() {} });
  const view = Object.create(globalThis.RitualBurn.BurnView.prototype);
  for (const name of ['svg', 'cut', 'char', 'glow', 'hot', 'rims', 'paper', 'paperBase', 'seal', 'ash']) view[name] = element();
  view.writingSteps = Array.from({ length: 7 }, (_, order) => ({ order, total: 3, steps: [
    { element: element(), trace: element(), length: 130, start: 0, weight: 2 },
    { element: element(), start: 2, weight: 1 },
  ] }));
  const geometry = { originRect: { x: 880, y: 680, width: 40, height: 40 }, targetRect: { x: 340, y: 62, width: 320, height: 676 } };
  for (const time of [0, 120, 800, 1949, 1950]) {
    view.render({ ...frameAt(time), geometry });
    for (const group of view.writingSteps) for (const step of group.steps) assert.equal(step.element.style.visibility, 'hidden');
  }
  // Completion is frozen while reading; expiration never changes a task state.
  for (const time of [4150, 5000, 6149]) {
    view.render({ ...frameAt(time), geometry });
    for (const group of view.writingSteps) for (const step of group.steps) {
      assert.equal(step.element.style.visibility, 'visible');
      if (step.trace) assert.equal(step.trace.attributes['stroke-dashoffset'], '0');
      else assert.equal(step.element.style.opacity, '1');
    }
  }
});

test('existing thirty-second work presentation still burns, renews and completes through its own state', () => {
  const timeline = require('../renderer/ritual-timeline.js');
  globalThis.RitualCore = core;
  require('../renderer/burn-view.js');
  const element = () => ({ style: {}, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = String(value); }, replaceChildren() { this.children = []; }, append(value) { this.children.push(value); } });
  const view = Object.create(globalThis.RitualBurn.BurnView.prototype);
  for (const name of ['svg', 'cut', 'char', 'glow', 'hot', 'rims', 'paper', 'paperBase', 'seal', 'ash']) view[name] = element();
  view.writingSteps = [];
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: () => element() };
  try {
    const work = timeline.frameAt(15000);
    assert.equal(work.cycleMs, 30000);
    view.render({ ...work, state: 'working' });
    assert.notEqual(view.cut.attributes.d, '');
    assert.equal(view.rims.attributes.opacity, '1');
    assert.equal(view.glow.attributes.opacity, '0.9');
    assert.ok(view.ash.children.length <= 10);
    view.render({ ...timeline.frameAt(30000), state: 'working' });
    assert.equal(view.cut.attributes.d, '');
    assert.equal(timeline.frameAt(30000).sheetNumber, 2);
    view.render({ ...work, state: 'completed' });
    assert.equal(view.paper.attributes.opacity, '1');
    assert.equal(view.cut.attributes.d, '');
    assert.equal(view.seal.attributes.opacity, '1');
    assert.equal(view.rims.attributes.opacity, '0');
  } finally { globalThis.document = previousDocument; }
});
