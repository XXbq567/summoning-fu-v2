'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../renderer/ritual-core.js');
const metadata = title => ({ task: 'PROMPT_MUST_NOT_APPEAR', fullTask: 'FULL_PROMPT_MUST_NOT_APPEAR', presentation: { mode: 'entrance', sessionId: 'chat-a', chatTitle: title } });

test('entrance shows the chat title, never the prompt, and preserves full title for the reader', () => {
  const title = '召唤符会话标题'.repeat(15);
  const input = metadata({ value: title, source: 'reported' });
  const normalized = core.normalizeMetadata(input);
  assert.equal(normalized.fullTask, title);
  assert.equal(normalized.sources.task, 'reported');
  assert.ok(Array.from(normalized.task).length <= 40);
  assert.match(normalized.task, /…$/);
  assert.equal(normalized.presentation.titlePending, false);
  const svg = core.buildTalismanSVG(input);
  assert.doesNotMatch(svg, /PROMPT_MUST_NOT_APPEAR/);
  assert.match(svg, /会话标题/);
  assert.equal(core.buildTalismanSVG(normalized), svg);
});

test('missing title and service fields become deterministic labelled decorations without invented provenance', () => {
  const normalized = core.normalizeMetadata(metadata(null));
  assert.equal(normalized.task, '新启一程');
  assert.equal(normalized.sources.task, 'unknown');
  assert.equal(normalized.sources.company, 'unknown');
  assert.equal(normalized.relay, '未取得');
  assert.equal(normalized.presentation.titlePending, true);
  const svg = core.buildTalismanSVG(metadata(null));
  const gateway = svg.slice(svg.indexOf('id="fu-gateway"'), svg.indexOf('id="fu-invocation"'));
  assert.doesNotMatch(gateway, /未取得/);
  assert.match(gateway, /data-decorative="true"/);
  assert.match(svg, /原创题辞/);
  assert.doesNotMatch(svg, /PROMPT_MUST_NOT_APPEAR/);
  assert.equal(svg, core.buildTalismanSVG(metadata(null)));
});

test('title abbreviation and vertical layout keep combining marks in the same grapheme', () => {
  const svg = core.buildTalismanSVG(metadata({ value: '中\u0301'.repeat(45), source: 'reported' }));
  const region = svg.slice(svg.indexOf('id="fu-task-text"'), svg.indexOf('id="fu-heart"'));
  assert.equal([...region.matchAll(/>中\u0301<\/text>/g)].length, 31);
  assert.doesNotMatch(region, />\u0301<\/text>/);
});

function entrance() {
  assert.ok(fs.existsSync(path.resolve(__dirname, '../renderer/entrance-timeline.js')), 'entrance timeline exists independently of work timeline');
  return require('../renderer/entrance-timeline.js');
}

test('send sequence finishes paper before ink, reads two seconds and clears without an authenticated target', () => {
  const { frameAt } = entrance();
  for (const time of [0, 119, 120, 799, 800, 1949, 1950]) assert.equal(frameAt(time).writing, 0);
  for (const [time, phase] of [[0, 'point'], [120, 'travel'], [850, 'unfold'], [1950, 'writing'], [4150, 'hold'], [6149, 'hold'], [6150, 'hidden']]) assert.equal(frameAt(time).phase, phase);
  const full = frameAt(4150), cleared = frameAt(6150);
  assert.equal(full.writing, 1); assert.equal(full.leaveAtMs - full.holdStartMs, 2000);
  assert.equal(cleared.burn, 0); assert.equal(cleared.visualFireActive, false); assert.equal(cleared.ashOpacity, 0);
  assert.equal(cleared.state, undefined); assert.equal(cleared.visible, false);
  assert.equal(frameAt(50000).visible, false);
});

test('send sequence keeps complete ink and paper still for exactly two seconds', () => {
  const { frameAt } = entrance();
  assert.equal(frameAt(0).writing, 0);
  assert.equal(frameAt(2400).phase, 'writing');
  for (const elapsed of [4150, 5000, 6149]) {
    const frame = frameAt(elapsed);
    assert.equal(frame.phase, 'hold');
    assert.equal(frame.writing, 1);
    assert.equal(frame.opacity, 1);
    assert.equal(frame.burn, 0);
    assert.equal(frame.visible, true);
    assert.equal(frame.state, undefined);
    assert.equal(frame.needsAnimation, false);
    assert.deepEqual(frame.progress, { travel: 1, stretchX: 1, stretchY: 1 });
  }
  assert.equal(frameAt(6150).phase, 'hidden');
  assert.equal(frameAt(6150).opacity, 0);
  assert.equal(frameAt(100000).visible, false);
});

test('send sequence shares immutable timing and progress with no ink before unfolding finishes', () => {
  const { frameAt, timings } = entrance();
  assert.equal(frameAt(0).paperOpacity, 1);
  const paper = frameAt(300);
  assert.equal(paper.phase, 'travel');
  assert.equal(paper.paperOpacity, 1);
  assert.equal(paper.opacity, 1);
  assert.equal(paper.writing, 0);
  assert.equal(paper.needsAnimation, true);
  assert.equal(frameAt(850).progress.stretchY, 1);
  assert.ok(frameAt(850).progress.stretchX < 1);
  assert.equal(frameAt(1950).writing, 0);
  assert.equal(frameAt(3050).writing, .5);
  assert.equal(frameAt(4150).writing, 1);
  assert.equal(frameAt(2900).needsAnimation, true);
  const hold = frameAt(4150);
  assert.equal(hold.holdStartMs, timings.holdStartMs);
  assert.equal(hold.leaveAtMs - hold.holdStartMs, 2000);
  assert.equal(hold.hideAtMs, timings.leaveAtMs);
  assert.equal(hold.needsAnimation, false);
  const cleared = frameAt(6150);
  assert.equal(cleared.burn, 0);
  assert.equal(cleared.opacity, 0);
  assert.equal(cleared.needsAnimation, false);
  assert.equal(cleared.ashOpacity, 0);
  assert.ok(Object.isFrozen(timings));
  assert.ok(Object.isFrozen(paper));
  assert.ok(Object.isFrozen(paper.progress));
  const reduced = frameAt(0, true);
  assert.equal(reduced.paperOpacity, 1);
  assert.equal(reduced.holdStartMs, 0);
  assert.equal(reduced.leaveAtMs, 2000);
  assert.equal(reduced.needsAnimation, false);
});

test('reduced motion still expires, and stale cancellation cannot hide a retriggered entrance', () => {
  const { frameAt, EntranceTimeline } = entrance();
  assert.equal(frameAt(0, true).writing, 1);
  assert.equal(frameAt(0, true).phase, 'hold');
  assert.equal(frameAt(1999, true).visible, true);
  assert.equal(frameAt(2000, true).visible, false);
  assert.deepEqual(frameAt(13500, true).progress, { travel: 1, stretchX: 1, stretchY: 1 });
  assert.equal(frameAt(14000, true).visible, false);
  const timeline = new EntranceTimeline();
  const input = metadata('first');
  const oldToken = timeline.trigger('chat-a', 0, input);
  input.task = 'mutation';
  const token = timeline.trigger('chat-a', 1000, metadata('second'));
  assert.notEqual(oldToken, token);
  assert.equal(timeline.cancel(oldToken), false);
  assert.equal(timeline.snapshot(5150).phase, 'hold');
  assert.equal(timeline.snapshot(16000).visible, false);
  assert.equal(timeline.cancel(token), true);
  assert.equal(timeline.snapshot(4000).visible, false);
});

test('motion preference changes neither rewind complete lettering nor extend or revive a presentation', () => {
  const { EntranceTimeline, frameAt } = entrance();
  const timeline = new EntranceTimeline();
  timeline.trigger('chat-a', 0, metadata(null));
  let frame = timeline.snapshot(0, true);
  assert.equal(frame.hideAtMs, 2000);
  frame = timeline.snapshot(1000, false);
  assert.equal(frame.reducedMotion, true);
  assert.equal(frame.phase, 'hold');
  assert.equal(frame.hideAtMs, 2000);
  assert.equal(frameAt(frame.elapsedMs, frame.reducedMotion, frame).visible, frame.visible);
  assert.equal(timeline.snapshot(2000, false).visible, false);
  assert.equal(timeline.snapshot(12000, true).visible, false);
  timeline.trigger('chat-b', 13000, metadata(null));
  timeline.snapshot(13000, false);
  frame = timeline.snapshot(14500, true);
  assert.equal(frame.hideAtMs, 3500);
  assert.equal(frame.phase, 'hold');
  assert.equal(timeline.snapshot(24500, false).visible, false);
});

test('entrance renderer hides at expiry even with reduced motion and an unrelated completed task state', () => {
  const { frameAt } = entrance();
  globalThis.RitualCore = core;
  globalThis.RitualSendGeometry = require('../renderer/send-geometry.js');
  require('../renderer/burn-view.js');
  const element = () => ({ style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); }, replaceChildren() {} });
  const view = Object.create(globalThis.RitualBurn.BurnView.prototype);
  for (const name of ['svg', 'cut', 'char', 'glow', 'hot', 'rims', 'paper', 'paperBase', 'seal', 'ash']) view[name] = element();
  const glyph = element();
  view.writingSteps = [{ order: 0, total: 1, steps: [{ element: glyph, start: 0, weight: 1 }] }];
  const geometry = { originRect: { x: 880, y: 680, width: 40, height: 40 }, targetRect: { x: 340, y: 62, width: 320, height: 676 } };
  const delegated = [];
  view.material = { render: frame => delegated.push(frame) };
  view.render({ ...frameAt(300), geometry });
  assert.equal(view.paper.attributes.opacity, '0');
  assert.equal(view.paperBase.attributes.opacity, '1');
  assert.equal(glyph.style.visibility, 'hidden');
  assert.equal(view.svg.style.transform, '', 'the original sheet and glyphs never receive a whole-SVG scale');
  assert.equal(view.svg.style.display, 'none');
  assert.equal(delegated.at(-1).phase, 'travel');
  assert.equal(delegated.at(-1).visible, true);
  view.render({ ...frameAt(14000, true), state: 'completed' }, true);
  assert.equal(view.paper.attributes.opacity, '0');
  assert.equal(view.svg.style.visibility, 'hidden');
  assert.equal(view.seal.attributes.opacity, '0');
  view.render({ ...frameAt(5000), geometry });
  assert.equal(view.paper.attributes.opacity, '1');
  assert.equal(view.paperBase.attributes.opacity, '1');
  assert.equal(glyph.style.opacity, '1');
  assert.equal(view.svg.style.transform, '');
  assert.equal(view.svg.style.visibility, 'visible');
  assert.equal(view.rims.attributes.opacity, '0');
  view.render(frameAt(5000));
  assert.equal(view.svg.style.visibility, 'hidden', 'missing anchor geometry fails closed');
  view.render({ ...frameAt(5000), geometry: { ...geometry, originRect: { ...geometry.originRect, x: NaN } } });
  assert.equal(view.svg.style.visibility, 'hidden', 'invalid anchor geometry fails closed');
});

test('send sequence snapshots keep monotonic time, frozen metadata and expired generations cannot revive', () => {
  const { EntranceTimeline } = entrance();
  const timeline = new EntranceTimeline();
  const input = metadata({ value: 'first', source: 'reported' });
  const token = timeline.trigger('chat-a', 100, input);
  input.presentation.chatTitle.value = 'changed';
  const frame = timeline.snapshot(3500);
  assert.equal(frame.metadata.presentation.chatTitle.value, 'first');
  assert.ok(Object.isFrozen(frame.metadata.presentation.chatTitle));
  assert.equal(timeline.snapshot(100).elapsedMs, 3400);
  assert.equal(timeline.trigger('old', 3400, {}), null);
  assert.equal(timeline.snapshot(12600).visible, false);
  assert.equal(timeline.snapshot(3500, true).visible, false);
  assert.equal(timeline.cancel(token), true);
  assert.throws(() => timeline.snapshot(NaN), TypeError);
});
