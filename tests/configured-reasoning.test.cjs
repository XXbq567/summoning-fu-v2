'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEntranceEvent, applyVerifiedReasoning } = require('../adapter/entrance-event.cjs');
const { sanitizeReasoningEvidence } = require('../desktop/host-state.cjs');
const Core = require('../renderer/ritual-core.js');
const { EntranceTimeline } = require('../renderer/entrance-timeline.js');
const { fieldSourceExplanation } = require('../desktop/reader.js');
const now = Date.parse('2026-10-26T00:00:00Z');
const event = () => createEntranceEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'session-a', turn_id: 'turn-a', model: 'gpt-5.6-luna' }, { now });
function verification() {
  return { verified: true, sourceKind: 'codex-paginated-metadata', sourceRevision: 'a'.repeat(64), sessionId: 'session-a', turnId: 'turn-a', startedAtMs: now,
    reasoning: { value: 'high', source: 'configured', storageSource: 'codex-thread-config', sessionId: 'session-a', observedAt: now, model: null, contextOffset: null } };
}
test('configured effort is explicitly converted with configured provenance and frozen per run', () => {
  const applied = applyVerifiedReasoning(event(), verification());
  assert.equal(applied.metadata.reasoning, 'high'); assert.equal(applied.provenance.reasoning, 'configured');
  const metadata = { ...applied.metadata, sources: { ...applied.provenance } }, timeline = new EntranceTimeline();
  timeline.trigger('own-run', 0, metadata); metadata.reasoning = 'low'; metadata.sources.reasoning = 'reported';
  assert.equal(timeline.snapshot(1).metadata.reasoning, 'high'); assert.equal(timeline.snapshot(1).metadata.sources.reasoning, 'configured');
});
test('foreign, unverified or untyped configuration cannot acquire a provenance label', () => {
  for (const patch of [{ verified: false }, { sourceKind: 'codex-rollout' }, { sourceRevision: null }, { sessionId: 'other' }, { turnId: 'other' },
    { reasoning: { ...verification().reasoning, storageSource: 'global-default' } },
    { reasoning: { ...verification().reasoning, sessionId: 'other' } },
    { reasoning: { ...verification().reasoning, observedAt: Infinity } },
    { reasoning: { ...verification().reasoning, observedAt: now - 6000 } },
    { reasoning: { ...verification().reasoning, observedAt: now + 120001 } },
    { reasoning: { ...verification().reasoning, value: 'invalid' } }]) {
    const applied = applyVerifiedReasoning(event(), { ...verification(), ...patch });
    assert.equal(applied.metadata.reasoning, null); assert.equal(applied.provenance.reasoning, 'unknown');
  }
});
test('existing genuine JSONL context stays reported and paginated ordinals cannot impersonate byte offsets', () => {
  const legacy = { verified: true, sourceKind: 'codex-rollout', sessionId: 'session-a', turnId: 'turn-a', offset: 100,
    reasoning: { value: 'xhigh', source: 'reported', model: 'gpt-5.6-luna', contextOffset: 200 } };
  const reported = applyVerifiedReasoning(event(), legacy);
  assert.equal(reported.metadata.reasoning, 'xhigh'); assert.equal(reported.provenance.reasoning, 'reported');
  const forged = applyVerifiedReasoning(event(), { ...verification(), offset: 100, reasoning: legacy.reasoning });
  assert.equal(forged.provenance.reasoning, 'unknown');
});
test('configured evidence diagnostic strips identities and retains its limited storage semantics', () => {
  assert.deepEqual(sanitizeReasoningEvidence({ ...verification().reasoning, prompt: 'DO_NOT_COPY' }),
    { value: 'high', source: 'configured', storageSource: 'codex-thread-config', observedAt: now, contextOffset: null });
  for (const patch of [{ observedAt: Infinity }, { storageSource: 'unknown' }, { value: 'invalid' }]) {
    assert.equal(sanitizeReasoningEvidence({ ...verification().reasoning, ...patch }).source, 'unknown');
  }
});
test('the paper and its accessible description visibly distinguish configuration from actual reported effort', () => {
  const names = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高' };
  for (const [reasoning, label] of Object.entries(names)) {
    const svg = Core.buildTalismanSVG({ reasoning, sources: { reasoning: 'configured' } });
    const heart = svg.slice(svg.indexOf('id="fu-heart"'));
    assert.ok(heart.includes('配置·' + label)); assert.match(svg, /线程配置快照，未确认本次任务实际生效/);
  }
  const reported = Core.buildTalismanSVG({ reasoning: 'high', sources: { reasoning: 'reported' } });
  assert.doesNotMatch(reported, /配置·|线程配置快照/);
  const unknown = Core.buildTalismanSVG({ reasoning: null, sources: { reasoning: 'unknown' } });
  assert.doesNotMatch(unknown, /配置·/); assert.match(unknown, /未取得/);
});
test('expanded reader explicitly explains the limited thread configuration evidence', () => {
  assert.equal(fieldSourceExplanation('reasoning', 'configured'), '线程配置快照，未确认本次任务实际生效');
  assert.equal(fieldSourceExplanation('model', 'configured'), '配置值，未证明当次生效');
  assert.equal(fieldSourceExplanation('reasoning', 'reported'), '当次来源明确报告');
  assert.equal(fieldSourceExplanation('reasoning', 'unexpected'), '未取得');
});
