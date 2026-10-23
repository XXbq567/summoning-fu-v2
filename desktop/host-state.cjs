'use strict';
const { Session } = require('../renderer/ritual-timeline.js');
const windowsPath = require('node:path').win32;
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
class EntranceScheduler {
  constructor() { this.generation = 0; this.pending = null; this.seen = new Set(); this.sourceWatermark = -Infinity; this.sourceEvent = null; }
  acceptSource(eventId, startedAtMs) {
    if (!Number.isFinite(startedAtMs) || startedAtMs < this.sourceWatermark || (startedAtMs === this.sourceWatermark && eventId !== this.sourceEvent)) return false;
    this.sourceWatermark = startedAtMs; this.sourceEvent = eventId; return true;
  }
  queue(event, now) {
    if (!event || typeof event.eventId !== 'string' || this.seen.has(event.eventId) || !Number.isFinite(now)) return null;
    this.seen.add(event.eventId); if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    const token = ++this.generation; this.pending = { token, event, dueAt: now + 5000 }; return token;
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
async function verifyEntranceUntil({ verify, deadline, now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), isActive = () => true, waitForContext = false }) {
  const transient = new Set(['source-not-ready', 'source-changed', 'latest-turn-mismatch']);
  // No source watermark, queue or visible state changes before positive verification.
  for (let attempt = 0; attempt < 21; attempt++) {
    if (!isActive()) return { verified: false, reason: 'cancelled' };
    const result = await verify();
    if (!isActive()) return { verified: false, reason: 'cancelled' };
    const contextPending = waitForContext && result.verified && result.contextMissing === true;
    if ((!contextPending && (result.verified || !transient.has(result.reason))) || now() >= deadline || attempt === 20) return result;
    await wait(Math.min(250, Math.max(1, deadline - now())));
  }
}
function entranceMotionPolicy(systemPreference) {
  return { systemReducedMotion: typeof systemPreference === 'boolean' ? systemPreference : null, effectiveReducedMotion: false };
}
function sanitizeRenderEvidence(value) {
  if (!value || typeof value !== 'object' || typeof value.reducedMotion !== 'boolean' || typeof value.documentHidden !== 'boolean') return null;
  if (typeof value.systemReducedMotion !== 'boolean' || value.effectiveReducedMotion !== false || value.reducedMotion !== value.effectiveReducedMotion) return null;
  if (![value.rafCount, value.renderCount].every(v => Number.isSafeInteger(v) && v >= 0)) return null;
  if (value.runId !== null && (typeof value.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.runId))) return null;
  const f = value.frame;
  if (!f || !Number.isFinite(f.activeMs) || f.activeMs < 0 || f.activeMs > Number.MAX_SAFE_INTEGER || ![f.burn, f.writing].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (!['paper', 'writing', 'seal', 'burning', 'renewal', 'hold', 'leaving', 'hidden'].includes(f.phase) || !['idle', 'working', 'waiting', 'completed', 'error', 'cancelled', 'unknown'].includes(f.state)) return null;
  if (![f.paperOpacity, f.opacity].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (![f.visibleGlyphs, f.totalGlyphs].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 100000) || f.visibleGlyphs > f.totalGlyphs) return null;
  if (![f.holdStartMs, f.leaveAtMs, f.hideAtMs].every(v => Number.isFinite(v) && v >= 0 && v <= 60000)) return null;
  return { runId: value.runId, reducedMotion: value.reducedMotion, systemReducedMotion: value.systemReducedMotion, effectiveReducedMotion: value.effectiveReducedMotion, documentHidden: value.documentHidden, rafCount: value.rafCount, renderCount: value.renderCount, frame: { activeMs: f.activeMs, phase: f.phase, burn: f.burn, writing: f.writing, state: f.state, paperOpacity: f.paperOpacity, opacity: f.opacity, visibleGlyphs: f.visibleGlyphs, totalGlyphs: f.totalGlyphs, holdStartMs: f.holdStartMs, leaveAtMs: f.leaveAtMs, hideAtMs: f.hideAtMs } };
}
const admissionMessages = Object.freeze({
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
  'source-not-ready': '当前轮次日志尚未就绪，等待窗口结束后未显示。',
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
  const known = new Set(['--entrance-file', '--session-file', '--session-id', '--diagnostics-file', '--capture-dir', '--read', '--hide', '--quit', '--capture', '--allow-file-access-from-files', '--original-process-start-time', '--user-data-dir']);
  if (!Array.isArray(args)) return [];
  return args.slice(0, 32).map((value, index) => {
    const separator = typeof value === 'string' ? value.indexOf('=') : -1;
    const key = typeof value === 'string' ? value.slice(0, separator < 0 ? undefined : separator) : '';
    const flag = known.has(key) ? key.slice(2) : typeof value === 'string' && value.startsWith('--') ? 'unknown-option' : 'value';
    return { index, flag, shape: entrancePathShape(value), ...(key === '--entrance-file' && separator >= 0 ? { attachedValue: entrancePathShape(value.slice(separator + 1)) } : {}) };
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
  if (!value || value.source !== 'reported' || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value.value) || !Number.isSafeInteger(value.contextOffset) || value.contextOffset < 0) return { value: null, source: 'unknown', contextOffset: null };
  return { value: value.value, source: 'reported', contextOffset: value.contextOffset };
}
const previewCommandAllowed = command => ['replay', 'pause', 'resume', 'stop', 'paper', 'writing', 'seal', 'hold', 'leaving'].includes(command);
function sanitizePreviewEvidence(value) {
  if (!value || typeof value.systemReducedMotion !== 'boolean' || value.effectiveReducedMotion !== false || typeof value.documentHidden !== 'boolean' || typeof value.playing !== 'boolean') return null;
  if (!['paper', 'writing', 'seal', 'hold', 'leaving', 'hidden'].includes(value.phase)) return null;
  const result = { phase: value.phase, systemReducedMotion: value.systemReducedMotion, effectiveReducedMotion: false, documentHidden: value.documentHidden, playing: value.playing };
  for (const key of ['generation', 'renderCount', 'rafCount', 'visibleGlyphs', 'totalGlyphs']) { if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000000000) return null; result[key] = value[key]; }
  for (const key of ['elapsedMs', 'holdStartMs', 'leaveAtMs', 'hideAtMs']) { if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 60000) return null; result[key] = value[key]; }
  for (const key of ['paperOpacity', 'opacity', 'writing']) { if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) return null; result[key] = value[key]; }
  if (result.visibleGlyphs > result.totalGlyphs) return null;
  result.uiElapsedMs = Number.isFinite(value.uiElapsedMs) && value.uiElapsedMs >= 0 && value.uiElapsedMs <= 60000 ? value.uiElapsedMs : null;
  return result;
}
function desktopSettingsSnapshot({ settings = {}, binding, bindingChanged = false, position }) {
  return { ...settings, version: 3, binding: bindingChanged ? binding : settings.binding ?? null, petPosition: position ? { x: position.x, y: position.y } : settings.petPosition };
}
class PreviewReplayGate {
  constructor() { this.ready = false; this.pending = false; }
  request() { if (this.ready) return true; this.pending = true; return false; }
  readyNow() { this.ready = true; const replay = this.pending; this.pending = false; return replay; }
}
module.exports = { HostClock, clampBounds, controlBounds, entranceBounds, EntranceScheduler, verifyEntranceUntil, startupIntent, sanitizeRenderEvidence, AdmissionEvidence, admissionMessage, entrancePathShape, entranceArgvShapes, parseEntranceArgument, sanitizeReasoningEvidence, previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate, entranceMotionPolicy };
