'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const Identity = require('../renderer/provider-identity.js');
const Assets = require('../renderer/provider-assets.js');
const brand = () => Identity.resolveProvider({ model: 'gpt-6.1-sol', sources: { model: 'reported' } });
test('reviewed gpt-5.6-luna identity selects the existing official OpenAI asset', () => {
  const identity = { providerId: 'openai', kind: 'brand', assetId: 'openai-blossom', label: 'OpenAI',
    model: 'gpt-5.6-luna', evidenceId: 'openai-api-model-gpt-5.6-luna-reviewed-2026-10-25',
    evidenceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', source: 'reported-model+reviewed-catalog' };
  assert.equal(Assets.getMark(identity).assetId, 'openai-blossom');
});
test('official SVG bytes, source record and offline data URL are identical', () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/providers/SOURCE.json')));
  const original = fs.readFileSync(path.join(__dirname, '../assets/providers/openai-black-monoblossom.svg'), 'utf8');
  const mark = Assets.getMark(brand());
  assert.equal(mark.svg, original);
  assert.equal(decodeURIComponent(mark.dataUrl.slice('data:image/svg+xml;charset=utf-8,'.length)), original);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), source.assetSha256);
  assert.equal(mark.viewBox, '0 0 721 721'); assert.equal(mark.sourceUrl, source.sourceUrl);
  assert.ok(Object.isFrozen(mark)); assert.ok(Object.isFrozen(mark.paths));
  assert.equal(mark.paths.length, 1); assert.equal(mark.paths[0].fill, 'black');
});
test('unknown, forged resource ID, user SVG and incomplete brand claims remain original generic', () => {
  for (const value of [null, {}, { ...brand(), assetId: 'https://evil.invalid/logo.svg' },
    { assetId: 'openai-blossom', providerId: 'openai', kind: 'brand' },
    { ...brand(), evidenceUrl: 'https://evil.invalid/' },
    { assetId: 'generic', svg: '<script>throw 1</script>' }]) {
    const mark = Assets.getMark(value); assert.equal(mark.assetId, 'generic');
    assert.equal(mark.providerId, null); assert.doesNotMatch(mark.svg, /evil|script/i);
  }
});
test('only trusted static vector attributes are shipped; no scripting or runtime remote assets', () => {
  for (const identity of [brand(), null]) {
    const mark = Assets.getMark(identity);
    assert.doesNotMatch(mark.svg, /<script|<foreignObject|<image|\bon[a-z]+\s*=|(?:href|src)\s*=|<!ENTITY|<!DOCTYPE/i);
    for (const item of mark.paths) {
      assert.deepEqual(Object.keys(item).sort(), ['d', 'fill']);
      assert.match(item.d, /^[\d\s.,\-MmLlHhVvCcSsQqTtAaZz]+$/);
    }
  }
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/provider-identity.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/provider-assets.js'), 'utf8'), context);
  for (const model of Object.keys(Identity.catalog)) {
    const result = context.RitualProviderIdentity.resolveProvider({ model, sources: { model: 'reported' } });
    assert.equal(context.RitualProviderAssets.getMark(result).assetId, 'openai-blossom', model);
  }
});
test('assets use the exact shared catalog entry and reject cross-model evidence', () => {
  for (const model of Object.keys(Identity.catalog)) {
    const identity = Identity.resolveProvider({ model, sources: { model: 'reported' } });
    assert.equal(Assets.getMark(identity).assetId, 'openai-blossom', model);
    const other = model === 'gpt-6.1-sol' ? 'gpt-5.6-luna' : 'gpt-6.1-sol';
    const foreign = Identity.catalog[other];
    for (const forged of [
      { ...identity, evidenceId: foreign.evidenceId },
      { ...identity, evidenceUrl: foreign.evidenceUrl },
      { ...identity, model: model + '-custom' },
      { ...identity, providerId: 'other' },
      { ...identity, label: 'Relay' },
      { ...identity, source: 'configured' },
      { ...identity, assetId: 'https://evil.invalid/logo.svg' },
    ]) assert.equal(Assets.getMark(forged).assetId, 'generic', model);
  }
});
test('browser assets fail closed without identity catalog, then use that shared catalog', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/provider-assets.js'), 'utf8'), context);
  assert.equal(context.RitualProviderAssets.getMark(brand()).assetId, 'generic');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/provider-identity.js'), 'utf8'), context);
  const identity = context.RitualProviderIdentity.resolveProvider({ model: 'gpt-5.6-luna', sources: { model: 'reported' } });
  assert.equal(context.RitualProviderAssets.getMark(identity).assetId, 'openai-blossom');
});
