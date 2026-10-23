'use strict';
const path = require('node:path');
const FIELDS = ['model', 'company', 'relay', 'harness', 'environment', 'task', 'reasoning'];
const STATES = new Set(['working', 'waiting', 'completed', 'cancelled', 'error', 'unknown']);
const PROVENANCE = new Set(['reported', 'configured', 'manual', 'demo', 'unknown']);
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
function clip(text, n) { const a = Array.from(text); return a.length > n ? a.slice(0, n - 1).join('') + '…' : text; }
function safeText(value, max = 8192) {
  if (typeof value !== 'string') return null;
  // Never copy auth objects or tool arguments; this is an additional display-only redaction boundary.
  let text = value.slice(0, 262144)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi, '[凭据已隐藏]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/g, '[凭据已隐藏]')
    .replace(/\b(?:Authorization\s*[:=]\s*(?:Bearer\s+)?|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)\s*[:=]\s*)["']?[^\s,"'}<>]+/gi, '[凭据已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => {
      try { const u = new URL(url); return u.username || u.password || [...u.searchParams.keys()].some(k => /token|key|secret|auth|signature/i.test(k)) ? '[凭据网址已隐藏]' : url; }
      catch { return '[无效网址]'; }
    })
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? clip(text, max) : null;
}
function metadataFor({ model, effort, cwd, prompt, harness = 'Codex', aliases = {} }) {
  const fullTask = safeText(prompt, 8192);
  const companyEntry = aliases.companies && Object.hasOwn(aliases.companies, model) ? aliases.companies[model] : null;
  const company = companyEntry && safeText(companyEntry.evidence, 300) ? safeText(companyEntry.name, 64) : null;
  const relay = safeText(aliases.relay, 64);
  // Relay accepts a display alias only, never any URL.
  const relayAlias = relay && !/https?:|[\\/]|@/.test(relay) ? relay : null;
  const metadata = {
    model: safeText(model, 96), company, relay: relayAlias, harness: safeText(harness, 64),
    environment: typeof cwd === 'string' ? safeText(path.win32.basename(cwd.replace(/\/$/, '')), 96) : null,
    task: fullTask ? clip(fullTask, 240) : null, reasoning: safeText(effort, 32), fullTask,
    fullTaskTruncated: typeof prompt === 'string' && Array.from(prompt).length > 8192
  };
  const provenance = Object.fromEntries(FIELDS.map(k => [k, metadata[k] == null ? 'unknown' : ['company', 'relay'].includes(k) ? 'configured' : 'reported']));
  return { metadata, provenance };
}
class EnvelopeBridge {
  constructor({ sessionId = null } = {}) {
    this.sessionId = sessionId; this.runId = null; this.sequence = -1; this.terminal = false;
    this.events = new Set(); this.runs = new Set();
  }
  convert(envelope) {
    const e = envelope;
    if (!e || e.schemaVersion !== 1 || !idOK(e.sessionId) || !idOK(e.runId) || !STATES.has(e.state)) return [];
    if (this.sessionId && e.sessionId !== this.sessionId) return [];
    if (e.sequence != null && (!Number.isSafeInteger(e.sequence) || e.sequence < 0 || e.sequence <= this.sequence)) return [];
    if (e.eventId && this.events.has(e.eventId)) return [];
    if (this.runId !== e.runId && this.runs.has(e.runId)) return [];
    if (this.runId === e.runId && this.terminal) return [];
    this.sessionId = e.sessionId;
    if (e.sequence != null) this.sequence = e.sequence;
    if (e.eventId) { this.events.add(e.eventId); if (this.events.size > 512) this.events.delete(this.events.values().next().value); }
    const base = { sessionId: e.sessionId, runId: e.runId, source: e.source || 'unknown' };
    const out = [];
    if (this.runId !== e.runId) {
      this.runId = e.runId; this.runs.add(e.runId); this.terminal = false;
      if (this.runs.size > 256) this.runs.delete(this.runs.values().next().value);
      const metadata = { sources: {} };
      for (const key of FIELDS) {
        const source = PROVENANCE.has(e.provenance?.[key]) ? e.provenance[key] : 'unknown';
        metadata[key] = source === 'unknown' ? null : safeText(e.metadata?.[key], key === 'task' ? 240 : 96);
        metadata.sources[key] = metadata[key] ? source : 'unknown';
      }
      metadata.fullTask = safeText(e.metadata?.fullTask, 8192);
      metadata.fullTaskTruncated = e.metadata?.fullTaskTruncated === true;
      out.push({ ...base, type: 'start', metadata });
    }
    if (!out.length || e.state !== 'working') out.push({ ...base, type: e.state });
    this.terminal = ['completed', 'cancelled', 'error'].includes(e.state);
    return out;
  }
}
module.exports = { EnvelopeBridge, metadataFor, safeText, idOK, STATES };
