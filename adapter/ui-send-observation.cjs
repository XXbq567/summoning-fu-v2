'use strict';

const MAX_LINE_BYTES = 16 * 1024;
const REASONS = Object.freeze([
  'unsupported-platform', 'host-unavailable', 'host-ambiguous', 'identity-unverified',
  'window-unavailable', 'window-inactive', 'window-minimized', 'mode-unknown', 'mode-changed',
  'send-unavailable', 'composer-unproven', 'viewport-unavailable', 'geometry-invalid',
  'geometry-changed', 'observer-stopped', 'observer-exited', 'observer-timeout',
  'observer-unavailable', 'buffer-limit', 'protocol-invalid', 'spawn-failed', 'retry-exhausted'
]);
const reasonSet = new Set(REASONS);
const OBSERVER_STAGES = Object.freeze(['init-assemblies', 'init-compile', 'init-package', 'init-parent', 'init-dpi', 'init-automation', 'host', 'element-from-handle', 'mode', 'main-region', 'composer', 'send', 'subscribe', 'drain']);
const observerStageSet = new Set(OBSERVER_STAGES);

function keysAre(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key))) return false;
  if (!required.every(key => Object.hasOwn(value, key))) return false;
  return keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function sanitizeObserverDiagnostic(value) {
  try {
    if (!keysAre(value, ['stage', 'hresult']) || !observerStageSet.has(value.stage) || !Number.isInteger(value.hresult) || value.hresult < -2147483648 || value.hresult > 2147483647) return null;
    return Object.freeze({ stage: value.stage, hresult: value.hresult });
  } catch { return null; }
}

function validHost(host) {
  return keysAre(host, ['package', 'pid', 'hwnd']) && host.package === 'OpenAI.Codex' &&
    Number.isInteger(host.pid) && host.pid > 0 && host.pid <= 2147483647 &&
    typeof host.hwnd === 'string' && /^[1-9][0-9]{0,19}$/.test(host.hwnd) &&
    BigInt(host.hwnd) <= 18446744073709551615n;
}

function validRect(rect) {
  return keysAre(rect, ['x', 'y', 'width', 'height']) &&
    ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) &&
    Math.abs(rect.x) <= 131072 && Math.abs(rect.y) <= 131072 &&
    rect.width > 0 && rect.height > 0 && rect.width <= 32768 && rect.height <= 32768;
}

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

/** now and receivedAt share the caller's local clock; helper monotonicMs has a separate origin. */
function validateUiObservation(raw, options = {}) {
  try {
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw, 'utf8') > MAX_LINE_BYTES) return null;
      raw = JSON.parse(raw);
    }
    const base = ['schemaVersion', 'kind', 'observerId', 'sequence', 'monotonicMs'];
    const unavailable = raw?.kind === 'unavailable';
    if (!keysAre(raw, unavailable ? [...base, 'reason'] :
      [...base, 'host', 'mode', 'coordinateSpace', 'anchor', 'viewport', 'evidence'], unavailable ? ['host', 'diagnostic'] : [])) return null;
    if (raw.schemaVersion !== 1 || !['send-invoked', 'unavailable'].includes(raw.kind) ||
      typeof raw.observerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.observerId) ||
      !Number.isSafeInteger(raw.sequence) || raw.sequence < 1 ||
      !Number.isFinite(raw.monotonicMs) || raw.monotonicMs < 0 || raw.monotonicMs > Number.MAX_SAFE_INTEGER) return null;
    if (options.observerId !== undefined && raw.observerId !== options.observerId) return null;
    if (options.lastSequence !== undefined && (!Number.isSafeInteger(options.lastSequence) || raw.sequence <= options.lastSequence)) return null;
    if (options.lastMonotonicMs !== undefined && (!Number.isFinite(options.lastMonotonicMs) || raw.monotonicMs < options.lastMonotonicMs)) return null;
    const maxAgeMs = options.maxAgeMs ?? 2000;
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 30000) return null;
    if (options.now !== undefined || options.receivedAt !== undefined) {
      if (!Number.isFinite(options.now) || !Number.isFinite(options.receivedAt) ||
        options.now < options.receivedAt || options.now - options.receivedAt > maxAgeMs) return null;
    }
    if (Object.hasOwn(raw, 'host') && !validHost(raw.host)) return null;
    if (unavailable) {
      if (!reasonSet.has(raw.reason) || Object.hasOwn(raw, 'diagnostic') && !sanitizeObserverDiagnostic(raw.diagnostic)) return null;
    } else {
      if (!keysAre(raw.mode, ['value', 'source']) || !['chat', 'work'].includes(raw.mode.value) ||
        raw.mode.source !== 'explicit-selection' || options.expectedMode !== undefined && raw.mode.value !== options.expectedMode ||
        raw.coordinateSpace !== 'physical-screen-px' || !validRect(raw.anchor) || !validRect(raw.viewport) ||
        !keysAre(raw.evidence, ['invoke', 'composerBound', 'foreground', 'minimized']) ||
        raw.evidence.invoke !== true || raw.evidence.composerBound !== true ||
        raw.evidence.foreground !== true || raw.evidence.minimized !== false) return null;
    }
    // A JSON round trip rebuilds exactly the accepted primitive whitelist, never retaining caller references.
    const encoded = JSON.stringify(raw);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_LINE_BYTES) return null;
    return freeze(JSON.parse(encoded));
  } catch {
    return null;
  }
}

module.exports = { validateUiObservation, sanitizeObserverDiagnostic, OBSERVER_STAGES, MAX_LINE_BYTES, REASONS };
