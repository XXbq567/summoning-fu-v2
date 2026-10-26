'use strict';
const { Session } = require('../renderer/ritual-timeline.js');
const { validateUiObservation, sanitizeObserverDiagnostic } = require('../adapter/ui-send-observation.cjs');
const windowsPath = require('node:path').win32;
const { burnOutsetDIP } = require('../renderer/send-geometry.js');
const Delivery = require('../renderer/delivery-motion.js');
const freezeDeliveryValue = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeliveryValue); Object.freeze(value); } return value; };
class DeliveryTargetBridge {
  constructor() { this.current = null; this.plan = null; this.cancelled = false; this.reason = 'target-unavailable'; this.sourceWatermark = null; }
  beginGeneration() { this.plan = null; this.cancelled = false; this.reason = 'target-unavailable'; }
  invalidate(reason = 'target-unavailable') {
    this.current = null; if (this.plan) this.cancelled = true; this.plan = null;
    this.reason = ['target-unavailable', 'target-expired', 'target-changed', 'geometry-changed'].includes(reason) ? reason : 'target-unavailable';
  }
  receive(raw, { sourceNowMs, receivedAtMs } = {}) {
    // Host adapters call this Node-only boundary; renderer IPC cannot declare a
    // supported source. Foreign clocks are translated through remaining lease.
    if (raw?.source !== 'supported-host-adapter' || raw.coordinateSpace !== 'overlay-local-dip' || !Number.isFinite(sourceNowMs) || !Number.isFinite(receivedAtMs)) return false;
    const prior = this.sourceWatermark;
    if (prior?.targetId === raw.targetId && (raw.revision < prior.revision || raw.observedAtMonotonicMs < prior.observedAtMonotonicMs || sourceNowMs < prior.sourceNowMs)) return false;
    if (!Delivery.validateTarget({ ...raw, valid: true, visible: true }, { nowMs: raw.observedAtMonotonicMs }) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(raw.targetId) || typeof raw.valid !== 'boolean' || typeof raw.visible !== 'boolean' || raw.observedAtMonotonicMs > sourceNowMs) return false;
    this.sourceWatermark = { targetId: raw.targetId, revision: raw.revision, observedAtMonotonicMs: raw.observedAtMonotonicMs, sourceNowMs };
    if (!Delivery.validateTarget(raw, { nowMs: sourceNowMs })) { this.invalidate(); return false; }
    const value = freezeDeliveryValue({ targetId: raw.targetId, revision: raw.revision, rect: { x: raw.rect.x, y: raw.rect.y, width: raw.rect.width, height: raw.rect.height }, coordinateSpace: raw.coordinateSpace, source: raw.source, valid: true, visible: true,
      observedAtMonotonicMs: receivedAtMs - (sourceNowMs - raw.observedAtMonotonicMs), expiresAtMonotonicMs: receivedAtMs + Math.min(30000, raw.expiresAtMonotonicMs - sourceNowMs) });
    if (this.plan && !Delivery.targetStillValid(this.plan, value, { nowMs: receivedAtMs })) { this.cancelled = true; this.plan = null; this.reason = 'target-changed'; }
    this.current = value;
    return true;
  }
  targetAt(nowMs) {
    if (this.cancelled) return null;
    if (this.current && !Delivery.validateTarget(this.current, { nowMs })) this.invalidate('target-expired');
    return this.current;
  }
  freezePlan(geometry, nowMs) {
    const current = this.targetAt(nowMs); if (!current) return null;
    if (!this.plan) this.plan = Delivery.createPlan(geometry, current, { nowMs });
    if (this.plan) this.reason = 'none';
    return this.plan;
  }
}
function rebaseDeliveryLayout(layout, target, { nowMs, workArea, allowPreviewTarget = false } = {}) {
  const plan = Delivery.createPlan(layout?.geometry, target, { nowMs, allowPreviewTarget });
  if (!plan || !layout?.bounds || !workArea || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(workArea[key]))) return null;
  const union = Delivery.canvasBounds(plan, { x: 0, y: 0, width: layout.bounds.width, height: layout.bounds.height });
  const x = Math.floor(layout.bounds.x + union.x), y = Math.floor(layout.bounds.y + union.y);
  const bounds = { x, y, width: Math.ceil(layout.bounds.x + union.x + union.width) - x, height: Math.ceil(layout.bounds.y + union.y + union.height) - y };
  if (bounds.x < workArea.x || bounds.y < workArea.y || bounds.x + bounds.width > workArea.x + workArea.width || bounds.y + bounds.height > workArea.y + workArea.height) return null;
  const dx = layout.bounds.x - x, dy = layout.bounds.y - y;
  const shift = rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy });
  const geometry = { originRect: shift(layout.geometry.originRect), targetRect: shift(layout.geometry.targetRect) };
  const deliveryTarget = { ...target, rect: shift(target.rect) };
  const deliveryPlan = Delivery.createPlan(geometry, deliveryTarget, { nowMs, allowPreviewTarget });
  return deliveryPlan ? freezeDeliveryValue({ bounds, geometry, deliveryTarget, deliveryPlan }) : null;
}
function prepareLocalSealLayout(layout, { runId, generation, layoutVersion = 0, provider, workArea } = {}) {
  if (!layout?.bounds || !layout.geometry?.targetRect || !layout.geometry?.originRect || !workArea || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(workArea[k])) || typeof Delivery.createLocalSealPlan !== 'function') return null;
  const paper = layout.geometry.targetRect, base = layout.bounds;
  for (const scale of [1, .85, .7, .55]) for (const placement of ['below', 'left', 'right']) {
    const targetRect = { x: paper.x + paper.width * (1 - scale) / 2, y: paper.y + paper.height * (1 - scale) / 2, width: paper.width * scale, height: paper.height * scale };
    const size = Math.max(46, Math.min(76, targetRect.width * .24));
    const rect = placement === 'below' ? { x: targetRect.x + (targetRect.width - size) / 2, y: targetRect.y + targetRect.height + 10, width: size, height: size }
      : { x: placement === 'left' ? targetRect.x - size - 24 : targetRect.x + targetRect.width + 24, y: targetRect.y + targetRect.height * .72 - size / 2, width: size, height: size };
    const localSeal = { source: 'local-generated-seal', coordinateSpace: 'overlay-local-dip', runId, generation, layoutVersion, rect, acceptancePoint: { x: rect.x + size / 2, y: rect.y + size / 2 }, provider: JSON.parse(JSON.stringify(provider || {})) };
    const geometry = { originRect: { ...layout.geometry.originRect }, targetRect };
    const plan = Delivery.createLocalSealPlan(geometry, localSeal); if (!plan) continue;
    const union = Delivery.canvasBounds(plan, { x: 0, y: 0, width: base.width, height: base.height });
    const left = Math.min(union.x, rect.x - 8), top = Math.min(union.y, rect.y - 8), right = Math.max(union.x + union.width, rect.x + size + 8), bottom = Math.max(union.y + union.height, rect.y + size + 8);
    const bounds = { x: Math.floor(base.x + left), y: Math.floor(base.y + top), width: Math.ceil(base.x + right) - Math.floor(base.x + left), height: Math.ceil(base.y + bottom) - Math.floor(base.y + top) };
    if (bounds.x < workArea.x || bounds.y < workArea.y || bounds.x + bounds.width > workArea.x + workArea.width || bounds.y + bounds.height > workArea.y + workArea.height) continue;
    const dx = base.x - bounds.x, dy = base.y - bounds.y;
    const shift = r => ({ ...r, x: r.x + dx, y: r.y + dy });
    const shiftedGeometry = { originRect: shift(geometry.originRect), targetRect: shift(targetRect) };
    const shiftedSeal = { ...localSeal, rect: shift(rect), acceptancePoint: { x: localSeal.acceptancePoint.x + dx, y: localSeal.acceptancePoint.y + dy } };
    const deliveryPlan = Delivery.createLocalSealPlan(shiftedGeometry, shiftedSeal); if (!deliveryPlan) continue;
    return freezeDeliveryValue({ bounds, geometry: shiftedGeometry, localSeal: shiftedSeal, deliveryPlan, localLayoutMode: (scale < 1 ? 'compact-' : '') + placement, paperScale: scale });
  }
  return null;
}
class HostClock {
  constructor({ staleMs = 90000 } = {}) { this.session = new Session(); this.staleMs = staleMs; this.lastEvidence = null; }
  accept(events, now) {
    this.expire(now);
    let accepted = false;
    for (const event of events) if (this.session.dispatch(event, now)) accepted = true;
    if (accepted) this.lastEvidence = now;
    return accepted;
  }
  expire(now) {
    if (this.session.state === 'working' && this.lastEvidence !== null && now > this.lastEvidence + this.staleMs) {
      this.suspend(Math.max(this.session.lastTick || 0, this.lastEvidence + this.staleMs));
    }
  }
  suspend(now) {
    if (this.session.runId && !this.session.terminal) this.session.dispatch({ type: 'unknown', runId: this.session.runId, sessionId: this.session.sessionId }, now);
  }
  snapshot(now) { this.expire(now); return this.session.snapshot(now); }
}
function clampBounds(bounds, area) {
  const width = Math.round(Math.max(1, Math.min(Number(bounds.width) || 230, area.width)));
  const height = Math.round(Math.max(1, Math.min(Number(bounds.height) || 480, area.height)));
  return { x: Math.round(Math.max(area.x, Math.min(Number(bounds.x) || 0, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(Number(bounds.y) || 0, area.y + area.height - height))), width, height };
}
function controlBounds(saved, area) {
  const position = saved && typeof saved === 'object' ? saved : { x: area.x + area.width - 274, y: area.y + area.height - 64 };
  // Native outer dimensions can contain DPI-rounded borders. They are never design inputs.
  return clampBounds({ x: position.x, y: position.y, width: 250, height: 44 }, area);
}
function entranceBounds(saved, area) {
  const scale = Math.max(0.001, Math.min(1, (area.height - 32) / 676, (area.width - 32) / 320));
  const width = Math.round(320 * scale), height = Math.round(676 * scale);
  return clampBounds({ width, height, x: saved?.x ?? area.x + area.width - width - 24, y: saved?.y ?? area.y + area.height - height - 24 }, area);
}
function independentPetLayout(saved, area) {
  if (!area || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(area[key])) || !Number.isFinite(burnOutsetDIP) || burnOutsetDIP < 0 || area.width <= burnOutsetDIP * 2 || area.height <= burnOutsetDIP * 2) return null;
  const paper = entranceBounds(saved, area), inset = burnOutsetDIP;
  const scale = Math.min(1, (area.width - inset * 2) / paper.width, (area.height - inset * 2) / paper.height);
  const width = paper.width * scale, height = paper.height * scale;
  if (width * 264 / 360 < 6 || height * 710 / 760 < 6) return null;
  const bounds = clampBounds({ x: paper.x - inset, y: paper.y - inset, width: Math.ceil(width + inset * 2), height: Math.ceil(height + inset * 2) }, area);
  const targetRect = Object.freeze({ x: inset, y: inset, width, height });
  const originRect = Object.freeze({ x: inset + width / 2 - 4, y: inset + height * .88, width: 8, height: 8 });
  return Object.freeze({ bounds: Object.freeze(bounds), geometry: Object.freeze({ originRect, targetRect }) });
}
class EntranceScheduler {
  constructor() { this.generation = 0; this.pending = null; this.seen = new Set(); this.sourceWatermark = -Infinity; this.sourceEvent = null; }
  acceptSource(eventId, startedAtMs) {
    if (!Number.isFinite(startedAtMs) || startedAtMs < this.sourceWatermark || (startedAtMs === this.sourceWatermark && eventId !== this.sourceEvent)) return false;
    this.sourceWatermark = startedAtMs; this.sourceEvent = eventId; return true;
  }
  queue(event, now) {
    if (!event || typeof event.eventId !== 'string' || this.seen.has(event.eventId) || !Number.isFinite(now)) return null;
    this.seen.add(event.eventId); if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    const token = ++this.generation; this.pending = { token, event, dueAt: now }; return token;
  }
  isCurrent(token) { return token === this.generation; }
  take(token, now) {
    if (!this.pending || this.pending.token !== token || now < this.pending.dueAt) return null;
    const event = this.pending.event; this.pending = null; return event;
  }
  cancel() { this.generation++; this.pending = null; }
}
function startupIntent(args, hasBinding) {
  const quit = args.includes('--quit'), hidden = quit || args.includes('--hide');
  return { quit, hidden, read: !quit && (args.includes('--read') || (!hasBinding && !hidden)) };
}
function previewQaProfile(args) {
  const flags = Array.isArray(args) ? args : [];
  const count = flags.filter(arg => arg === '--preview-qa-only' || arg === '--paperlab-preview-only').length;
  const interactive = flags.includes('--paperlab-preview-only');
  if (!count) return { valid: true, enabled: false, userData: null };
  const invalid = { valid: false, enabled: true, userData: null };
  if (count !== 1 || flags.some(arg => typeof arg === 'string' && /^(--session-file|--session-id|--entrance-file)(=|$)|^--read$/.test(arg))) return invalid;
  const roots = flags.flatMap((arg, index) => arg === '--user-data-dir' ? [flags[index + 1]] : typeof arg === 'string' && arg.startsWith('--user-data-dir=') ? [arg.slice(16)] : []);
  if (roots.length !== 1 || typeof roots[0] !== 'string') return invalid;
  const directory = roots[0];
  if (directory.length > 4096 || !/^[A-Za-z]:[\\/]/.test(directory) || /[\x00-\x1f]/.test(directory) || directory.slice(2).includes(':') || /[\\/]$/.test(directory) || directory.split(/[\\/]/).some(part => part === '.' || part === '..')) return invalid;
  const leaf = interactive ? /^summoning-fu-preview-local-[a-f0-9]{8,32}$/ : /^summoning-fu-preview-qa-[a-f0-9]{8,32}$/;
  if (!leaf.test(windowsPath.basename(directory))) return invalid;
  return { valid: true, enabled: true, userData: windowsPath.normalize(directory), ...(interactive ? { interactive: true } : {}) };
}
function samePreviewQaProfile(currentArgs, nextArgs) {
  const current = previewQaProfile(currentArgs), next = previewQaProfile(nextArgs);
  return current.valid && next.valid && current.enabled && next.enabled && current.userData.toLowerCase() === next.userData.toLowerCase();
}
async function verifyEntranceUntil({ verify, deadline, now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), isActive = () => true, waitForContext = false }) {
  const transient = new Set(['source-not-ready', 'source-changed', 'latest-turn-mismatch']);
  let contextDeadline = null;
  // No source watermark, queue or visible state changes before positive verification.
  for (let attempt = 0; attempt < 25; attempt++) {
    if (!isActive()) return { verified: false, reason: 'cancelled' };
    const result = await verify();
    if (!isActive()) return { verified: false, reason: 'cancelled' };
    const contextPending = waitForContext && result.verified && result.contextMissing === true;
    if (contextPending && contextDeadline === null) contextDeadline = now() + 750;
    const activeDeadline = contextPending ? contextDeadline : deadline;
    if ((!contextPending && (result.verified || !transient.has(result.reason))) || now() >= activeDeadline || attempt === 24) return result;
    await wait(Math.min(250, Math.max(1, activeDeadline - now())));
  }
}
function entranceMotionPolicy(systemPreference) {
  return { systemReducedMotion: typeof systemPreference === 'boolean' ? systemPreference : null, effectiveReducedMotion: false };
}
function sanitizeRolledDelivery(value, result) {
  const phases = ['none', 'rolling', 'rotating', 'flying', 'staging', 'intake', 'hidden'];
  if (value.deliveryMode !== 'rolled-paper' || !phases.includes(value.deliveryPhase)) return null;
  const active = !['none', 'hidden'].includes(value.deliveryPhase), checked = { deliveryMode: 'rolled-paper', deliveryPhase: value.deliveryPhase };
  const nullable = (input, check) => input == null && !active || check(input);
  for (const key of ['rollProgress', 'rollFraction', 'actualWoundFraction', 'rotationProgress', 'flightProgress', 'intakeProgress']) {
    if (!nullable(value[key], n => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
    checked[key] = value[key] ?? null;
  }
  for (const [key, limit] of [['rollRadius', 100], ['deliveryRotationZ', Math.PI * 4]]) {
    if (!nullable(value[key], n => Number.isFinite(n) && Math.abs(n) <= limit && (key !== 'rollRadius' || n >= 0))) return null;
    checked[key] = value[key] ?? null;
  }
  for (const key of ['deliveryMeshId', 'deliveryGeometryId']) {
    if (!nullable(value[key], id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id))) return null;
    checked[key] = value[key] ?? null;
  }
  for (const key of ['deliveryUvHash', 'deliveryUvInitialHash', 'deliveryGeometryPositionHash']) {
    if (!nullable(value[key], hash => typeof hash === 'string' && /^[a-f0-9]{8}$/.test(hash))) return null;
    checked[key] = value[key] ?? null;
  }
  if (active && value.deliveryUvHash !== value.deliveryUvInitialHash) return null;
  const point = (value, keys = ['x', 'y']) => value && typeof value === 'object' && keys.every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1000000) ? Object.fromEntries(keys.map(key => [key, value[key]])) : null;
  for (const key of ['deliveryPivotLocal', 'deliverySourcePivot', 'deliveryPosition']) {
    const result = point(value[key], key === 'deliveryPivotLocal' ? ['x', 'y', 'z'] : ['x', 'y']);
    if (!result && (active || value[key] != null)) return null; checked[key] = result;
  }
  const leading = point(value.projectedAxis?.leading), trailing = point(value.projectedAxis?.trailing);
  if ((!leading || !trailing) && (active || value.projectedAxis != null)) return null;
  checked.projectedAxis = leading && trailing ? { leading, trailing } : null;
  for (const key of ['deliveryBounds', 'visibleGeometryBounds']) {
    const rect = value[key], origin = point(rect);
    const valid = origin && ['width', 'height'].every(k => Number.isFinite(rect[k]) && rect[k] >= 0 && rect[k] <= 1000000);
    if (!valid && (rect != null || key === 'deliveryBounds' && active)) return null;
    checked[key] = valid ? { ...origin, width: rect.width, height: rect.height } : null;
  }
  if (Object.hasOwn(value, 'deliveryVisibleVertexCount')) {
    const count = value.deliveryVisibleVertexCount;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000 || Number.isSafeInteger(value.vertexCount) && count > value.vertexCount) return null;
    checked.deliveryVisibleVertexCount = count;
  }
  if (Object.hasOwn(value, 'deliveryClipIntersectionCount')) {
    const count = value.deliveryClipIntersectionCount;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) return null;
    checked.deliveryClipIntersectionCount = count;
  }
  if (Object.hasOwn(value, 'visibleGeometryBoundsSource')) {
    if (value.visibleGeometryBoundsSource !== 'cpu-clipped-indexed-triangles') return null;
    checked.visibleGeometryBoundsSource = value.visibleGeometryBoundsSource;
  }
  if (!['deliveryTargetValid', 'deliveryClipped'].every(key => typeof value[key] === 'boolean')) return null;
  if (value.deliveryTargetId != null && (typeof value.deliveryTargetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.deliveryTargetId))) return null;
  if (active && value.deliveryTargetId == null) return null;
  if (!['intakeLeadingY', 'intakeTrailingY', 'intakePlaneY'].every(key => value[key] === null || Number.isFinite(value[key]) && Math.abs(value[key]) <= 1000000)) return null;
  for (const key of ['deliveryTargetId', 'deliveryTargetValid', 'deliveryClipped', 'intakeLeadingY', 'intakeTrailingY', 'intakePlaneY']) checked[key] = value[key] ?? null;
  return { ...result, ...checked };
}
function sanitizePaperlabEvidence(value) {
  if (!value || value.engine !== 'paperlab' || value.libraryVersion !== '0.8.1' || !['materialReady', 'canvasVisible'].every(key => typeof value[key] === 'boolean')) return null;
  if (Object.hasOwn(value, 'effectiveReducedMotion') && value.effectiveReducedMotion !== false) return null;
  if (!['point', 'travel', 'unfold', 'writing', 'hold', 'folding', 'rolling', 'rotating', 'flying', 'staging', 'intake', 'seal-ack', 'seal-exit', 'burning', 'ash', 'hidden'].includes(value.phase)) return null;
  if (!['actualDrawCount', 'damageVersion', 'textureRasterizations'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1000000000)) return null;
  if (!['writing', 'burn'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)) return null;
  if (value.presenceRemaining !== null && (!Number.isFinite(value.presenceRemaining) || value.presenceRemaining < 0 || value.presenceRemaining > 1)) return null;
  if (!['metadataHash', 'textureHash'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{8}$/.test(value[key]))) return null;
  if (value.error !== null && !['engine-unavailable', 'texture-failed', 'webgl-unavailable', 'context-lost', 'render-failed', 'disposed'].includes(value.error)) return null;
  const result = { ...Object.fromEntries(['engine', 'libraryVersion', 'materialReady', 'canvasVisible', 'actualDrawCount', 'phase', 'writing', 'burn', 'presenceRemaining', 'damageVersion', 'metadataHash', 'textureHash', 'textureRasterizations', 'error'].map(key => [key, value[key]])), effectiveReducedMotion: false };
  if (Object.hasOwn(value, 'actualClearCount')) {
    if (!Number.isSafeInteger(value.actualClearCount) || value.actualClearCount < 0 || value.actualClearCount > 1000000000) return null;
    result.actualClearCount = value.actualClearCount;
  }
  if (Object.hasOwn(value, 'deliveryMode')) {
    const rolled = sanitizeRolledDelivery(value, result); if (!rolled) return null; Object.assign(result, rolled);
  } else if (Object.hasOwn(value, 'deliveryPhase')) {
    if (!['none', 'folding', 'flying', 'intake', 'hidden'].includes(value.deliveryPhase)) return null;
    if (!['foldBottom', 'foldMiddle', 'flightProgress', 'intakeProgress'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)) return null;
    if (!['deliveryTargetValid', 'deliveryClipped'].every(key => typeof value[key] === 'boolean')) return null;
    if (value.deliveryTargetId !== null && (typeof value.deliveryTargetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.deliveryTargetId))) return null;
    if (!['intakeLeadingY', 'intakeTrailingY', 'intakePlaneY'].every(key => value[key] === null || (Number.isFinite(value[key]) && Math.abs(value[key]) <= 1000000))) return null;
    for (const key of ['deliveryPhase', 'foldBottom', 'foldMiddle', 'flightProgress', 'intakeProgress', 'deliveryTargetId', 'deliveryTargetValid', 'deliveryClipped', 'intakeLeadingY', 'intakeTrailingY', 'intakePlaneY']) result[key] = value[key];
  }
  if (['flameCount', 'maxFlameHeightDIP', 'colorPipeline'].some(key => Object.hasOwn(value, key))) {
    if (!Number.isSafeInteger(value.flameCount) || value.flameCount < 0 || value.flameCount > 16 || !Number.isFinite(value.maxFlameHeightDIP) || value.maxFlameHeightDIP < 0 || value.maxFlameHeightDIP > 50 || value.colorPipeline !== 'srgb-no-tone-mapping') return null;
    Object.assign(result, { flameCount: value.flameCount, maxFlameHeightDIP: value.maxFlameHeightDIP, colorPipeline: value.colorPipeline });
  }
  if (Object.hasOwn(value, 'backsideInkStrength')) {
    if (!Number.isFinite(value.backsideInkStrength) || value.backsideInkStrength < 0 || value.backsideInkStrength > .2) return null;
    result.backsideInkStrength = value.backsideInkStrength;
  }
  if (Object.hasOwn(value, 'materialAdapter')) {
    if (typeof value.materialAdapter !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.materialAdapter)) return null;
    result.materialAdapter = value.materialAdapter;
  }
  if (Object.hasOwn(value, 'material')) {
    const material = value.material, checked = {};
    if (!material || typeof material !== 'object' || Array.isArray(material)) return null;
    for (const key of ['depthTest', 'depthWrite', 'forceSinglePass']) {
      if (typeof material[key] !== 'boolean') return null; checked[key] = material[key];
    }
    for (const key of ['opacity', 'showThrough', 'alphaTest']) {
      if (!Number.isFinite(material[key]) || material[key] < 0 || material[key] > 1) return null; checked[key] = material[key];
    }
    if (!Number.isSafeInteger(material.side) || material.side < 0 || material.side > 2) return null; checked.side = material.side;
    for (const key of ['frontTextureId', 'backTextureId']) {
      if (material[key] !== null && (typeof material[key] !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(material[key]))) return null; checked[key] = material[key];
    }
    if (Object.hasOwn(material, 'clippingPlanes')) {
      const planes = material.clippingPlanes;
      if (!Array.isArray(planes) || planes.length > 1) return null;
      checked.clippingPlanes = [];
      for (const plane of planes) {
        const normal = plane?.normal;
        if (!Array.isArray(normal) || normal.length !== 3 || !normal.every(n => Number.isFinite(n) && Math.abs(n) <= 1.00001) || Math.abs(Math.hypot(...normal) - 1) > .00001 || !Number.isFinite(plane.constant) || Math.abs(plane.constant) > 1000000) return null;
        checked.clippingPlanes.push({ normal: [...normal], constant: plane.constant });
      }
    }
    result.material = checked;
  }
  if (Object.hasOwn(value, 'markPhase')) {
    if (value.source !== 'local-generated-seal') return null;
    result.source = value.source;
    if (!['appearing', 'receiving', 'acknowledging', 'disappearing', 'hidden'].includes(value.markPhase) || !['brand', 'generic'].includes(value.providerKind) || !['unknown', 'demo-preview', 'reported-model+reviewed-catalog'].includes(value.providerSource)) return null;
    if (value.providerId !== null && (typeof value.providerId !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(value.providerId))) return null;
    if (typeof value.providerAssetId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.providerAssetId) || !Number.isSafeInteger(value.markRenderCount) || value.markRenderCount < 0 || value.markRenderCount > 1000000000 || !Number.isFinite(value.markOpacity) || value.markOpacity < 0 || value.markOpacity > 1) return null;
    if (!['markVisible', 'markAttached'].every(k => typeof value[k] === 'boolean') || value.markClassification !== 'OWN_SVG_DOM_GEOMETRY' || value.markPointerEvents !== 'none') return null;
    for (const key of ['markLogoTransform', 'markRingTransform', 'markGroupTransform']) if (value[key] !== null && (typeof value[key] !== 'string' || value[key].length > 180 || !/^[a-zA-Z0-9.,() +e-]*$/.test(value[key]))) return null;
    const rect = value.markBounds;
    if (rect !== null && (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]) && Math.abs(rect[k]) <= 1000000) || rect.width < 0 || rect.height < 0)) return null;
    for (const key of ['providerId', 'providerKind', 'providerAssetId', 'providerSource', 'markPhase', 'markVisible', 'markRenderCount', 'markLogoTransform', 'markRingTransform', 'markGroupTransform', 'markOpacity', 'markPointerEvents', 'markClassification', 'markAttached']) result[key] = value[key];
    result.markBounds = rect ? Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, rect[k]])) : null;
  }
  return result;
}
function withPaperlabEvidence(value, result) {
  if (!Object.hasOwn(value, 'paperlab')) return result;
  const checked = sanitizePaperlabEvidence(value.paperlab);
  return checked ? { ...result, paperlab: checked } : null;
}
function sanitizeRenderEvidence(value) {
  if (!value || typeof value !== 'object' || typeof value.reducedMotion !== 'boolean' || typeof value.documentHidden !== 'boolean') return null;
  if (typeof value.systemReducedMotion !== 'boolean' || value.effectiveReducedMotion !== false || value.reducedMotion !== value.effectiveReducedMotion) return null;
  if (![value.rafCount, value.renderCount].every(v => Number.isSafeInteger(v) && v >= 0)) return null;
  if (value.runId !== null && (typeof value.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.runId))) return null;
  const f = value.frame;
  if (!f || !Number.isFinite(f.activeMs) || f.activeMs < 0 || f.activeMs > Number.MAX_SAFE_INTEGER || ![f.burn, f.writing].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (!['point', 'travel', 'unfold', 'paper', 'writing', 'seal', 'folding', 'rolling', 'rotating', 'flying', 'staging', 'intake', 'seal-ack', 'seal-exit', 'burning', 'ash', 'renewal', 'hold', 'leaving', 'hidden'].includes(f.phase) || !['idle', 'working', 'waiting', 'completed', 'error', 'cancelled', 'unknown'].includes(f.state)) return null;
  if (![f.paperOpacity, f.opacity].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (![f.visibleGlyphs, f.totalGlyphs].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 100000) || f.visibleGlyphs > f.totalGlyphs) return null;
  if (![f.holdStartMs, f.leaveAtMs, f.hideAtMs].every(v => Number.isFinite(v) && v >= 0 && v <= 60000)) return null;
  return withPaperlabEvidence(value, { runId: value.runId, reducedMotion: value.reducedMotion, systemReducedMotion: value.systemReducedMotion, effectiveReducedMotion: value.effectiveReducedMotion, documentHidden: value.documentHidden, rafCount: value.rafCount, renderCount: value.renderCount, frame: { activeMs: f.activeMs, phase: f.phase, burn: f.burn, writing: f.writing, state: f.state, paperOpacity: f.paperOpacity, opacity: f.opacity, visibleGlyphs: f.visibleGlyphs, totalGlyphs: f.totalGlyphs, holdStartMs: f.holdStartMs, leaveAtMs: f.leaveAtMs, hideAtMs: f.hideAtMs } });
}
const admissionMessages = Object.freeze({
  'work-association-unavailable': '已核验 Work 来源，但缺少与界面发送控件的会话关联；本次未从猜测位置显示。',
  none: '入口处理正常。',
  'event-invalid': '入口文件未通过本地目录、格式或时效校验。',
  'event-path-invalid': '入口路径格式无效，未读取。',
  'event-arguments-invalid': '入口启动参数缺失、重复或位置不明确，未接受。',
  'event-outside-root': '入口文件不属于本产品本机交接目录，未读取。',
  'event-nonregular': '入口目录或文件类型不符合安全要求，未读取。',
  'event-too-large': '入口文件超过安全读取上限，未读取。',
  'event-file-changed': '入口文件读取期间发生变化，未接受。',
  'event-json-invalid': '入口文件数据格式无效，未接受。',
  'event-id-mismatch': '入口文件名与事件标识不匹配，未接受。',
  'event-unavailable': '入口文件当前不可读取，未接受。',
  'source-not-ready': '当前轮次来源尚未就绪，等待窗口结束后未显示。',
  'paged-state-unavailable': '本机分页状态库不可访问或无法打开，本次未显示。',
  'paged-schema-mismatch': '本机分页状态库的表或字段结构不符合已核验合同，本次未显示。',
  'paged-source-unverified': '本机分页轮次未通过根任务身份与来源核验，本次未显示。',
  'source-header-too-large': '会话日志首行超过安全读取上限，未显示。',
  'source-changed': '轮次日志正在变化，未能取得一致证据。',
  'latest-turn-mismatch': '提交事件与日志中的最新轮次不匹配，未显示。',
  'source-unavailable': '无法读取该会话的本机轮次日志，未显示。',
  'invalid-source': '未取得有效的本机会话日志来源，未显示。',
  'session-mismatch': '日志会话与提交事件不一致，未显示。',
  'version-mismatch': '本机会话日志版本不受支持，未显示。',
  'source-time-unavailable': '日志未提供可信的轮次开始时间，未显示。',
  'source-expired': '轮次来源已过期或时间异常，未显示。',
  cancelled: '本次待显示入口已取消。',
  duplicate: '重复提交事件已忽略。',
  'source-order': '较旧或顺序不明确的提交已忽略。',
  'verification-failed': '入口来源暂不可核验，未显示。'
});
const safeAdmissionReason = reason => Object.hasOwn(admissionMessages, reason) ? reason : 'verification-failed';
function admissionMessage(reason) { return admissionMessages[safeAdmissionReason(reason)]; }
class AdmissionEvidence {
  constructor() { this.counters = { received: 0, 'read-rejected': 0, 'verify-rejected': 0, queued: 0, applied: 0 }; this.last = null; }
  record(stage, value = {}) {
    if (!Object.hasOwn(this.counters, stage)) return false;
    this.counters[stage] = Math.min(1000000, this.counters[stage] + 1);
    const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v) ? v : null;
    this.last = { stage, reason: safeAdmissionReason(value.reason ?? 'none'),
      at: Number.isFinite(value.at) && value.at >= 0 && value.at <= 8640000000000000 ? new Date(value.at).toISOString() : null,
      sessionId: id(value.sessionId), turnId: id(value.turnId),
      elapsedMs: Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 600000 ? Math.round(value.elapsedMs) : null };
    return true;
  }
  snapshot() { return { ...this.last, counters: { ...this.counters } }; }
}
function entrancePathShape(value) {
  const text = typeof value === 'string' ? value : '';
  const hasNamespace = text.startsWith('\\\\?\\'), local = hasNamespace ? text.slice(4) : text;
  return { type: typeof value, length: Math.min(text.length, 65536), absolute: windowsPath.isAbsolute(text),
    startsQuotes: /^["']/.test(text), endsQuotes: /["']$/.test(text), hasNamespace,
    localDrive: /^[A-Za-z]:[\\/]/.test(local), hasControl: /[\x00-\x1f]/.test(text), extraColon: local.slice(2).includes(':'),
    baseHashRegex: /^[a-f0-9]{64}\.json$/.test(windowsPath.basename(text)),
    parentNameExpected: windowsPath.basename(windowsPath.dirname(text)).toLowerCase() === 'entrance-events',
    productRootNameExpected: windowsPath.basename(text).toLowerCase() === 'summoning-fu-handoff' };
}
function entranceArgvShapes(args) {
  const known = new Set(['--entrance-file', '--session-file', '--session-id', '--diagnostics-file', '--capture-dir', '--read', '--hide', '--quit', '--capture', '--motion-preview', '--preview-qa-only', '--preview-qa', '--allow-file-access-from-files', '--original-process-start-time', '--user-data-dir']);
  if (!Array.isArray(args)) return [];
  return args.slice(0, 32).map((value, index) => {
    const separator = typeof value === 'string' ? value.indexOf('=') : -1;
    const key = typeof value === 'string' ? value.slice(0, separator < 0 ? undefined : separator) : '';
    const flag = known.has(key) ? key.slice(2) : typeof value === 'string' && value.startsWith('--') ? 'unknown-option' : 'value';
    const command = key === '--preview-qa' && separator >= 0 ? value.slice(separator + 1) : null;
    const previewCommand = command === null ? {} : { previewCommand: previewCommandAllowed(command) || ['hide', 'show', 'close'].includes(command) ? command : 'unknown-command' };
    return { index, flag, shape: entrancePathShape(value), ...previewCommand, ...(key === '--entrance-file' && separator >= 0 ? { attachedValue: entrancePathShape(value.slice(separator + 1)) } : {}) };
  });
}
function parseEntranceArgument(args) {
  const matches = Array.isArray(args) ? args.flatMap((arg, index) => typeof arg === 'string' && (arg === '--entrance-file' || arg.startsWith('--entrance-file=')) ? [{ arg, index }] : []) : [];
  if (!matches.length) return { value: null, error: null };
  if (matches.length !== 1) return { value: null, error: 'event-arguments-invalid' };
  const { arg, index } = matches[0];
  // Chromium can reorder switches before positional arguments for second-instance.
  // Attached transport is unambiguous. Legacy cold starts require an adjacent value.
  const value = arg === '--entrance-file' ? args[index + 1] : arg.slice('--entrance-file='.length);
  if (typeof value !== 'string' || !value || value.length > 8192 || value.startsWith('--') || !windowsPath.isAbsolute(value)) return { value: null, error: 'event-arguments-invalid' };
  return { value, error: null };
}
function sanitizeReasoningEvidence(value) {
  if (value?.source === 'configured' && value.storageSource === 'codex-thread-config'
    && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value.value)
    && typeof value.sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.sessionId)
    && value.model === null && value.contextOffset === null && Number.isSafeInteger(value.observedAt) && value.observedAt >= 0 && value.observedAt <= 8640000000000000) {
    return { value: value.value, source: 'configured', storageSource: 'codex-thread-config', observedAt: value.observedAt, contextOffset: null };
  }
  if (!value || value.source !== 'reported' || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value.value) || !Number.isSafeInteger(value.contextOffset) || value.contextOffset < 0) return { value: null, source: 'unknown', contextOffset: null };
  return { value: value.value, source: 'reported', contextOffset: value.contextOffset };
}
const previewCommandAllowed = command => ['replay', 'pause', 'resume', 'stop', 'point', 'travel', 'unfold', 'paper', 'writing', 'seal', 'hold', 'folding', 'rolling-start', 'rolling', 'rolled', 'rotating', 'flying', 'staging', 'intake', 'intake-tip', 'intake-tail', 'target-near', 'target-far', 'target-left', 'target-right', 'target-move', 'target-hide', 'target-expire', 'target-drag', 'speed-0.25', 'speed-0.5', 'speed-1', 'fixture-a', 'fixture-b', 'fixture-race', 'seal-brand', 'seal-generic', 'seal-receipt', 'seal-exit', 'bg-dark', 'bg-light', 'layout-compact', 'layout-wide', 'geometry-resize'].includes(command);
function sanitizePreviewEvidence(value) {
  if (!value || typeof value.systemReducedMotion !== 'boolean' || value.effectiveReducedMotion !== false || typeof value.documentHidden !== 'boolean' || typeof value.playing !== 'boolean') return null;
  if (!['point', 'travel', 'unfold', 'paper', 'writing', 'seal', 'hold', 'folding', 'rolling', 'rotating', 'flying', 'staging', 'intake', 'seal-ack', 'seal-exit', 'burning', 'ash', 'leaving', 'hidden'].includes(value.phase)) return null;
  const result = { phase: value.phase, systemReducedMotion: value.systemReducedMotion, effectiveReducedMotion: false, documentHidden: value.documentHidden, playing: value.playing };
  if (Object.hasOwn(value, 'stageRect')) {
    const r = value.stageRect;
    if (!r || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && Math.abs(r[k]) <= 1000000) || r.width <= 0 || r.height <= 0) return null;
    result.stageRect = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, r[k]]));
  }
  if (Object.hasOwn(value, 'localSeal')) {
    const seal = value.localSeal; if (!Delivery.validateLocalSeal?.(seal)) return null;
    const p = seal.provider;
    if (p?.providerId !== null && (typeof p?.providerId !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(p.providerId))) return null;
    if (!p || !['brand', 'generic'].includes(p.kind) || typeof p.assetId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(p.assetId) || !['unknown', 'demo-preview', 'reported-model+reviewed-catalog'].includes(p.source)) return null;
    result.localSeal = { source: seal.source, coordinateSpace: seal.coordinateSpace, runId: seal.runId, generation: seal.generation, layoutVersion: seal.layoutVersion, rect: Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, seal.rect[k]])), acceptancePoint: { x: seal.acceptancePoint.x, y: seal.acceptancePoint.y }, provider: { providerId: p.providerId, kind: p.kind, assetId: p.assetId, source: p.source } };
  }
  for (const key of ['generation', 'renderCount', 'rafCount', 'visibleGlyphs', 'totalGlyphs']) { if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000000000) return null; result[key] = value[key]; }
  for (const key of ['elapsedMs', 'holdStartMs', 'leaveAtMs', 'hideAtMs']) { if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 60000) return null; result[key] = value[key]; }
  for (const key of ['paperOpacity', 'opacity', 'writing']) { if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) return null; result[key] = value[key]; }
  if (result.visibleGlyphs > result.totalGlyphs) return null;
  result.uiElapsedMs = Number.isFinite(value.uiElapsedMs) && value.uiElapsedMs >= 0 && value.uiElapsedMs <= 60000 ? value.uiElapsedMs : null;
  result.burn = Number.isFinite(value.burn) && value.burn >= 0 && value.burn <= 1 ? value.burn : null;
  if (Object.hasOwn(value, 'svgVisible')) { if (typeof value.svgVisible !== 'boolean') return null; result.svgVisible = value.svgVisible; }
  if (Object.hasOwn(value, 'exampleTargetRevision')) { if (!Number.isSafeInteger(value.exampleTargetRevision) || value.exampleTargetRevision < 0) return null; result.exampleTargetRevision = value.exampleTargetRevision; }
  if (Object.hasOwn(value, 'exampleTargetInput')) { if (!['none', 'preview-preset', 'qa-command', 'trusted-pointer'].includes(value.exampleTargetInput)) return null; result.exampleTargetInput = value.exampleTargetInput; }
  if (Object.hasOwn(value, 'exampleTargetVisible')) { if (typeof value.exampleTargetVisible !== 'boolean') return null; result.exampleTargetVisible = value.exampleTargetVisible; }
  if (Object.hasOwn(value, 'exampleTargetRect')) {
    const rect = value.exampleTargetRect;
    if (rect === null && value.exampleTargetVisible === false) result.exampleTargetRect = null;
    else {
      if (value.exampleTargetVisible === false || !rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]) && Math.abs(rect[k]) <= 1000000) || rect.width <= 0 || rect.height <= 0) return null;
      result.exampleTargetRect = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, rect[k]]));
    }
  }
  if (Object.hasOwn(value, 'pendingReplacement')) {
    const p = value.pendingReplacement;
    if (!p || !['cancelledPreparation', 'activePreparation'].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0) || p.activePreparation <= p.cancelledPreparation || !['stalePreparationSettled', 'activePreparationReady'].every(k => typeof p[k] === 'boolean')) return null;
    result.pendingReplacement = Object.fromEntries(['cancelledPreparation', 'activePreparation', 'stalePreparationSettled', 'activePreparationReady'].map(k => [k, p[k]]));
  }
  if (Object.hasOwn(value, 'cancellationReason')) {
    if (!['none', 'cancelled', 'target-unavailable', 'target-changed', 'document-hidden', 'geometry-changed', 'render-failed', 'pagehide'].includes(value.cancellationReason)) return null;
    result.cancellationReason = value.cancellationReason;
  }
  return withPaperlabEvidence(value, result);
}
function desktopSettingsSnapshot({ settings = {}, binding, bindingChanged = false, position }) {
  return { ...settings, version: 3, binding: bindingChanged ? binding : settings.binding ?? null, petPosition: position ? { x: position.x, y: position.y } : settings.petPosition };
}
class PreviewReplayGate {
  constructor() { this.ready = false; this.pending = false; }
  request() { if (this.ready) return true; this.pending = true; return false; }
  readyNow() { this.ready = true; const replay = this.pending; this.pending = false; return replay; }
}
function relayNativeWindowHidden(win, kind) {
  if (!['pet', 'preview'].includes(kind)) return;
  for (const name of ['hide', 'minimize']) win.on(name, () => {
    if (win.isDestroyed()) return;
    if (kind === 'preview') win.webContents.send('fu:preview-command', 'window-hidden');
    else win.webContents.send('fu:window-hidden');
  });
}
function samePausedPreviewIdentity(before, after) {
  if (!before || !after || before.playing !== false || after.playing !== false) return false;
  return ['generation', 'phase', 'elapsedMs'].every(key => before[key] === after[key]) &&
    ['metadataHash', 'textureHash'].every(key => typeof before.paperlab?.[key] === 'string' && before.paperlab[key] === after.paperlab?.[key]);
}
const sendMessages = Object.freeze({
  'unsupported-platform': '当前系统不支持这条界面发送观察通道。',
  'host-unavailable': '未找到同时符合包身份、安装目录和窗口要求的应用；界面发送观察暂停。',
  'host-ambiguous': '存在多个符合身份的应用窗口；界面发送观察暂停，不猜测目标窗口。',
  'identity-unverified': '应用包身份未通过核验；界面发送观察未启用。',
  'window-unavailable': '已核验的应用窗口当前不可用；界面发送观察暂停。',
  'window-inactive': '应用窗口当前不在前台；仅暂停界面发送观察，不表示 Codex Hook 未启用。',
  'window-minimized': '应用窗口当前已最小化；界面发送观察暂停。',
  'mode-changed': '应用模式已改变；旧界面发送候选已取消。',
  'observer-stopped': '界面发送观察器已停止。',
  'observer-exited': '界面发送观察器进程已退出；等待受限重试。',
  'observer-timeout': '界面发送观察器没有按时响应；本次子进程已停止。',
  'buffer-limit': '界面发送观察器输出超过安全上限，已停止该子进程。',
  'spawn-failed': '界面发送观察器子进程未能启动。',
  'retry-exhausted': '界面发送观察器已达到重试上限；Codex Hook 的交接状态需单独查看。',
  'send-unavailable': '当前发送控件不可订阅；已确认的本次符保持原有时间线。',
  'composer-unproven': '当前未证明下一次发送控件的归属；已确认的本次符保持原有时间线。',
  'protocol-invalid': '无效的观察器消息已丢弃。',
  'work-association-unavailable': 'UIA 不代替 Codex 工作聊天的 Hook；该模式等待真实 UserPromptSubmit 交接，不凭界面事件推断会话身份。',
  'mode-unknown': '尚未识别 Chat / Work 模式；等待可核验的发送控件。',
  'viewport-unavailable': '尚未取得聊天内容区域，未用窗口外框代替页面中央。',
  'geometry-invalid': '发送按钮与页面位置不可用或跨显示器，本次未显示。',
  'geometry-changed': '窗口或页面位置已变化，本次展示已收起。',
  'observer-unavailable': '发送观察器暂不可用；不会猜测点击或读取消息正文。',
  'observing': '正在只读观察发送控件；实际事件未取得前不会显示。',
  'send-invoked': '已观察到 Chat 发送控件调用；这不表示模型开始工作或服务端确认。'
});
const observerStageLabels = Object.freeze({ 'init-assemblies': '加载系统程序集', 'init-compile': '编译观察器', 'init-package': '核验应用包', 'init-parent': '核验父进程', 'init-dpi': '准备坐标环境', 'init-automation': '创建观察接口', host: '核验宿主窗口', 'element-from-handle': '取得窗口元素', mode: '识别模式', 'main-region': '取得主区域', composer: '核验编辑区归属', send: '核验发送控件', subscribe: '订阅发送事件', drain: '检查已收到事件' });
function sendDiagnostic(reason, diagnostic) {
  const message = Object.hasOwn(sendMessages, reason) ? sendMessages[reason] : sendMessages['observer-unavailable'];
  const checked = sanitizeObserverDiagnostic(diagnostic);
  return checked ? message + ' 阶段：' + observerStageLabels[checked.stage] + '；HRESULT 0x' + (checked.hresult >>> 0).toString(16).padStart(8, '0') + '。' : message;
}
function sendDiagnosticInvalidates(reason) { return !['send-unavailable', 'composer-unproven', 'protocol-invalid'].includes(reason); }
function workAnchorAssociation() { return { verified: false, reason: 'work-association-unavailable' }; }
function sendOverlayLayout(anchor, viewport, display) {
  const rect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && Math.abs(r.x) <= 131072 && Math.abs(r.y) <= 131072 && r.width > 0 && r.height > 0 && r.width <= 32768 && r.height <= 32768;
  const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  if (![anchor, viewport, display].every(rect) || !inside(anchor, display) || !inside(viewport, display)) return null;
  const height = Math.min(676, viewport.height - 32, (viewport.width - 32) * 760 / 360);
  if (height < 180) return null;
  const width = height * 360 / 760;
  const target = { x: viewport.x + (viewport.width - width) / 2, y: viewport.y + viewport.height / 2 - height * 375 / 760, width, height };
  const x = Math.floor(Math.min(anchor.x, target.x)), y = Math.floor(Math.min(anchor.y, target.y));
  const bounds = { x, y, width: Math.ceil(Math.max(anchor.x + anchor.width, target.x + width) - x), height: Math.ceil(Math.max(anchor.y + anchor.height, target.y + height) - y) };
  if (!inside(bounds, display)) return null;
  return Object.freeze({ bounds: Object.freeze(bounds), geometry: Object.freeze({ originRect: Object.freeze({ ...anchor, x: anchor.x - x, y: anchor.y - y }), targetRect: Object.freeze({ ...target, x: target.x - x, y: target.y - y }) }) });
}
class SendAdmissionGate {
  constructor() { this.generation = 0; this.observerId = null; this.sequence = -1; this.monotonicMs = -1; this.retired = new Set(); }
  invalidate() { this.generation++; }
  isCurrent(token) { return token === this.generation; }
  accept(raw, now) {
    const no = reason => ({ accepted: false, reason });
    const o = validateUiObservation(raw);
    if (!o || !Number.isFinite(now)) return no('observer-unavailable');
    if (this.retired.has(o.observerId)) return no('retired-observer');
    if (o.observerId !== this.observerId) {
      if (this.retired.size >= 64) return no('observer-unavailable');
      if (this.observerId) this.retired.add(this.observerId);
      this.observerId = o.observerId; this.sequence = -1; this.monotonicMs = -1; this.invalidate();
    }
    if (o.sequence <= this.sequence || o.monotonicMs < this.monotonicMs) return no('duplicate');
    this.sequence = o.sequence; this.monotonicMs = o.monotonicMs;
    if (o.kind === 'unavailable') { const invalidated = sendDiagnosticInvalidates(o.reason); if (invalidated) this.invalidate(); return { ...no(o.reason), invalidated, ...(o.diagnostic ? { diagnostic: o.diagnostic } : {}) }; }
    if (o.kind !== 'send-invoked' || o.host?.package !== 'OpenAI.Codex' || o.mode?.source !== 'explicit-selection' || !['chat', 'work'].includes(o.mode.value) || o.evidence?.invoke !== true || o.evidence?.composerBound !== true || o.evidence?.foreground !== true || o.evidence?.minimized !== false) return no('mode-unknown');
    if (o.mode.value === 'work') return no('work-association-unavailable');
    this.invalidate();
    const fields = ['relay', 'company', 'model', 'harness', 'environment', 'task', 'reasoning'];
    const metadata = Object.fromEntries(fields.map(f => [f, null])); metadata.sources = Object.fromEntries(fields.map(f => [f, 'unknown']));
    return { accepted: true, token: this.generation, eventId: 'ui:' + o.observerId + ':' + o.sequence, source: 'chatgpt-uia', confirmation: 'send-invoked', sessionId: null, turnId: null, metadata };
  }
}
module.exports = { HostClock, DeliveryTargetBridge, rebaseDeliveryLayout, clampBounds, controlBounds, entranceBounds, independentPetLayout, EntranceScheduler, verifyEntranceUntil, startupIntent, previewQaProfile, samePreviewQaProfile, sanitizeRenderEvidence, sanitizePaperlabEvidence, AdmissionEvidence, admissionMessage, entrancePathShape, entranceArgvShapes, parseEntranceArgument, sanitizeReasoningEvidence, previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate, relayNativeWindowHidden, samePausedPreviewIdentity, entranceMotionPolicy, SendAdmissionGate, sendOverlayLayout, workAnchorAssociation, sendDiagnostic, sendDiagnosticInvalidates, sanitizeObserverDiagnostic };
module.exports.prepareLocalSealLayout = prepareLocalSealLayout;
