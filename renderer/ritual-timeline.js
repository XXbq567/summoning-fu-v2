(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RitualTimeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const variants = Object.freeze(['bottom-up', 'top-down', 'spots', 'whole']);
  const states = new Set(['idle', 'working', 'waiting', 'completed', 'error', 'cancelled', 'unknown']);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }
  function hash(text) {
    let result = 2166136261;
    for (const char of String(text)) { result ^= char.codePointAt(0); result = Math.imul(result, 16777619); }
    return result >>> 0;
  }
  function frameAt(activeMs, options = {}) {
    const duration = clamp(Number(options.cycleMs) || 30000, 10000, 120000);
    const active = Math.max(0, Number(activeMs) || 0);
    const sheetIndex = Math.floor(active / duration);
    const cycle = (active % duration) / duration;
    const variant = variants.includes(options.variant) ? options.variant : variants[(hash(options.seed || 'summoning-fu') + sheetIndex) % variants.length];
    const writing = clamp(cycle / 0.08, 0, 1);
    const burn = clamp((cycle - 0.10) / 0.86, 0, 1);
    return Object.freeze({ activeMs: active, cycleMs: duration, sheetIndex, sheetNumber: sheetIndex + 1, cycle,
      writing, burn, phase: cycle < 0.08 ? 'writing' : cycle < 0.10 ? 'seal' : cycle < 0.96 ? 'burning' : 'renewal',
      variant, seed: hash(String(options.seed || 'summoning-fu') + ':' + sheetIndex),
      opacity: cycle < 0.02 ? cycle / 0.02 : cycle > 0.985 ? (1 - cycle) / 0.015 : 1 });
  }
  class Session {
    constructor(options = {}) {
      this.options = { cycleMs: 30000, variant: 'auto', ...options };
      this.state = 'idle'; this.runId = null; this.metadata = null; this.source = 'manual-preview';
      this.activeMs = 0; this.lastTick = null; this.lastEventAt = -Infinity; this.terminal = false;
      this.sessionId = null; this.seenRuns = new Set();
    }
    tick(now) {
      if (!Number.isFinite(now)) throw new TypeError('Use a finite monotonic time in milliseconds.');
      if (this.lastTick !== null && now < this.lastTick) return;
      if (this.state === 'working' && this.lastTick !== null) this.activeMs += now - this.lastTick;
      this.lastTick = now;
    }
    dispatch(event, now) {
      if (!event || typeof event !== 'object' || !Number.isFinite(now)) return false;
      if (now < this.lastEventAt || (this.lastTick !== null && now < this.lastTick)) return false;
      const incomingId = typeof event.runId === 'string' ? event.runId.trim().slice(0, 160) : '';
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId.trim().slice(0, 160) : 'visual-preview';
      if (!sessionId || (this.sessionId !== null && sessionId !== this.sessionId)) return false;
      if (event.type === 'start') {
        if (!incomingId) return false;
        if (this.seenRuns.has(incomingId)) { this.tick(now); return false; }
        this.sessionId = sessionId;
        this.seenRuns.add(incomingId);
        if (this.seenRuns.size > 256) this.seenRuns.delete(this.seenRuns.values().next().value);
        this.runId = incomingId;
        this.metadata = deepFreeze(JSON.parse(JSON.stringify(event.metadata || {})));
        this.source = typeof event.source === 'string' ? event.source : 'unknown';
        this.state = 'working'; this.activeMs = 0; this.lastTick = now; this.lastEventAt = now; this.terminal = false;
        return true;
      }
      if (!this.runId || incomingId !== this.runId || this.terminal) return false;
      this.tick(now);
      const next = states.has(event.type) ? event.type : 'unknown';
      this.state = next; this.lastEventAt = now;
      this.terminal = ['completed', 'error', 'cancelled'].includes(next);
      return true;
    }
    snapshot(now) {
      this.tick(now);
      return { ...frameAt(this.activeMs, { ...this.options, seed: this.runId || 'summoning-fu' }),
        state: this.state, sessionId: this.sessionId, runId: this.runId, metadata: this.metadata, source: this.source };
    }
  }
  return { variants, frameAt, Session, hash };
});
