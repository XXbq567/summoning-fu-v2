/* Generation-local asynchronous engine ownership. No browser or animation loop. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualPaperlabSession = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const errors = new Set(['engine-unavailable', 'texture-failed', 'webgl-unavailable', 'context-lost', 'render-failed', 'disposed']);
  function createSession(prepare, initial = {}) {
    let engine = null, disposed = false, latest = null, error = null;
    const state = { engine: 'paperlab', libraryVersion: '0.8.1', effectiveReducedMotion: false,
      materialReady: false, canvasVisible: false, actualDrawCount: 0, phase: 'hidden', writing: 0, burn: 0,
      presenceRemaining: null, damageVersion: 0, metadataHash: null, textureHash: null, textureRasterizations: 0, ...initial };
    const session = {
      render(frame) {
        if (disposed) return;
        latest = frame;
        if (engine && !error) {
          try { engine.render(frame); } catch (failure) { error = errors.has(failure.code) ? failure.code : 'render-failed'; engine.hide?.(); }
        }
      },
      getState() { return Object.freeze({ ...state, ...(engine ? engine.getState() : {}), ...(latest ? { phase: latest.phase, writing: latest.writing || 0, burn: latest.burn || 0 } : {}), error: disposed ? 'disposed' : error || engine?.getState().error || null, ...(disposed ? { materialReady: false, canvasVisible: false } : {}) }); },
      dispose() { if (disposed) return; disposed = true; latest = null; engine?.dispose(); engine = null; },
    };
    session.ready = Promise.resolve().then(prepare).then(value => {
      if (disposed) { value.dispose(); throw Object.assign(new Error('disposed'), { code: 'disposed' }); }
      engine = value;
      if (latest) session.render(latest);
      if (error) throw Object.assign(new Error(error), { code: error });
      return session;
    }).catch(failure => { error = errors.has(failure.code) ? failure.code : 'render-failed'; throw failure; });
    // Consumers may wait until a native host has received its preparing token.
    session.ready.catch(() => {});
    return session;
  }
  return Object.freeze({ createSession });
});
