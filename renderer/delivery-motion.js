/* Explicit target geometry only. This module never discovers a desktop Pet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualDelivery = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = v => Math.max(0, Math.min(1, v));
  const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const rectValid = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && Math.abs(r[k]) < 1e6) && r.width > 0 && r.height > 0;
  function validateTarget(t, options = {}) {
    const now = options.nowMs;
    return !!(t && typeof t.targetId === 'string' && t.targetId.trim() && t.targetId.length <= 256
      && Number.isSafeInteger(t.revision) && t.revision >= 0 && rectValid(t.rect)
      && t.coordinateSpace === 'overlay-local-dip' && t.valid === true && t.visible === true
      && (t.source === 'supported-host-adapter' || (t.source === 'preview-example' && options.allowPreviewTarget === true))
      && Number.isFinite(now) && Number.isFinite(t.observedAtMonotonicMs) && Number.isFinite(t.expiresAtMonotonicMs)
      && t.observedAtMonotonicMs <= now && now < t.expiresAtMonotonicMs);
  }
  function union(rects) {
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    const right = Math.max(...rects.map(r => r.x + r.width)), bottom = Math.max(...rects.map(r => r.y + r.height));
    return freeze({ x: Math.floor(x), y: Math.floor(y), width: Math.ceil(right) - Math.floor(x), height: Math.ceil(bottom) - Math.floor(y) });
  }
  function createPlan(geometry, t, options = {}) {
    if (!validateTarget(t, options) || !rectValid(geometry?.targetRect) || !rectValid(geometry?.originRect)) return null;
    const r = geometry.targetRect;
    if (Math.abs(r.width / r.height - 360 / 760) > .001) return null;
    const paperWidth = r.width * 264 / 360, paperHeight = r.height * 710 / 760;
    if (paperWidth < 6 || paperHeight < 6) return null;
    const source = { x: r.x + r.width / 2, y: r.y + r.height * 375 / 760 - paperHeight / 3 };
    const target = { targetId: t.targetId, revision: t.revision, rect: { ...t.rect }, coordinateSpace: t.coordinateSpace, source: t.source,
      valid: true, visible: true, observedAtMonotonicMs: t.observedAtMonotonicMs, expiresAtMonotonicMs: t.expiresAtMonotonicMs };
    const arrivalScale = Math.max(.22, Math.min(.56, target.rect.width * .7 / paperWidth));
    const arrival = { x: target.rect.x + target.rect.width * .5, y: target.rect.y + target.rect.height * .43 };
    const gap = Math.max(24, Math.min(48, target.rect.height * .28 + paperHeight * arrivalScale / 36));
    const staging = { x: arrival.x, y: target.rect.y - gap - paperHeight * arrivalScale / 6 };
    const distance = Math.hypot(staging.x - source.x, staging.y - source.y);
    const control = { x: (source.x + staging.x) / 2, y: (source.y + staging.y) / 2 - Math.min(110, distance * .16) };
    const flightMs = Math.round(Math.max(680, Math.min(1000, 620 + distance * .42)));
    const flightAtMs = 650, foldEndMs = 740, flightEndMs = flightAtMs + flightMs;
    const intakeAtMs = flightEndMs + 80, durationMs = intakeAtMs + 390;
    const margin = Math.max(paperWidth, paperHeight / 3) * .72 + 24;
    const paperRect = { x: r.x + r.width * 48 / 360, y: r.y + r.height * 20 / 760, width: paperWidth, height: paperHeight };
    const pointRects = [source, control, staging, arrival].map(p => ({ x: p.x - margin, y: p.y - margin, width: margin * 2, height: margin * 2 }));
    return freeze({ version: 1, source, target, staging, control, arrival, distance, paperWidth, paperHeight, arrivalScale,
      foldEndMs, flightAtMs, flightMs, flightEndMs, intakeAtMs, durationMs, bounds: union([paperRect, ...pointRects, target.rect]) });
  }
  function targetStillValid(plan, t, options = {}) {
    if (!plan || !validateTarget(t, options) || t.targetId !== plan.target.targetId || t.source !== plan.target.source
      || t.revision < plan.target.revision || t.observedAtMonotonicMs < plan.target.observedAtMonotonicMs) return false;
    const tolerance = Number.isFinite(options.movementToleranceDIP) ? Math.max(0, options.movementToleranceDIP) : 8;
    return ['x', 'y', 'width', 'height'].every(k => Math.abs(t.rect[k] - plan.target.rect[k]) <= tolerance);
  }
  function sample(plan, elapsedMs) {
    if (!plan) return null;
    const ms = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : plan.durationMs);
    const foldBottom = smooth(ms / 480), foldMiddle = smooth((ms - 260) / 480);
    const travel = smooth((ms - plan.flightAtMs) / plan.flightMs);
    const intake = clamp((ms - plan.intakeAtMs) / 390), accelerate = intake ** 4;
    const phase = ms >= plan.durationMs ? 'hidden' : ms < plan.flightAtMs ? 'folding' : ms < plan.intakeAtMs ? 'flying' : 'intake';
    const q = 1 - travel;
    const lift = 14 * smooth((ms - 590) / 150) * (1 - travel);
    let x = q * q * plan.source.x + 2 * q * travel * plan.control.x + travel * travel * plan.staging.x;
    let y = q * q * plan.source.y + 2 * q * travel * plan.control.y + travel * travel * plan.staging.y - lift;
    const turn = smooth((ms - plan.flightEndMs + 100) / 180);
    const direction = Math.sign(plan.staging.x - plan.source.x) || 1;
    let rotationZ = direction * (.115 * Math.sin(Math.PI * travel) + .38 * travel) * (1 - turn);
    const scale = 1 + (plan.arrivalScale - 1) * smooth((travel - .52) / .48);
    const scaleX = 1 - .22 * smooth(intake), scaleY = 1 + .09 * Math.sin(Math.PI * intake);
    if (ms >= plan.intakeAtMs) {
      x = plan.staging.x; rotationZ = 0;
      // The tail crosses the fixed acceptance plane at full velocity. There
      // is no end-of-path ease-out and opacity does not do the disappearance.
      const halfHeight = plan.paperHeight / 6 * plan.arrivalScale;
      const endY = plan.arrival.y + halfHeight + Math.max(24, halfHeight * 1.15);
      y = plan.staging.y + (endY - plan.staging.y) * accelerate;
    }
    const half = plan.paperHeight / 6 * scale * scaleY;
    return freeze({ phase, elapsedMs: ms, foldBottom, foldMiddle, travel, intake, position: { x, y }, rotationZ, scale, scaleX, scaleY,
      opacity: ms >= plan.durationMs ? 0 : 1, clip: { enabled: ms >= plan.intakeAtMs, point: { ...plan.arrival }, normal: { x: 0, y: -1 } },
      leadingPoint: { x, y: y + half }, trailingPoint: { x, y: y - half } });
  }
  function canvasBounds(plan, baseBounds) { return plan ? union([plan.bounds, ...(rectValid(baseBounds) ? [baseBounds] : [])]) : baseBounds || null; }
  return Object.freeze({ validateTarget, createPlan, targetStillValid, sample, canvasBounds });
});
