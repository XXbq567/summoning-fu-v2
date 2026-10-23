/* One-shot chat entrance presentation. Expiry is not a task lifecycle event. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualEntrance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const timings = Object.freeze({ pointEndMs: 120, travelEndMs: 850, paperEndMs: 1950,
    writingMs: 2200, writingEndMs: 4150, holdStartMs: 4150, holdMs: 5000,
    leaveAtMs: 9150, burnAtMs: 9150, burnMs: 3000, burnEndMs: 12150, ashMs: 350, totalMs: 12500 });
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  function frameAt(elapsedMs, reduced = false, options = {}) {
    const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : timings.totalMs);
    const hideAtMs = Number.isFinite(options.hideAtMs) ? Math.min(timings.totalMs, Math.max(timings.holdMs, options.hideAtMs)) : reduced ? timings.holdMs : timings.totalMs;
    const visible = elapsed < hideAtMs;
    const holdStartMs = reduced ? hideAtMs - timings.holdMs : timings.holdStartMs;
    const leaveAtMs = reduced ? hideAtMs : timings.leaveAtMs;
    const travel = clamp((elapsed - timings.pointEndMs) / (timings.travelEndMs - timings.pointEndMs));
    const unfold = clamp((elapsed - timings.travelEndMs) / (timings.paperEndMs - timings.travelEndMs));
    const progress = Object.freeze(reduced ? { travel: 1, stretchX: 1, stretchY: 1 } : {
      travel: smooth(travel),
      stretchX: elapsed < timings.travelEndMs ? .22 * smooth(clamp((travel - .3) / .7)) : .22 + .78 * smooth(unfold),
      stretchY: elapsed < timings.pointEndMs ? .02 * smooth(elapsed / timings.pointEndMs) : .02 + .98 * smooth(travel),
    });
    const phase = !visible ? 'hidden' : reduced ? 'hold' : elapsed < timings.pointEndMs ? 'point'
      : elapsed < timings.travelEndMs ? 'travel' : elapsed < timings.paperEndMs ? 'unfold'
      : elapsed < timings.writingEndMs ? 'writing' : elapsed < leaveAtMs ? 'hold'
      : elapsed < timings.burnEndMs ? 'burning' : 'ash';
    const burn = reduced ? 0 : clamp((elapsed - timings.burnAtMs) / timings.burnMs);
    return Object.freeze({
      kind: 'entrance', elapsedMs: elapsed, visible, burn, reducedMotion: reduced, hideAtMs, holdStartMs, leaveAtMs,
      phase, progress, visualFireActive: visible && phase === 'burning',
      needsAnimation: visible && !reduced && phase !== 'hold',
      paperOpacity: visible && (reduced || elapsed < timings.burnEndMs) ? 1 : 0,
      writing: reduced ? 1 : clamp((elapsed - timings.paperEndMs) / timings.writingMs),
      opacity: visible && (reduced || elapsed < timings.burnEndMs) ? 1 : 0,
      ashOpacity: phase === 'burning' ? 1 : phase === 'ash' ? 1 - smooth(clamp((elapsed - timings.burnEndMs) / timings.ashMs)) : 0,
    });
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  class EntranceTimeline {
    constructor() { this.generation = 0; this.current = null; this.lastNow = -Infinity; }
    trigger(id, now, metadata = {}) {
      if (typeof id !== 'string' || !id.trim() || id.length > 256 || !Number.isFinite(now)) throw new TypeError('Entrance requires a bounded chat identity and finite monotonic time');
      if (now < this.lastNow) return null;
      const snapshot = freeze(JSON.parse(JSON.stringify(metadata)));
      const token = ++this.generation;
      this.lastNow = now;
      this.current = { id, token, startedAt: now, metadata: snapshot, cancelled: false, reducedMotion: false, hideAtMs: timings.totalMs, expired: false };
      return token;
    }
    cancel(token) {
      if (!this.current || token !== this.current.token) return false;
      this.current.cancelled = true;
      return true;
    }
    snapshot(now, reduced = false) {
      if (!Number.isFinite(now)) throw new TypeError('Use finite monotonic time for presentation');
      this.lastNow = Math.max(this.lastNow, now);
      const current = this.current;
      const elapsed = !current || current.cancelled || current.expired ? timings.totalMs : this.lastNow - current.startedAt;
      if (current && reduced && !current.reducedMotion) {
        // Once a presentation has become static, retain that preference for this
        // generation. Re-enabling motion cannot erase lettering or extend it.
        current.reducedMotion = true;
        const fullAt = Math.min(timings.holdStartMs, elapsed);
        current.hideAtMs = Math.min(current.hideAtMs, fullAt + timings.holdMs);
      }
      const frame = frameAt(elapsed, current ? current.reducedMotion : reduced, current || {});
      if (current && !frame.visible) current.expired = true;
      return Object.freeze({ ...frame, id: current ? current.id : null, token: current ? current.token : null, metadata: current ? current.metadata : null });
    }
  }
  return Object.freeze({ frameAt, EntranceTimeline, timings });
});
