/* One-shot chat entrance presentation. Expiry is not a task lifecycle event. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./delivery-motion.js'));
  else root.RitualEntrance = factory(root.RitualDelivery);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Delivery) {
  'use strict';
  const timings = Object.freeze({ pointEndMs: 120, travelEndMs: 850, paperEndMs: 1950,
    writingMs: 2200, writingEndMs: 4150, holdStartMs: 4150, holdMs: 2000,
    leaveAtMs: 6150, deliveryAtMs: 6150, deliveryMaxMs: 2600, totalMs: 8750 });
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  function frameAt(elapsedMs, reduced = false, options = {}) {
    const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : timings.totalMs);
    const candidate = options.deliveryPlan;
    const deliveryPlan = candidate
      ? (Delivery?.targetStillValid(candidate, options.deliveryTarget || candidate.target, options) ? candidate : null)
      : Delivery?.createPlan(options.geometry, options.deliveryTarget, options);
    const naturalEnd = deliveryPlan ? timings.leaveAtMs + deliveryPlan.durationMs : timings.leaveAtMs;
    const hideAtMs = Number.isFinite(options.hideAtMs) ? Math.min(naturalEnd, Math.max(timings.holdMs, options.hideAtMs)) : reduced ? timings.holdMs : naturalEnd;
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
    const deliveryState = deliveryPlan && elapsed >= timings.leaveAtMs ? Delivery.sample(deliveryPlan, elapsed - timings.leaveAtMs) : null;
    const phase = !visible ? 'hidden' : reduced ? 'hold' : elapsed < timings.pointEndMs ? 'point'
      : elapsed < timings.travelEndMs ? 'travel' : elapsed < timings.paperEndMs ? 'unfold'
      : elapsed < timings.writingEndMs ? 'writing' : elapsed < leaveAtMs ? 'hold'
      : deliveryState?.phase || 'hidden';
    const burn = 0;
    return Object.freeze({
      kind: 'entrance', elapsedMs: elapsed, visible, burn, reducedMotion: reduced, hideAtMs, holdStartMs, leaveAtMs,
      phase, progress, delivery: deliveryPlan ? Object.freeze({ plan: deliveryPlan, state: deliveryState }) : null, visualFireActive: false,
      needsAnimation: visible && !reduced && phase !== 'hold',
      paperOpacity: visible ? 1 : 0,
      writing: reduced ? 1 : clamp((elapsed - timings.paperEndMs) / timings.writingMs),
      opacity: visible ? 1 : 0,
      ashOpacity: 0,
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
    snapshot(now, reduced = false, options = {}) {
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
      const frame = frameAt(elapsed, current ? current.reducedMotion : reduced, { ...(current || {}), ...options });
      if (current && !frame.visible) current.expired = true;
      return Object.freeze({ ...frame, id: current ? current.id : null, token: current ? current.token : null, metadata: current ? current.metadata : null });
    }
  }
  return Object.freeze({ frameAt, EntranceTimeline, timings });
});
