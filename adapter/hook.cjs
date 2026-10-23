'use strict';
const crypto = require('node:crypto');
const { idOK, metadataFor, safeText } = require('./envelope.cjs');
const EVENTS = new Set(['UserPromptSubmit', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']);
function sanitizeHook(input) {
  if (!input || !EVENTS.has(input.hook_event_name) || !idOK(input.session_id)) return null;
  if (input.hook_event_name !== 'SessionEnd' && !idOK(input.turn_id)) return null;
  const output = { hook_event_name: input.hook_event_name, session_id: input.session_id };
  if (idOK(input.turn_id)) output.turn_id = input.turn_id;
  if (input.hook_event_name === 'UserPromptSubmit') {
    output.model = safeText(input.model, 96); output.prompt = safeText(input.prompt, 8192);
    output.cwd = safeText(input.cwd, 1024);
    output.fullTaskTruncated = typeof input.prompt === 'string' && Array.from(input.prompt).length > 8192;
  }
  // No tool arguments, transcript path, auth, session context, or arbitrary extra fields leave this process.
  return output;
}
class HookAdapter {
  constructor({ sessionId, turnId = null, onEnvelope = () => {}, onDiagnostic = () => {}, aliases = {} } = {}) {
    if (!idOK(sessionId) || (turnId != null && !idOK(turnId))) throw new TypeError('Explicit sessionId required.');
    this.sessionId = sessionId; this.allowedTurn = turnId; this.onEnvelope = onEnvelope; this.onDiagnostic = onDiagnostic;
    this.aliases = aliases; this.current = null; this.closed = new Set(); this.seen = new Set(); this.sourceWatermark = -1;
  }
  // Only call with a source-proven turn and sequence (e.g. locked rollout task_started byte offset).
  // Hook process arrival, spool filename and filesystem mtime are NOT source order.
  authorizeTurn(turnId, sourceSequence) {
    if (!idOK(turnId) || !Number.isSafeInteger(sourceSequence) || sourceSequence <= this.sourceWatermark || this.closed.has(turnId)) return false;
    if (this.current && this.current.runId !== turnId) this.close(this.current.runId);
    this.allowedTurn = turnId; this.sourceWatermark = sourceSequence; return true;
  }
  diagnostic(code, message) { try { this.onDiagnostic({ code, message }); } catch {} }
  close(turnId) { this.closed.add(turnId); if (this.closed.size > 256) this.closed.delete(this.closed.values().next().value); }
  accept(raw) {
    const e = sanitizeHook(raw);
    if (!e || e.session_id !== this.sessionId || this.closed.has(e.turn_id)) return false;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex');
    if (this.seen.has(fingerprint)) return false;
    if (e.hook_event_name === 'UserPromptSubmit') {
      if (this.current?.runId === e.turn_id) return false;
      if ((this.allowedTurn && e.turn_id !== this.allowedTurn) || (this.current && this.allowedTurn !== e.turn_id)) {
        this.diagnostic('unproven-hook-order', '新回合缺少源顺序证明；没有用 hook 到达时间替换当前任务。'); return false;
      }
      const data = metadataFor({ model: e.model, prompt: e.prompt, cwd: e.cwd, harness: 'Codex', aliases: this.aliases });
      data.metadata.fullTaskTruncated ||= e.fullTaskTruncated === true;
      this.current = { schemaVersion: 1, sessionId: this.sessionId, runId: e.turn_id, source: 'codex-hook', state: 'working', ...data };
      this.allowedTurn = e.turn_id;
    } else {
      if (!this.current || (e.turn_id && e.turn_id !== this.current.runId)) return false;
      if (e.hook_event_name === 'PermissionRequest') this.current.state = 'waiting';
      else if (e.hook_event_name === 'Interrupt') { this.current.state = 'cancelled'; this.close(this.current.runId); }
      else if (['Stop', 'SessionEnd'].includes(e.hook_event_name)) this.current.state = 'unknown';
      else {
        // Concurrent hooks have no reliable ordering; a late PostToolUse must not undo waiting/Stop.
        if (this.current.state !== 'working') return false;
      }
    }
    this.seen.add(fingerprint); if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    const envelope = { ...this.current, eventId: `hook:${fingerprint}`, observedAt: new Date().toISOString() };
    try { this.onEnvelope(structuredClone(envelope)); } catch { this.diagnostic('consumer-error', '显示层未接受 hook 更新。'); }
    return true;
  }
}
module.exports = { HookAdapter, sanitizeHook };
