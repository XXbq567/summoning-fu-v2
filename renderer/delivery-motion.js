/* Explicit target geometry only. This module never discovers a desktop Pet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./roll-motion.js'));
  else root.RitualDelivery = factory(null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RollMotion) {
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
    if (!validateTarget(t, options)) return null;
    return buildPlan(geometry, t);
  }
  function validateLocalSeal(t) {
    return !!(t && t.source === 'local-generated-seal' && t.coordinateSpace === 'overlay-local-dip'
      && typeof t.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(t.runId)
      && Number.isSafeInteger(t.generation) && t.generation > 0 && Number.isSafeInteger(t.layoutVersion) && t.layoutVersion >= 0
      && rectValid(t.rect) && t.rect.width >= 16 && t.rect.height >= 16
      && t.acceptancePoint && Number.isFinite(t.acceptancePoint.x) && Number.isFinite(t.acceptancePoint.y)
      && Math.abs(t.acceptancePoint.x - t.rect.x - t.rect.width / 2) < .01
      && Math.abs(t.acceptancePoint.y - t.rect.y - t.rect.height / 2) < .01);
  }
  function createLocalSealPlan(geometry, seal) {
    if (!validateLocalSeal(seal)) return null;
    const target = { source: seal.source, coordinateSpace: seal.coordinateSpace, runId: seal.runId, generation: seal.generation,
      layoutVersion: seal.layoutVersion, rect: { ...seal.rect }, acceptancePoint: { ...seal.acceptancePoint },
      targetId: `local-seal:${seal.runId}:${seal.generation}`, revision: seal.layoutVersion };
    return buildPlan(geometry, target);
  }
  function localSealStillValid(plan, seal) {
    if (plan?.destination !== 'local-generated-seal' || !validateLocalSeal(seal)) return false;
    const t = plan.target;
    return ['source', 'coordinateSpace', 'runId', 'generation', 'layoutVersion'].every(k => seal[k] === t[k])
      && ['x', 'y', 'width', 'height'].every(k => seal.rect[k] === t.rect[k])
      && ['x', 'y'].every(k => seal.acceptancePoint[k] === t.acceptancePoint[k]);
  }
  function buildPlan(geometry, t) {
    if (!rectValid(geometry?.targetRect) || !rectValid(geometry?.originRect)) return null;
    const r = geometry.targetRect;
    if (Math.abs(r.width / r.height - 360 / 760) > .001) return null;
    const paperWidth = r.width * 264 / 360, paperHeight = r.height * 710 / 760;
    if (paperWidth < 6 || paperHeight < 6) return null;
    const paperCenter = { x: r.x + r.width / 2, y: r.y + r.height * 375 / 760 };
    // This nominal paper-top source only budgets the host canvas. The drawing
    // plan resolves its own source ONCE from the prepared, actual mesh pivot.
    const source = { x: paperCenter.x, y: paperCenter.y - paperHeight / 2 };
    const local = t.source === 'local-generated-seal';
    const target = local ? { ...t, rect: { ...t.rect }, acceptancePoint: { ...t.acceptancePoint } }
      : { targetId: t.targetId, revision: t.revision, rect: { ...t.rect }, coordinateSpace: t.coordinateSpace, source: t.source,
        valid: true, visible: true, observedAtMonotonicMs: t.observedAtMonotonicMs, expiresAtMonotonicMs: t.expiresAtMonotonicMs };
    const motion = RollMotion || globalThis.RitualPaperlab?.rollMotion;
    if (!motion) return null;
    const radius = motion.frameAt(motion.durationMs).radius;
    const arrivalScale = Math.max(.35, Math.min(.68, target.rect.width * .7 / (paperWidth * 2 * radius)));
    const arrival = local ? { ...target.acceptancePoint } : { x: target.rect.x + target.rect.width * .5, y: target.rect.y + target.rect.height * .43 };
    const gap = Math.max(24, Math.min(48, target.rect.height * .28));
    const staging = { x: arrival.x, y: target.rect.y - gap - paperWidth * arrivalScale / 2 };
    const distance = Math.hypot(staging.x - source.x, staging.y - source.y);
    const liftDIP = 12;
    const control = { x: (source.x + staging.x) / 2, y: (source.y - liftDIP + staging.y) / 2 - Math.min(90, distance * .14) };
    const flightMs = Math.round(distance < 140 ? Math.max(400, distance * 4.5) : Math.max(700, Math.min(1000, 620 + distance * .4)));
    const rollEndMs = motion.durationMs, rotationAtMs = rollEndMs, rotationEndMs = rotationAtMs + 260;
    const flightAtMs = rotationEndMs - 80, flightEndMs = flightAtMs + flightMs;
    const intakeAtMs = flightEndMs + 80, durationMs = intakeAtMs + 300;
    const margin = (Math.hypot(.5, radius) + radius) * paperWidth + 24;
    const paperRect = { x: r.x + r.width * 48 / 360, y: r.y + r.height * 20 / 760, width: paperWidth, height: paperHeight };
    const pointRects = [source, control, staging, arrival].map(p => ({ x: p.x - margin, y: p.y - margin, width: margin * 2, height: margin * 2 }));
    return freeze({ version: 2, mode: 'rolled-paper', destination: local ? 'local-generated-seal' : 'external-target', paperCenter, source, target, staging, control, arrival, distance, paperWidth, paperHeight, arrivalScale, liftDIP,
      rollEndMs, rotationAtMs, rotationEndMs, flightAtMs, flightMs, flightEndMs, intakeAtMs, durationMs, pivotResolved: false, bounds: union([paperRect, ...pointRects, target.rect]) });
  }
  function resolveRollPivot(plan, pivot) {
    if (!plan || plan.mode !== 'rolled-paper' || !pivot || !['x', 'y', 'z'].every(k => Number.isFinite(pivot[k]) && Math.abs(pivot[k]) < 4)) return null;
    if (plan.pivotResolved) return ['x', 'y', 'z'].every(k => plan.rollPivotLocal[k] === pivot[k]) ? plan : null;
    const source = { x: plan.paperCenter.x + pivot.x * plan.paperWidth, y: plan.paperCenter.y - pivot.y * plan.paperWidth };
    const distance = Math.hypot(plan.staging.x - source.x, plan.staging.y - source.y);
    const control = { x: (source.x + plan.staging.x) / 2, y: (source.y - plan.liftDIP + plan.staging.y) / 2 - Math.min(90, distance * .14) };
    return freeze({ ...plan, source, control, pivotResolved: true, rollPivotLocal: { ...pivot } });
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
    const motion = RollMotion || globalThis.RitualPaperlab?.rollMotion;
    if (!motion) return null;
    const roll = motion.frameAt(Math.min(ms, plan.rollEndMs));
    const rotationProgress = smooth((ms - plan.rotationAtMs) / (plan.rotationEndMs - plan.rotationAtMs));
    const travel = smooth((ms - plan.flightAtMs) / plan.flightMs);
    const intake = clamp((ms - plan.intakeAtMs) / 300), accelerate = intake ** 4;
    const phase = ms >= plan.durationMs ? 'hidden' : ms < plan.rollEndMs ? 'rolling' : ms < plan.flightAtMs ? 'rotating'
      : ms < plan.flightEndMs ? 'flying' : ms < plan.intakeAtMs ? 'staging' : 'intake';
    const q = 1 - travel;
    const lift = plan.liftDIP * smooth((ms - plan.rotationAtMs) / 180);
    let x = q * q * plan.source.x + 2 * q * travel * plan.control.x + travel * travel * plan.staging.x;
    let y = q * q * (plan.source.y - lift) + 2 * q * travel * plan.control.y + travel * travel * plan.staging.y;
    const direction = Math.sign(plan.staging.x - plan.source.x) || 1;
    let rotationZ = Math.PI / 2 * rotationProgress + direction * .055 * Math.sin(Math.PI * travel);
    const scale = 1 + (plan.arrivalScale - 1) * smooth((travel - .52) / .48);
    const scaleX = 1 - .1 * smooth(intake), scaleY = 1 + .04 * Math.sin(Math.PI * intake);
    if (ms >= plan.intakeAtMs) {
      x = plan.staging.x; rotationZ = Math.PI / 2;
      // The tail crosses the fixed acceptance plane at full velocity. There
      // is no end-of-path ease-out and opacity does not do the disappearance.
      const halfHeight = plan.paperWidth / 2 * plan.arrivalScale;
      const endY = plan.arrival.y + halfHeight + Math.max(24, halfHeight * 1.15);
      y = plan.staging.y + (endY - plan.staging.y) * accelerate;
    }
    const half = plan.paperWidth / 2 * scale * scaleY * Math.abs(Math.sin(rotationZ));
    return freeze({ phase, elapsedMs: ms, rollElapsedMs: Math.min(ms, plan.rollEndMs), rollProgress: roll.progress, rollFraction: roll.rolledFraction, rollRadius: roll.radius,
      rotationProgress, travel, intake, position: { x, y }, rotationZ, scale, scaleX, scaleY,
      opacity: ms >= plan.durationMs ? 0 : 1, clip: { enabled: ms >= plan.intakeAtMs, point: { ...plan.arrival }, normal: { x: 0, y: -1 } },
      leadingPoint: { x, y: y + half }, trailingPoint: { x, y: y - half } });
  }
  function canvasBounds(plan, baseBounds) { return plan ? union([plan.bounds, ...(rectValid(baseBounds) ? [baseBounds] : [])]) : baseBounds || null; }
  return Object.freeze({ validateTarget, createPlan, validateLocalSeal, createLocalSealPlan, localSealStillValid, resolveRollPivot, targetStillValid, sample, canvasBounds });
});
