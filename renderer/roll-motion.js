/* Stage-one timing: Paperlab owns the actual curved sheet and its original UVs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualRollMotion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const durationMs = 850;
  const sheet = Object.freeze({ width: 1, height: 710 / 264, thickness: .001, segments: 'auto', cornerRadius: 0 });
  const behavior = Object.freeze({ type: 'unroll', progress: 1, from: 'bottom', fixed: false, tail: 0, sway: 0, tightness: .85, core: .025 });
  const layerThickness = .1 - behavior.tightness * .08;
  const radiusForLength = length => Math.sqrt(behavior.core ** 2 + Math.max(0, length) * layerThickness / Math.PI);
  const fullRadius = radiusForLength(sheet.height), sweepLength = sheet.height + 2 * fullRadius;
  const flatProgress = sheet.height / sweepLength;
  const smooth = x => x * x * (3 - 2 * x);
  function frameAt(elapsedMs) {
    if (!Number.isFinite(elapsedMs)) throw new TypeError('Use finite elapsed milliseconds');
    const elapsed = Math.max(0, Math.min(durationMs, elapsedMs));
    const rolledFraction = smooth(elapsed / durationMs), woundLength = rolledFraction * sheet.height;
    return Object.freeze({ elapsedMs: elapsed, phase: elapsed === 0 ? 'flat' : elapsed === durationMs ? 'rolled' : 'rolling',
      progress: (sheet.height - woundLength) / sweepLength, rolledFraction, woundLength, radius: radiusForLength(woundLength),
      needsAnimation: elapsed < durationMs });
  }
  function elapsedForFraction(fraction) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new TypeError('Use a finite wound fraction within 0..1');
    if (fraction === 0 || fraction === 1) return fraction * durationMs;
    let low = 0, high = 1;
    for (let i = 0; i < 48; i++) { const middle = (low + high) / 2; if (smooth(middle) < fraction) low = middle; else high = middle; }
    return (low + high) / 2 * durationMs;
  }
  const chapters = Object.freeze([['start', .03], ['half', .5], ['closing', .94], ['rolled', 1]]
    .map(([id, rolledFraction]) => Object.freeze({ id, rolledFraction, elapsedMs: elapsedForFraction(rolledFraction) })));
  const chapterElapsed = id => chapters.find(chapter => chapter.id === id)?.elapsedMs ?? null;
  function createGenerationGate() {
    let generation = -1, closed = false, disposed = false;
    return Object.freeze({
      accept(frame) {
        const incoming = frame?.generation;
        if (disposed || !Number.isSafeInteger(incoming) || incoming < 0 || incoming < generation) return null;
        const changed = incoming > generation;
        if (changed) { generation = incoming; closed = false; }
        if (closed) return null;
        const visible = frame.visible === true;
        if (!visible) closed = true;
        return Object.freeze({ generation, changed, visible });
      },
      dispose() { disposed = true; closed = true; },
    });
  }
  function createPreviewSession(prepare, createSession, initial = {}) {
    const gate = createGenerationGate(), session = createSession(prepare, initial);
    let disposed = false;
    const view = {
      render(frame) {
        if (frame?.visible === true && !Number.isFinite(frame.elapsedMs)) return false;
        const ownership = gate.accept(frame);
        if (!ownership) return false;
        const sample = frameAt(Number.isFinite(frame.elapsedMs) ? frame.elapsedMs : 0);
        session.render({ ...sample, ...ownership, phase: ownership.visible ? sample.phase : 'hidden' });
        return true;
      },
      getState() {
        const state = session.getState();
        return Object.freeze({ ...state, ...((disposed || state.error) ? { phase: 'hidden', canvasVisible: false } : {}) });
      },
      dispose() { if (disposed) return; disposed = true; gate.dispose(); session.dispose(); },
    };
    view.ready = session.ready.then(() => view); view.ready.catch(() => {});
    return view;
  }
  return Object.freeze({ durationMs, sheet, behavior, layerThickness, flatProgress, chapters, frameAt, elapsedForFraction, chapterElapsed, createGenerationGate, createPreviewSession });
});
