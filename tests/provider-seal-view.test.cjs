'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createView } = require('../renderer/provider-seal-view.js');
const { frameAt } = require('../renderer/entrance-timeline.js');
const { createLocalSealPlan } = require('../renderer/delivery-motion.js');
class Element {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.style = {}; this.children = []; this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] || null; }
  append(...children) { this.children.push(...children); }
  remove() { this.isConnected = false; }
  getBoundingClientRect() { return { x: Number.parseFloat(this.style.left), y: Number.parseFloat(this.style.top), width: Number.parseFloat(this.style.width), height: Number.parseFloat(this.style.height) }; }
}
test('a closed presentation cannot revive and a never-seen lower generation cannot replace a newer mark', async () => {
  const previous = global.document; global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const view = createView(new Element('div'), {}); await view.ready;
    const visible = generation => ({ generation, visible: true, geometry: { targetRect: { x: 0, y: 0 } }, seal: { visible: true, rect: { x: 20, y: 30, width: 70, height: 70 }, scale: 1, opacity: 1, ringRotationZ: .1, phase: 'receiving' } });
    view.render(visible(1)); assert.equal(view.getState().markVisible, true);
    view.render({ ...visible(1), visible: false }); assert.equal(view.getState().markVisible, false);
    view.render(visible(1)); assert.equal(view.getState().markVisible, false, 'same closed generation never revives');
    view.render(visible(5)); const active = view.getState(); assert.equal(active.markVisible, true);
    view.render({ ...visible(4), visible: false }); assert.deepEqual(view.getState(), active, 'unseen lower hidden frame is ignored');
    view.render(visible(4)); assert.deepEqual(view.getState(), active, 'unseen lower visible frame is ignored');
    view.dispose();
  } finally { global.document = previous; }
});
test('preparation hidden and pre-mark visible paper do not close the new generation', async () => {
  const previous = global.document; global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const view = createView(new Element('div'), {}); await view.ready;
    const frame = { generation: 3, visible: true, geometry: { targetRect: { x: 0, y: 0 } }, seal: { visible: true, rect: { x: 20, y: 30, width: 70, height: 70 }, scale: 1, opacity: 1, ringRotationZ: .1, phase: 'appearing' } };
    view.render({ ...frame, visible: false });
    view.render({ ...frame, seal: { ...frame.seal, visible: false } });
    view.render(frame); assert.equal(view.getState().markVisible, true);
    view.render({ ...frame, generation: 4, seal: { ...frame.seal, visible: false } });
    view.render({ ...frame, generation: 4, visible: false });
    view.render({ ...frame, generation: 4 }); assert.equal(view.getState().markVisible, false, 'paper-only visible stage activates whole-run cancellation');
    view.render({ ...frame, generation: 5 }); assert.equal(view.getState().markVisible, true);
    view.dispose();
  } finally { global.document = previous; }
});
test('mark keeps actual logo DOM angle fixed, rotates a sibling ring, and clears both on hide/disposal', async () => {
  const previous = global.document; global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const container = new Element('div'), view = createView(container, { company: 'unverified', model: 'arbitrary-alias' }); await view.ready;
    const geometry = { originRect: { x: 0, y: 0, width: 8, height: 8 }, targetRect: { x: 100, y: 30, width: 264, height: 557.3333333333334 } };
    const localSeal = { source: 'local-generated-seal', coordinateSpace: 'overlay-local-dip', runId: 'run-a', generation: 1, layoutVersion: 0,
      rect: { x: 420, y: 270, width: 88, height: 88 }, acceptancePoint: { x: 464, y: 314 } };
    const plan = createLocalSealPlan(geometry, localSeal), frame = time => ({ ...frameAt(time, false, { geometry, localSeal, deliveryPlan: plan, allowLocalSeal: true }), geometry, generation: 1 });
    view.render(frame(6050)); const early = view.getState();
    view.render(frame(7100)); const later = view.getState();
    assert.equal(early.markLogoTransform, 'rotate(0 50 50)'); assert.equal(later.markLogoTransform, early.markLogoTransform);
    assert.notEqual(later.markRingTransform, early.markRingTransform);
    assert.equal(later.markPointerEvents, 'none'); assert.equal(later.providerKind, 'generic');
    assert.deepEqual(later.markBounds, { x: 320, y: 240, width: 88, height: 88 });
    const [, ring, logo] = container.children[0].children[0].children;
    assert.equal(ring.children.some(n => n === logo), false, 'logo is not a child of the rotating circle');
    view.render({ ...frame(7200), visible: false }); assert.equal(view.getState().markVisible, false);
    view.render({ ...frame(7200), generation: 2 }); assert.equal(view.getState().markVisible, true);
    view.render(frame(7400)); assert.equal(view.getState().markVisible, true, 'retired run must not hide the new mark');
    view.dispose(); view.render({ ...frame(7200), generation: 3 }); assert.equal(view.getState().markVisible, false); assert.equal(view.getState().markAttached, false);
  } finally { global.document = previous; }
});

test('rejected or stuck brand image decoding falls back before readiness instead of blocking the paper', async () => {
  const previousDocument = global.document, previousImage = global.Image;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  const branded = { model: 'gpt-6.1-sol', company: 'OpenAI', sources: { model: 'reported', company: 'reported' } };
  try {
    for (const decode of [() => Promise.reject(new Error('decode rejected')), () => new Promise(() => {})]) {
      global.Image = class { decode() { return decode(); } };
      const container = new Element('div'), view = createView(container, branded, { assetDecodeTimeoutMs: 10 });
      await view.ready;
      assert.equal(view.getState().providerKind, 'generic');
      assert.equal(view.getState().markVisible, false);
      view.dispose();
    }
    let resolveDecode;
    global.Image = class { decode() { return new Promise(resolve => { resolveDecode = resolve; }); } };
    const container = new Element('div'), view = createView(container, branded, { assetDecodeTimeoutMs: 10 });
    view.dispose(); await view.ready; resolveDecode();
    assert.equal(view.getState().markAttached, false);
    assert.equal(view.getState().markVisible, false);
    assert.equal(view.getState().providerAssetId, 'openai-blossom', 'late decoder cannot replace a retired view resource');
  } finally { global.document = previousDocument; global.Image = previousImage; }
});
