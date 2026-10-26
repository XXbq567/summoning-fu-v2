/* Exact, reviewed provider catalog. No host/product/prefix inference or I/O. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualProviderIdentity = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Each exact ID was checked against its official model page. Dates belong
  // to those reviews; a familiar prefix or display alias never adds an entry.
  const reviewed = { 'gpt-6-astra': '2026-10-25', 'gpt-6.1-sol': '2026-10-24',
    'gpt-6-sol': '2026-10-25', 'gpt-6-luna': '2026-10-25', 'gpt-5.6-sol': '2026-10-25',
    'gpt-5.6-terra': '2026-10-25', 'gpt-5.6-luna': '2026-10-25' };
  const catalog = Object.freeze(Object.fromEntries(Object.entries(reviewed).map(([model, date]) => [model, Object.freeze({
    providerId: 'openai', label: 'OpenAI', assetId: 'openai-blossom',
    evidenceId: `openai-api-model-${model}-reviewed-${date}`,
    evidenceUrl: `https://developers.openai.com/api/docs/models/${model}`,
  })])));
  function sourceFor(metadata, field) {
    const a = metadata?.sources?.[field], b = metadata?.provenance?.[field];
    return a && b && a !== b ? 'unknown' : a || b || 'unknown';
  }
  function resolveProvider(metadata, { allowDemo = false } = {}) {
    const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const model = typeof m.model === 'string' && m.model.length <= 96 ? m.model : null;
    const fallback = () => Object.freeze({ providerId: null, kind: 'generic', label: '通用召唤印', assetId: 'generic',
      evidenceId: null, evidenceUrl: null, model, source: 'unknown' });
    const modelSource = sourceFor(m, 'model');
    if (!Object.hasOwn(catalog, model) || !(modelSource === 'reported' || (allowDemo === true && modelSource === 'demo'))) return fallback();
    const entry = catalog[model];
    // A contradictory/non-provenanced company is not silently overwritten by a
    // familiar model ID. Decorative renderer words never establish a provider.
    if (m.company !== null && m.company !== undefined && m.company !== '') {
      const companySource = sourceFor(m, 'company');
      if (m.company !== entry.label || !['reported', 'configured', ...(allowDemo === true ? ['demo'] : [])].includes(companySource)) return fallback();
    }
    return Object.freeze({ ...entry, kind: 'brand', model,
      source: modelSource === 'demo' ? 'demo-preview' : 'reported-model+reviewed-catalog' });
  }
  return Object.freeze({ resolveProvider, catalog });
});
