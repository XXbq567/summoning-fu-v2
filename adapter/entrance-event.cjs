'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { metadataFor, safeText, idOK } = require('./envelope.cjs');
const { verifyPaginatedEntrance, verificationAnchor } = require('./paginated-state.cjs');
const MAX_EVENT_BYTES = 65536;
const EVENT_TTL_MS = 120000;
const MAX_SESSION_HEADER_BYTES = 1024 * 1024;
// Exact local contracts only. An application upgrade never implies future-version compatibility.
const SUPPORTED_CLI_VERSIONS = Object.freeze(['0.163.0-alpha.10.2', '0.163.0-alpha.11']);
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
function localCanonicalForm(value) {
  if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) return null;
  if (process.platform !== 'win32') return path.resolve(value);
  // Only the documented local drive namespace is equivalent to a normal DOS path.
  // UNC, device namespaces and GLOBALROOT are deliberately unsupported here.
  if (value.startsWith('\\\\?\\')) {
    if (!/^\\\\\?\\[A-Za-z]:\\/.test(value)) return null;
    value = value.slice(4);
  }
  const resolved = path.resolve(value);
  if (!/^[A-Za-z]:\\/.test(resolved) || resolved.slice(2).includes(':')) return null;
  return resolved;
}
async function readSessionIdentity(handle, fileSize) {
  const chunks = []; let offset = 0;
  while (offset < Math.min(fileSize, MAX_SESSION_HEADER_BYTES)) {
    const chunk = Buffer.alloc(Math.min(16384, fileSize - offset, MAX_SESSION_HEADER_BYTES - offset));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (!bytesRead) break;
    const newline = chunk.subarray(0, bytesRead).indexOf(10);
    chunks.push(chunk.subarray(0, newline < 0 ? bytesRead : newline));
    offset += bytesRead;
    if (newline >= 0) {
      // The rest of session_meta (including instructions) is never returned, logged or persisted.
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return { type: record.type, id: record.payload?.id, version: record.payload?.cli_version };
    }
  }
  return { reason: offset >= MAX_SESSION_HEADER_BYTES ? 'source-header-too-large' : 'source-not-ready' };
}
function eventIdFor(sessionId, turnId) { return crypto.createHash('sha256').update(sessionId + '\n' + turnId).digest('hex'); }
function createEntranceEvent(input, { title = { value: null, source: 'pending' }, now = Date.now() } = {}) {
  if (!input || input.hook_event_name !== 'UserPromptSubmit' || !idOK(input.session_id) || !idOK(input.turn_id)) return null;
  const value = title.source === 'codex-session-index' ? safeText(title.value, 240) : null;
  const context = metadataFor({ model: input.model, cwd: input.cwd, prompt: value });
  return { schemaVersion: 1, eventId: eventIdFor(input.session_id, input.turn_id), sessionId: input.session_id, turnId: input.turn_id,
    kind: 'codex-user-prompt-submit', source: 'codex-user-prompt-submit', createdAt: new Date(now).toISOString(),
    title: { value, source: value ? 'codex-session-index' : 'pending' },
    transcriptPath: typeof input.transcript_path === 'string' && input.transcript_path.length <= 4096 && !/[\x00-\x1f]/.test(input.transcript_path) ? input.transcript_path : null,
    ...context };
}
function validateEntranceEvent(event, { now = Date.now() } = {}) {
  const e = event;
  if (!e || e.schemaVersion !== 1 || e.kind !== 'codex-user-prompt-submit' || e.source !== e.kind || !idOK(e.sessionId) || !idOK(e.turnId)) return null;
  if (e.eventId !== eventIdFor(e.sessionId, e.turnId)) return null;
  const created = Date.parse(e.createdAt);
  if (!Number.isFinite(created) || now - created > EVENT_TTL_MS || created - now > 5000) return null;
  if (!e.title || !['pending', 'codex-session-index'].includes(e.title.source)) return null;
  // Reconstruct the allowlist; never forward arbitrary metadata or claimed provenance.
  const clean = createEntranceEvent({ hook_event_name: 'UserPromptSubmit', session_id: e.sessionId, turn_id: e.turnId,
    transcript_path: e.transcriptPath, model: e.provenance?.model === 'reported' ? e.metadata?.model : null,
    cwd: e.provenance?.environment === 'reported' ? e.metadata?.environment : null }, { title: e.title, now: created });
  return clean;
}
async function readEntranceFile(file, { dataRoot, now = Date.now(), onDiagnostic } = {}) {
  let handle;
  const reject = reason => { try { onDiagnostic?.({ kind: 'entrance-read-rejected', reason }); } catch {} return null; };
  const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.ino !== 0n;
  const plainDirectory = s => s.isDirectory() && !s.isSymbolicLink();
  try {
    const root = localCanonicalForm(dataRoot), target = localCanonicalForm(file);
    if (!root || !target || !/^[a-f0-9]{64}\.json$/.test(path.basename(target))) return reject('event-path-invalid');
    const directory = path.join(root, 'entrance-events'), targetParent = path.dirname(target);
    if (path.basename(targetParent).toLowerCase() !== 'entrance-events') return reject('event-path-invalid');
    // Store-app virtualization and a normal process may name the same physical directory differently.
    // Authorize the resolved physical parent, never an arbitrary alternate data root.
    const rootStat = await fs.lstat(root, { bigint: true }), parentStat = await fs.lstat(directory, { bigint: true }), targetParentStat = await fs.lstat(targetParent, { bigint: true }), stat = await fs.lstat(target);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !parentStat.isDirectory() || parentStat.isSymbolicLink() || !targetParentStat.isDirectory() || targetParentStat.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) return reject('event-nonregular');
    if (stat.size > MAX_EVENT_BYTES) return reject('event-too-large');
    const realRoot = localCanonicalForm(await fs.realpath(root)), realDir = localCanonicalForm(await fs.realpath(directory)), realParent = localCanonicalForm(await fs.realpath(targetParent)), realFile = localCanonicalForm(await fs.realpath(target));
    if (!realRoot || !realDir || !realParent || !realFile || !sameIdentity(targetParentStat, parentStat)) return reject('event-outside-root');
    // MSIX can preserve different realpath strings for one directory. Exact 64-bit identity
    // is the boundary; resolved parents must still be ordinary directories of that identity.
    const resolvedRoot = await fs.lstat(realRoot, { bigint: true }), resolvedOwner = await fs.lstat(path.dirname(realDir), { bigint: true });
    const resolvedDir = await fs.lstat(realDir, { bigint: true }), resolvedParent = await fs.lstat(realParent, { bigint: true }), resolvedFileParent = await fs.lstat(path.dirname(realFile), { bigint: true });
    if (![resolvedRoot, resolvedOwner, resolvedDir, resolvedParent, resolvedFileParent].every(plainDirectory) || !sameIdentity(resolvedRoot, rootStat) || !sameIdentity(resolvedOwner, rootStat) || ![resolvedDir, resolvedParent, resolvedFileParent].every(s => sameIdentity(s, parentStat))) return reject('event-outside-root');
    handle = await fs.open(target, 'r'); const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return reject('event-file-changed');
    if (opened.size > MAX_EVENT_BYTES) return reject('event-too-large');
    const buffer = Buffer.alloc(opened.size + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_EVENT_BYTES) return reject('event-too-large');
    let raw; try { raw = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); } catch { return reject('event-json-invalid'); }
    const event = validateEntranceEvent(raw, { now });
    if (!event) return reject('event-invalid');
    return path.basename(target) === event.eventId + '.json' ? event : reject('event-id-mismatch');
  } catch { return reject('event-unavailable'); }
  finally { await handle?.close().catch(() => {}); }
}
async function verifyEntranceTurn(event, { codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now() } = {}) {
  const paginated = await verifyPaginatedEntrance(event, { codexHome, now });
  if (paginated.applicable === true || event?.transcriptPath == null) return paginated;
  let handle;
  const no = reason => ({ verified: false, reason });
  try {
    if (!idOK(event?.sessionId) || !idOK(event?.turnId) || typeof event.transcriptPath !== 'string') return no('invalid-source');
    const home = localCanonicalForm(codexHome), file = localCanonicalForm(event.transcriptPath);
    if (!home || !file) return no('invalid-source');
    const root = path.join(home, 'sessions');
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^rollout-.+\.jsonl$/i.test(path.basename(file))) return no('invalid-source');
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink()) return no('invalid-source');
    const realRoot = localCanonicalForm(await fs.realpath(root)), realFile = localCanonicalForm(await fs.realpath(file));
    if (!realRoot || !realFile) return no('invalid-source');
    const rel = path.relative(realRoot, realFile);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return no('invalid-source');
    handle = await fs.open(file, 'r'); const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== s.dev || opened.ino !== s.ino) return no('source-changed');
    const meta = await readSessionIdentity(handle, opened.size);
    if (meta.reason) return no(meta.reason);
    if (meta.type !== 'session_meta' || meta.id !== event.sessionId) return no('session-mismatch');
    if (!SUPPORTED_CLI_VERSIONS.includes(meta.version)) return no('version-mismatch');
    const begin = Math.max(0, opened.size - 4 * 1024 * 1024), bytes = Buffer.alloc(opened.size - begin);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, begin);
    let cursor = begin ? bytes.indexOf(10) + 1 : 0, latest = null, context = null, contextSeen = false, contextInvalid = false;
    if (begin && cursor === 0) return no('source-not-ready');
    while (cursor < bytesRead) {
      const end = bytes.indexOf(10, cursor); if (end < 0 || end >= bytesRead) break;
      const line = bytes.subarray(cursor, end);
      const mayContainContext = line.includes(Buffer.from('turn_context'));
      // Never retain a reported value across a possible conflicting context we cannot parse.
      // The root turn remains valid and may still display with unknown reasoning.
      if (latest && mayContainContext && line.length > MAX_SESSION_HEADER_BYTES) { contextInvalid = true; contextSeen = true; }
      if (line.length <= MAX_SESSION_HEADER_BYTES && (line.includes(Buffer.from('task_started')) || mayContainContext)) {
        let row; try { row = JSON.parse(line.toString('utf8')); } catch { if (latest && mayContainContext) { contextInvalid = true; contextSeen = true; } }
        const p = row?.payload;
        if (line.length <= 65536 && row?.type === 'event_msg' && p?.type === 'task_started' && idOK(p.turn_id) && (!p.root_turn_id || p.root_turn_id === p.turn_id) && !p.turn_attribution?.parent_turn_id && !p.turn_attribution?.initiating_agent_path) {
          latest = { turnId: p.turn_id, offset: begin + cursor, startedAtMs: Number.isFinite(p.started_at) ? p.started_at * 1000 : null };
          context = null; contextSeen = false; contextInvalid = false;
        } else if (row?.type === 'turn_context' && latest && p?.turn_id === latest.turnId) {
          contextSeen = true;
          const eligible = (!p.root_turn_id || p.root_turn_id === latest.turnId) && !p.parent_turn_id && !p.turn_attribution?.parent_turn_id && !p.turn_attribution?.initiating_agent_path && p.model === event.metadata?.model && event.provenance?.model === 'reported' && REASONING_EFFORTS.has(p.effort);
          if (!eligible || (context && (context.value !== p.effort || context.model !== p.model))) contextInvalid = true;
          else if (!context) context = { value: p.effort, source: 'reported', model: p.model, contextOffset: begin + cursor };
        }
      }
      cursor = end + 1;
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return no('source-changed');
    if (!latest) return no('source-not-ready');
    if (latest.turnId !== event.turnId) return no('latest-turn-mismatch');
    if (latest.startedAtMs == null) return no('source-time-unavailable');
    if (now - latest.startedAtMs > EVENT_TTL_MS || latest.startedAtMs - now > 5000) return no('source-expired');
    const reasoning = context && !contextInvalid ? context : { value: null, source: 'unknown', model: null, contextOffset: null };
    return { verified: true, sourceKind: 'codex-rollout', sessionId: meta.id, ...latest, reasoning, contextMissing: !contextSeen };
  } catch { return no('source-unavailable'); }
  finally { await handle?.close().catch(() => {}); }
}
function applyVerifiedReasoning(event, verification) {
  const v = verification, r = v?.reasoning;
  const sameTurn = v?.verified === true && v.sessionId === event?.sessionId && v.turnId === event?.turnId;
  const reported = sameTurn && (v.sourceKind == null || v.sourceKind === 'codex-rollout') && r?.source === 'reported' && REASONING_EFFORTS.has(r.value) && event.provenance?.model === 'reported' && r.model === event.metadata?.model && Number.isSafeInteger(v.offset) && Number.isSafeInteger(r.contextOffset) && r.contextOffset > v.offset;
  const configured = sameTurn && v.sourceKind === 'codex-paginated-metadata' && !!verificationAnchor(v)
    && r?.source === 'configured' && r.storageSource === 'codex-thread-config' && r.sessionId === event.sessionId
    && REASONING_EFFORTS.has(r.value) && r.model === null && r.contextOffset === null
    && Number.isSafeInteger(r.observedAt) && r.observedAt >= 0 && r.observedAt <= 8640000000000000
    && r.observedAt >= v.startedAtMs - 5000 && r.observedAt - v.startedAtMs <= EVENT_TTL_MS;
  const source = reported ? 'reported' : configured ? 'configured' : 'unknown';
  return { ...event, metadata: { ...event?.metadata, reasoning: source === 'unknown' ? null : r.value }, provenance: { ...event?.provenance, reasoning: source } };
}
module.exports = { createEntranceEvent, validateEntranceEvent, readEntranceFile, verifyEntranceTurn, applyVerifiedReasoning, eventIdFor, MAX_EVENT_BYTES, EVENT_TTL_MS, SUPPORTED_CLI_VERSIONS };
