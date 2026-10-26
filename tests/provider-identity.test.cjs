'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Identity = require('../renderer/provider-identity.js');
const reviewedModels = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const reported = (extra = {}) => ({ model: 'gpt-6.1-sol', sources: { model: 'reported' }, ...extra });
test('only exact reviewed model with current reported evidence resolves brand', () => {
  const result = Identity.resolveProvider(reported());
  assert.equal(result.providerId, 'openai'); assert.equal(result.kind, 'brand');
  assert.equal(result.evidenceUrl, 'https://developers.openai.com/api/docs/models/gpt-6.1-sol');
  assert.ok(Object.isFrozen(result));
  assert.equal(result.source, 'reported-model+reviewed-catalog');
});
test('reported gpt-5.6-luna resolves its reviewed OpenAI identity', () => {
  const result = Identity.resolveProvider(reported({ model: 'gpt-5.6-luna' }));
  assert.equal(result.kind, 'brand');
  assert.equal(result.assetId, 'openai-blossom');
  assert.equal(result.evidenceId, 'openai-api-model-gpt-5.6-luna-reviewed-2026-10-25');
  assert.equal(result.evidenceUrl, 'https://developers.openai.com/api/docs/models/gpt-5.6-luna');
});
test('aliases, prefix guesses, relay, company labels and unknown evidence do not authorize brand', () => {
  for (const value of [null, {}, { company: 'OpenAI', sources: { company: 'reported' } },
    { relay: 'OpenAI', harness: 'ChatGPT' }, reported({ model: 'gpt-anything' }),
    reported({ model: 'GPT-6.1-SOL' }), reported({ model: ' gpt-6.1-sol' }),
    reported({ model: 'gpt-6.1-sol-custom' }), reported({ sources: { model: 'configured' } }),
    reported({ sources: { model: 'unknown' } }), reported({ sources: { model: 'manual' } }),
    reported({ sources: { model: 'demo' } }), reported({ company: '如律' }),
    reported({ company: 'Other Provider', sources: { model: 'reported', company: 'reported' } }),
    reported({ provenance: { model: 'unknown' } }),
    { providerId: 'openai', assetId: 'openai-blossom', kind: 'brand', sources: { model: 'reported' } },
    reported({ company: 'OpenAI', sources: { model: 'reported', company: 'unknown' } })]) {
    const result = Identity.resolveProvider(value); assert.equal(result.kind, 'generic', JSON.stringify(value));
    assert.equal(result.assetId, 'generic'); assert.equal(result.providerId, null);
  }
});
test('explicit demo option remains labelled and does not authorize arbitrary demo aliases', () => {
  const meta = reported({ sources: { model: 'demo' } });
  assert.equal(Identity.resolveProvider(meta).kind, 'generic');
  assert.equal(Identity.resolveProvider(meta, { allowDemo: true }).source, 'demo-preview');
  assert.equal(Identity.resolveProvider({ ...meta, model: 'gpt-custom' }, { allowDemo: true }).kind, 'generic');
});
test('trusted company consistency and provenance conflict are explicit', () => {
  assert.equal(Identity.resolveProvider(reported({ company: 'OpenAI', sources: { model: 'reported', company: 'configured' } })).kind, 'brand');
  assert.equal(Identity.resolveProvider({ model: 'gpt-6.1-sol', provenance: { model: 'reported' } }).kind, 'brand');
  const mutable = reported(); const result = Identity.resolveProvider(mutable); mutable.model = 'changed';
  assert.equal(result.model, 'gpt-6.1-sol');
});
test('shipped catalog agrees with runtime exact model evidence', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/provider-catalog.json')));
  assert.equal(catalog.reviewedAt, '2026-10-25');
  assert.deepEqual(Object.keys(catalog.models).sort(), [...reviewedModels].sort());
  assert.deepEqual(catalog.models, Identity.catalog);
  assert.ok(Object.isFrozen(Identity.catalog));
  for (const model of reviewedModels) {
    const result = Identity.resolveProvider(reported({ model })), entry = catalog.models[model];
    assert.equal(result.kind, 'brand', model);
    assert.equal(result.source, 'reported-model+reviewed-catalog');
    assert.equal(result.evidenceUrl, `https://developers.openai.com/api/docs/models/${model}`);
    assert.equal(result.evidenceId, `openai-api-model-${model}-reviewed-${model === 'gpt-6.1-sol' ? '2026-10-24' : '2026-10-25'}`);
    for (const key of Object.keys(entry)) assert.equal(result[key], entry[key]);
    assert.ok(Object.isFrozen(Identity.catalog[model]));
  }
});
test('all reviewed models preserve source and contradictory-company rejection', () => {
  for (const model of reviewedModels) {
    for (const source of ['configured', 'manual', 'unknown', 'demo']) {
      assert.equal(Identity.resolveProvider({ model, sources: { model: source } }).kind, 'generic', model + ':' + source);
    }
    for (const extra of [
      { provenance: { model: 'configured' } },
      { company: 'Other Provider', sources: { model: 'reported', company: 'reported' } },
      { company: 'OpenAI', sources: { model: 'reported', company: 'unknown' } },
      { company: '如律', sources: { model: 'reported', company: 'unknown' } },
    ]) assert.equal(Identity.resolveProvider(reported({ model, ...extra })).kind, 'generic', model);
    assert.equal(Identity.resolveProvider(reported({ model, company: 'OpenAI', sources: { model: 'reported', company: 'configured' } })).kind, 'brand');
    assert.equal(Identity.resolveProvider({ model, sources: { model: 'demo' } }, { allowDemo: true }).source, 'demo-preview');
    for (const alias of [model + '-custom', model.toUpperCase(), ' ' + model]) {
      assert.equal(Identity.resolveProvider(reported({ model: alias })).kind, 'generic', alias);
    }
  }
});
