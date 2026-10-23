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

test('entrance writes, holds a complete sheet for ten seconds, then hides without completing work', () => {
  const { frameAt } = entrance();
  assert.equal(frameAt(0).writing, 0);
  assert.equal(frameAt(2400).phase, 'writing');
  assert.equal(frameAt(2750).phase, 'seal');
  for (const elapsed of [3000, 5000, 12999]) {
    const frame = frameAt(elapsed);
    assert.equal(frame.phase, 'hold');
    assert.equal(frame.writing, 1);
    assert.equal(frame.opacity, 1);
    assert.equal(frame.burn, 0);
    assert.equal(frame.visible, true);
    assert.equal(frame.state, undefined);
  }
  assert.equal(frameAt(13000).phase, 'leaving');
  assert.ok(frameAt(13500).scaleX < 1);
  assert.equal(frameAt(14000).visible, false);
  assert.equal(frameAt(100000).visible, false);
});

test('paper appears before ink and the shared frame defines every animation boundary', () => {
  const { frameAt, timings } = entrance();
  assert.equal(frameAt(0).paperOpacity, 0);
  const paper = frameAt(300);
  assert.equal(paper.phase, 'paper');
  assert.ok(paper.paperOpacity > 0 && paper.paperOpacity < 1);
  assert.equal(paper.opacity, 1);
  assert.equal(paper.writing, 0);
  assert.ok(paper.translateY > 0 && paper.translateY < 8);
  assert.equal(paper.needsAnimation, true);
  assert.equal(frameAt(650).paperOpacity, 1);
  assert.equal(frameAt(650).writing, 0);
  assert.equal(frameAt(1700).writing, .5);
  assert.equal(frameAt(2750).writing, 1);
  assert.equal(frameAt(2900).needsAnimation, true);
  const hold = frameAt(3000);
  assert.equal(hold.holdStartMs, timings.holdStartMs);
  assert.equal(hold.leaveAtMs - hold.holdStartMs, 10000);
  assert.equal(hold.hideAtMs, timings.totalMs);
  assert.equal(hold.needsAnimation, false);
  const leaving = frameAt(13500);
  assert.equal(leaving.leaveProgress, .5);
  assert.equal(leaving.opacity, .5);
  assert.equal(leaving.paperOpacity, 1);
  assert.equal(leaving.scaleX, .99);
  assert.equal(leaving.scaleY, .99);
  assert.equal(leaving.translateY, 4);
  assert.equal(leaving.needsAnimation, true);
  assert.equal(frameAt(14000).needsAnimation, false);
  const reduced = frameAt(0, true);
  assert.equal(reduced.paperOpacity, 1);
  assert.equal(reduced.holdStartMs, 0);
  assert.equal(reduced.leaveAtMs, 10000);
  assert.equal(reduced.needsAnimation, false);
});

test('reduced motion still expires, and stale cancellation cannot hide a retriggered entrance', () => {
  const { frameAt, EntranceTimeline } = entrance();
  assert.equal(frameAt(0, true).writing, 1);
  assert.equal(frameAt(0, true).phase, 'hold');
  assert.equal(frameAt(9999, true).visible, true);
  assert.equal(frameAt(10000, true).visible, false);
  assert.equal(frameAt(13500, true).scaleX, 1);
  assert.equal(frameAt(14000, true).visible, false);
  const timeline = new EntranceTimeline();
  const input = metadata('first');
  const oldToken = timeline.trigger('chat-a', 0, input);
  input.task = 'mutation';
  const token = timeline.trigger('chat-a', 1000, metadata('second'));
  assert.notEqual(oldToken, token);
  assert.equal(timeline.cancel(oldToken), false);
  assert.equal(timeline.snapshot(4000).phase, 'hold');
  assert.equal(timeline.snapshot(16000).visible, false);
  assert.equal(timeline.cancel(token), true);
  assert.equal(timeline.snapshot(4000).visible, false);
});

test('motion preference changes neither rewind complete lettering nor extend or revive a presentation', () => {
  const { EntranceTimeline, frameAt } = entrance();
  const timeline = new EntranceTimeline();
  timeline.trigger('chat-a', 0, metadata(null));
  let frame = timeline.snapshot(0, true);
  assert.equal(frame.hideAtMs, 10000);
  frame = timeline.snapshot(5000, false);
  assert.equal(frame.reducedMotion, true);
  assert.equal(frame.phase, 'hold');
  assert.equal(frame.hideAtMs, 10000);
  assert.equal(frameAt(frame.elapsedMs, frame.reducedMotion, frame).visible, frame.visible);
  assert.equal(timeline.snapshot(10000, false).visible, false);
  assert.equal(timeline.snapshot(12000, true).visible, false);
  timeline.trigger('chat-b', 13000, metadata(null));
  timeline.snapshot(13000, false);
  frame = timeline.snapshot(14500, true);
  assert.equal(frame.hideAtMs, 11500);
  assert.equal(frame.phase, 'hold');
  assert.equal(timeline.snapshot(24500, false).visible, false);
});

test('entrance renderer hides at expiry even with reduced motion and an unrelated completed task state', () => {
  const { frameAt } = entrance();
  globalThis.RitualCore = core;
  require('../renderer/burn-view.js');
  const element = () => ({ style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); }, replaceChildren() {} });
  const view = Object.create(globalThis.RitualBurn.BurnView.prototype);
  for (const name of ['svg', 'cut', 'char', 'glow', 'hot', 'rims', 'paper', 'paperBase', 'seal', 'ash']) view[name] = element();
  const glyph = element();
  view.writingSteps = [{ order: 0, total: 1, steps: [{ element: glyph, start: 0, weight: 1 }] }];
  view.render(frameAt(300));
  assert.equal(view.paper.attributes.opacity, '1');
  assert.ok(Number(view.paperBase.attributes.opacity) > 0 && Number(view.paperBase.attributes.opacity) < 1);
  assert.equal(glyph.style.visibility, 'hidden');
  view.render({ ...frameAt(14000, true), state: 'completed' }, true);
  assert.equal(view.paper.attributes.opacity, '0');
  assert.equal(view.svg.style.visibility, 'hidden');
  assert.equal(view.seal.attributes.opacity, '0');
  view.render(frameAt(13500));
  assert.equal(view.paper.attributes.opacity, '0.5');
  assert.equal(view.paperBase.attributes.opacity, '1');
  assert.equal(glyph.style.opacity, '1');
  assert.match(view.svg.style.transform, /scale\(0\.99, 0\.99\)/);
  assert.equal(view.svg.style.visibility, 'visible');
  assert.equal(view.rims.attributes.opacity, '0');
});
