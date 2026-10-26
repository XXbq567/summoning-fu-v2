/* Own temporary delivery mark. The caller alone owns the presentation clock. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./provider-identity.js'), () => require('./provider-assets.js'));
  else root.RitualProviderSeal = factory(() => root.RitualProviderIdentity, () => root.RitualProviderAssets);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (identityModule, assetsModule) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const original = 'M28 17H72M50 11V32M30 38H70M36 47L50 37L64 47M50 47V75M37 64L50 76L63 64';
  const generic = Object.freeze({ assetId: 'original-generic-seal', providerId: null, kind: 'generic', label: '原创通用召唤印', viewBox: '0 0 100 100',
    dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="${NS}" viewBox="0 0 100 100"><path d="${original}" fill="none" stroke="#a53227" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`) });
  const el = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  function createView(container, metadata, options = {}) {
    // Metadata can select an identity only through the audited catalog. It can
    // never supply a URL, raw SVG, path, image source or arbitrary asset name.
    let identity = Object.freeze({ providerId: null, kind: 'generic', label: generic.label, assetId: generic.assetId, source: 'unknown' }), mark = generic;
    try { identity = identityModule().resolveProvider(metadata || {}, { allowDemo: options.allowDemoProvider === true }); mark = assetsModule().getMark(identity) || generic; } catch {}
    if (!mark || typeof mark.dataUrl !== 'string' || !mark.dataUrl.startsWith('data:image/svg+xml')) mark = generic;
    const svg = el('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', 'data-provider-mark': mark.assetId });
    Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', display: 'none', overflow: 'visible', zIndex: '4' });
    const group = el('g'), backing = el('circle', { cx: 50, cy: 50, r: 46, fill: '#fbf3df', 'fill-opacity': '.94', stroke: '#a53227', 'stroke-opacity': '.16', 'stroke-width': '.6' });
    const ring = el('g', { 'data-provider-ring': 'true', transform: 'rotate(0 50 50)' });
    ring.append(el('circle', { cx: 50, cy: 50, r: 44.5, fill: 'none', stroke: '#a53227', 'stroke-width': '1.1', 'stroke-opacity': '.65', 'stroke-dasharray': '115 6 53 4 90 12' }));
    for (const angle of [0, 90, 180, 270]) ring.append(el('path', { d: 'M50 3V7', transform: `rotate(${angle} 50 50)`, stroke: '#a53227', 'stroke-width': '1.2', 'stroke-opacity': '.6' }));
    const logo = el('g', { 'data-provider-logo': mark.assetId, transform: 'rotate(0 50 50)' });
    const logoImage = el('image', { href: mark.dataUrl, x: 16, y: 16, width: 68, height: 68, preserveAspectRatio: 'xMidYMid meet' });
    logo.append(logoImage);
    group.append(backing, ring, logo); svg.append(group); container.append(svg);
    let dead = false, visible = false, renderCount = 0, maximumGeneration = -1, presented = false, closed = false, phase = 'hidden';
    const pendingDecodes = new Set();
    const decodeMs = Number.isFinite(options.assetDecodeTimeoutMs) ? Math.max(10, Math.min(1200, options.assetDecodeTimeoutMs)) : 1200;
    function decodeImage(dataUrl, milliseconds) {
      return new Promise(resolve => {
        let settled = false, timer;
        const cancel = () => finish(false);
        const finish = ok => { if (settled) return; settled = true; clearTimeout(timer); pendingDecodes.delete(cancel); resolve(ok); };
        pendingDecodes.add(cancel); timer = setTimeout(cancel, milliseconds);
        try { const image = new Image(); image.src = dataUrl; Promise.resolve(image.decode()).then(() => finish(true), () => finish(false)); } catch { finish(false); }
      });
    }
    const ready = (async () => {
      if (typeof Image !== 'function') return;
      if (!await decodeImage(mark.dataUrl, decodeMs) && !dead) {
        mark = generic; logoImage.setAttribute('href', generic.dataUrl); logo.setAttribute('data-provider-logo', generic.assetId); svg.setAttribute('data-provider-mark', generic.assetId);
        // The original fallback is fixed local vector data. A failed decoder
        // cannot hold up this turn or promote a half-loaded brand after show.
        await decodeImage(generic.dataUrl, Math.min(500, decodeMs));
      }
    })();
    function clearVisible() { visible = false; phase = 'hidden'; svg.style.display = 'none'; svg.setAttribute('opacity', '0'); }
    function hide() { if (presented) closed = true; clearVisible(); }
    function render(frame) {
      const state = frame?.seal, token = frame?.generation ?? frame?.token ?? 0;
      if (dead || !Number.isSafeInteger(token) || token < 0 || token < maximumGeneration) return;
      if (token > maximumGeneration) { maximumGeneration = token; presented = false; closed = false; clearVisible(); }
      if (closed) return;
      // Hidden preparation is harmless; after any visible paper frame a full
      // presentation hide closes this generation, including pre-mark stages.
      if (frame?.visible !== true) { hide(); return; }
      presented = true;
      if (!state?.visible || !state.rect || !frame.geometry?.targetRect) { clearVisible(); return; }
      const rect = state.rect, paper = frame.geometry.targetRect;
      if (![rect.x, rect.y, rect.width, rect.height, state.scale, state.opacity, state.ringRotationZ].every(Number.isFinite)) { hide(); return; }
      Object.assign(svg.style, { left: `${rect.x - paper.x}px`, top: `${rect.y - paper.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, display: 'block' });
      svg.setAttribute('opacity', String(state.opacity)); group.setAttribute('transform', `translate(50 50) scale(${state.scale}) translate(-50 -50)`);
      ring.setAttribute('transform', `rotate(${state.ringRotationZ * 180 / Math.PI} 50 50)`);
      // The Logo is not a descendant of the ring and never inherits its angle.
      logo.setAttribute('transform', 'rotate(0 50 50)'); visible = true; phase = state.phase; renderCount++;
    }
    function getState() {
      const bounds = visible ? svg.getBoundingClientRect() : null;
      return Object.freeze({ source: 'local-generated-seal', providerId: mark.providerId || null, providerKind: mark.kind,
        providerAssetId: mark.assetId, providerSource: identity.source || 'unknown', markPhase: phase,
        markVisible: visible && !dead && svg.style.display !== 'none', markRenderCount: renderCount,
        markLogoTransform: logo.getAttribute('transform'), markRingTransform: ring.getAttribute('transform'),
        markGroupTransform: group.getAttribute('transform'), markOpacity: Number(svg.getAttribute('opacity') || 0),
        markBounds: bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        markPointerEvents: svg.style.pointerEvents, markClassification: 'OWN_SVG_DOM_GEOMETRY', markAttached: svg.isConnected });
    }
    return Object.freeze({ ready, render, hide, getState, dispose() { if (dead) return; hide(); dead = true; for (const cancel of [...pendingDecodes]) cancel(); svg.remove(); } });
  }
  return Object.freeze({ createView });
});
