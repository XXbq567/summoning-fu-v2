/* One-shot chat entrance presentation. Expiry is not a task lifecycle event. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualEntrance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const timings = Object.freeze({ paperMs: 650, paperEndMs: 650, writingMs: 2100, writingEndMs: 2750,
    sealEndMs: 3000, holdStartMs: 3000, holdMs: 10000, leaveAtMs: 13000, leaveMs: 1000, totalMs: 14000 });
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  function frameAt(elapsedMs, reduced = false, options = {}) {
    const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : timings.totalMs);
    const hideAtMs = Number.isFinite(options.hideAtMs) ? Math.min(timings.totalMs, Math.max(timings.holdMs, options.hideAtMs)) : reduced ? timings.holdMs : timings.totalMs;
    const visible = elapsed < hideAtMs;
    const holdStartMs = reduced ? hideAtMs - timings.holdMs : timings.holdStartMs;
    const leaveAtMs = reduced ? hideAtMs : timings.leaveAtMs;
    const leaveProgress = reduced ? 0 : clamp((elapsed - leaveAtMs) / timings.leaveMs);
    const leavingEase = smooth(leaveProgress);
    const paperEase = reduced ? 1 : smooth(clamp(elapsed / timings.paperMs));
    const phase = !visible ? 'hidden' : reduced ? 'hold' : elapsed < timings.paperEndMs ? 'paper'
      : elapsed < timings.writingEndMs ? 'writing' : elapsed < timings.sealEndMs ? 'seal' : elapsed < leaveAtMs ? 'hold' : 'leaving';
    return Object.freeze({
      kind: 'entrance', elapsedMs: elapsed, visible, burn: 0, reducedMotion: reduced, hideAtMs, holdStartMs, leaveAtMs,
      phase, leaveProgress, needsAnimation: visible && !reduced && phase !== 'hold',
      paperOpacity: paperEase,
      writing: reduced ? 1 : clamp((elapsed - timings.paperEndMs) / timings.writingMs),
      opacity: !visible ? 0 : reduced ? 1 : 1 - leavingEase,
      scaleX: reduced ? 1 : 1 - leavingEase * .02,
      scaleY: reduced ? 1 : 1 - leavingEase * .02,
      translateY: reduced ? 0 : (1 - paperEase) * 8 + leavingEase * 8,
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
        const fullAt = Math.min(timings.sealEndMs, elapsed);
        current.hideAtMs = Math.min(current.hideAtMs, fullAt + timings.holdMs);
      }
      const frame = frameAt(elapsed, current ? current.reducedMotion : reduced, current || {});
      if (current && !frame.visible) current.expired = true;
      return Object.freeze({ ...frame, id: current ? current.id : null, token: current ? current.token : null, metadata: current ? current.metadata : null });
    }
  }
  return Object.freeze({ frameAt, EntranceTimeline, timings });
});
