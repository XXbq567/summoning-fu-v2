'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { validateUiObservation, sanitizeObserverDiagnostic, MAX_LINE_BYTES, REASONS } = require('../adapter/ui-send-observation.cjs');

const MAX_BUFFER_BYTES = 64 * 1024;
const STARTUP_TIMEOUT_MS = 12000;
const HEARTBEAT_TIMEOUT_MS = 8000;
const RETRY_MS = 250;
const MAX_RESTARTS = 3;
const reasonSet = new Set(REASONS);

class SendObserver {
  constructor(options = {}) {
    this.presentationTotalMs = options.presentationTotalMs === undefined ? 11300 : options.presentationTotalMs;
    if (!Number.isInteger(this.presentationTotalMs) || this.presentationTotalMs < 5000 || this.presentationTotalMs > 30000) {
      throw new RangeError('presentationTotalMs must be an integer from 5000 to 30000');
    }
    this.onObservation = typeof options.onObservation === 'function' ? options.onObservation : () => {};
    this.onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    this.spawn = options.spawn || spawn;
    this.clock = options.clock || (() => performance.now());
    this.setTimer = options.setTimeout || setTimeout;
    this.clearTimer = options.clearTimeout || clearTimeout;
    this.parent = options.parent || process;
    this.platform = options.platform || process.platform;
    const packaged = options.packaged ?? /(?:^|[\\/])app\.asar(?:[\\/]|$)/i.test(__dirname);
    this.helperPath = packaged ? path.join(options.resourcesPath || process.resourcesPath || '', 'send-observer', 'windows-send-observer.ps1') :
      path.join(__dirname, 'windows-send-observer.ps1');
    this.executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.active = false;
    this.child = null;
    this.retryTimer = null;
    this.generation = 0;
    this.parentExit = () => this.stop();
    this.localId = `wrapper_${randomUUID()}`;
    this.localSequence = 0;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.restarts = 0;
    this.parent.once('exit', this.parentExit);
    if (this.platform !== 'win32') {
      this.invalidate('unsupported-platform');
      return;
    }
    this.launch();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    ++this.generation;
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
    this.parent.removeListener('exit', this.parentExit);
    this.disposeChild();
    this.invalidate('observer-stopped');
  }

  diagnostic(reason, diagnostic) {
    if (!reasonSet.has(reason)) reason = 'observer-unavailable';
    const checked = sanitizeObserverDiagnostic(diagnostic);
    try { this.onDiagnostic(Object.freeze({ reason, ...(checked ? { diagnostic: checked } : {}) })); } catch { /* Client callbacks cannot extend helper lifetime. */ }
  }

  invalidate(reason, diagnostic) {
    const checked = sanitizeObserverDiagnostic(diagnostic);
    this.diagnostic(reason, checked);
    const value = validateUiObservation({ schemaVersion: 1, kind: 'unavailable', observerId: this.localId,
      sequence: ++this.localSequence, monotonicMs: Math.max(0, this.clock()), reason, ...(checked ? { diagnostic: checked } : {}) });
    if (value) this.deliver(value);
  }

  deliver(value) {
    try { this.onObservation(value); } catch { this.diagnostic('observer-unavailable'); }
  }

  disposeChild() {
    const state = this.child;
    this.child = null;
    if (!state) return;
    this.clearTimer(state.heartbeatTimer);
    state.child.stdout?.removeListener('data', state.onData);
    state.child.stderr?.removeListener('data', state.onStderr);
    state.child.removeListener('exit', state.onExit);
    // Keep a no-op error listener: a late spawn error must not escape after stop.
    state.child.removeListener('error', state.onError);
    state.child.on('error', () => {});
    try { state.child.kill(); } catch { /* Only this private child is eligible for termination. */ }
  }

  finish(generation, reason, diagnostic) {
    if (!this.active || generation !== this.generation) return;
    ++this.generation;
    this.disposeChild();
    this.invalidate(reason, diagnostic);
    if (this.restarts >= MAX_RESTARTS) {
      this.diagnostic('retry-exhausted', diagnostic);
      return;
    }
    this.restarts++;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (this.active) this.launch();
    }, RETRY_MS);
  }

  launch() {
    if (!this.active) return;
    const generation = ++this.generation;
    const observerId = `uia_${randomUUID()}`;
    let child;
    try {
      child = this.spawn(this.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', this.helperPath,
        '-ObserverId', observerId, '-ParentPid', String(process.pid), '-PresentationTotalMs', String(this.presentationTotalMs)],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      this.finish(generation, 'spawn-failed');
      return;
    }
    const state = { child, observerId, buffer: Buffer.alloc(0), lastSequence: 0, lastMonotonicMs: 0, lastDiagnostic: null };
    this.child = state;
    const current = () => this.active && this.generation === generation && this.child === state;
    const resetHeartbeat = (delay = HEARTBEAT_TIMEOUT_MS) => {
      if (state.heartbeatTimer !== undefined) this.clearTimer(state.heartbeatTimer);
      state.heartbeatTimer = this.setTimer(() => this.finish(generation, 'observer-timeout'), delay);
    };
    state.onData = chunk => {
      if (!current()) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (state.buffer.length + data.length > MAX_BUFFER_BYTES) return this.finish(generation, 'buffer-limit');
      state.buffer = Buffer.concat([state.buffer, data]);
      let end;
      while ((end = state.buffer.indexOf(10)) !== -1) {
        if (end > MAX_LINE_BYTES) return this.finish(generation, 'buffer-limit');
        let line = state.buffer.subarray(0, end);
        state.buffer = state.buffer.subarray(end + 1);
        if (line.at(-1) === 13) line = line.subarray(0, line.length - 1);
        if (!line.length) continue;
        let raw;
        try { raw = new TextDecoder('utf-8', { fatal: true }).decode(line); } catch { this.diagnostic('protocol-invalid'); continue; }
        let parsed;
        try { parsed = JSON.parse(raw); } catch { this.diagnostic('protocol-invalid'); continue; }
        const health = parsed?.kind === 'health';
        if (health && (Object.keys(parsed).length !== 5 || Object.keys(parsed).some(key =>
          !['schemaVersion', 'kind', 'observerId', 'sequence', 'monotonicMs'].includes(key)))) {
          this.diagnostic('protocol-invalid'); continue;
        }
        const value = validateUiObservation(health ? { ...parsed, kind: 'unavailable', reason: 'observer-unavailable' } : parsed,
          { observerId, lastSequence: state.lastSequence, lastMonotonicMs: state.lastMonotonicMs });
        if (!value) { this.diagnostic('protocol-invalid'); continue; }
        state.lastSequence = value.sequence;
        state.lastMonotonicMs = value.monotonicMs;
        resetHeartbeat();
        if (!health) {
          state.lastDiagnostic = value.kind === 'unavailable' ? value.diagnostic || null : null;
          if (value.kind === 'unavailable') this.diagnostic(value.reason, value.diagnostic);
          this.deliver(value);
        }
        if (!current()) return;
      }
      if (state.buffer.length > MAX_LINE_BYTES) this.finish(generation, 'buffer-limit');
    };
    state.onStderr = () => { if (current()) this.diagnostic('observer-unavailable'); };
    state.onExit = () => this.finish(generation, 'observer-exited', state.lastDiagnostic);
    state.onError = () => this.finish(generation, 'spawn-failed');
    child.stdout?.on('data', state.onData);
    child.stderr?.on('data', state.onStderr);
    child.once('exit', state.onExit);
    child.once('error', state.onError);
    resetHeartbeat(STARTUP_TIMEOUT_MS);
  }
}

module.exports = { SendObserver };
