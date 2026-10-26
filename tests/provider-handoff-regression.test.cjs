'use strict';
// Synthetic hook envelopes only. No sessions, prompt bodies, app UI or auth reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEntranceEvent, validateEntranceEvent } = require('../adapter/entrance-event.cjs');
const Identity = require('../renderer/provider-identity.js');
const Assets = require('../renderer/provider-assets.js');
const Core = require('../renderer/ritual-core.js');
const models = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
function ownSyntheticMetadata(model) {
  const now = Date.parse('2026-10-25T00:00:00Z');
  const event = createEntranceEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-provider-regression',
    turn_id: model, model, cwd: 'C:/synthetic-own-window' }, { now });
  const clean = validateEntranceEvent(event, { now });
  assert.ok(clean);
  // This is the actual host's explicit provenance -> renderer sources boundary.
  return { ...clean.metadata, sources: { ...(clean.metadata.sources || clean.provenance || {}) },
    presentation: { mode: 'entrance', sessionId: clean.sessionId, chatTitle: { value: null, source: 'unknown' } } };
}
test('reported hook model remains readable and selects its provider mark through the complete local handoff', () => {
  for (const model of models) {
    const metadata = ownSyntheticMetadata(model), identity = Identity.resolveProvider(metadata);
    assert.equal(metadata.model, model);
    assert.equal(metadata.company, null);
    assert.equal(metadata.sources.model, 'reported');
    assert.ok(Core.buildTalismanSVG(metadata).includes(model));
    assert.equal(identity.kind, 'brand', model);
    assert.equal(Assets.getMark(identity).assetId, 'openai-blossom', model);
  }
});
test('a displayed but unreviewed hook model never borrows the provider mark', () => {
  const model = 'gpt-5.6-luna-custom', metadata = ownSyntheticMetadata(model);
  assert.ok(Core.buildTalismanSVG(metadata).includes(model));
  const identity = Identity.resolveProvider(metadata);
  assert.equal(identity.kind, 'generic');
  assert.equal(Assets.getMark(identity).assetId, 'generic');
});
