'use strict';
// Version-scoped local compatibility, not an official Codex API. Only fixed
// metadata tables/columns are queried; no messages, configured model or auth.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { idOK, safeText } = require('./envelope.cjs');
// Observed thread creation versions under the checked paginated schema. They
// are not the current daemon version and do not establish an official API.
const PAGED_VERSIONS = Object.freeze(['0.163.0-alpha.10.2', '0.163.0-alpha.11', '0.164.0-alpha.11.1']);
const REQUIRED = Object.freeze({
  threads: { id: ['TEXT', 1], cli_version: ['TEXT', 0], history_mode: ['TEXT', 0], source: ['TEXT', 0], name: ['TEXT', 0] },
  thread_spawn_edges: { parent_thread_id: ['TEXT', 0], child_thread_id: ['TEXT', 1], status: ['TEXT', 0] },
  thread_turns: { thread_id: ['TEXT', 1], turn_id: ['TEXT', 2], rollout_ordinal: ['INTEGER', 0], started_at: ['INTEGER', 0], root_turn_id: ['TEXT', 0] },
});
const SQL = Object.freeze({
  tableType: 'SELECT type FROM sqlite_schema WHERE name = ? LIMIT 1',
  columns: 'SELECT name, type, pk FROM pragma_table_info(?)',
  thread: 'SELECT id, cli_version, history_mode, source, substr(name, 1, 8192) AS name FROM threads WHERE id = ? LIMIT 1',
  threadConfigured: 'SELECT id, cli_version, history_mode, source, substr(name, 1, 8192) AS name, reasoning_effort FROM threads WHERE id = ? LIMIT 1',
  child: 'SELECT child_thread_id FROM thread_spawn_edges WHERE child_thread_id = ? LIMIT 1',
  turn: 'SELECT thread_id, turn_id, rollout_ordinal, started_at, root_turn_id FROM thread_turns WHERE thread_id = ? AND turn_id = ? LIMIT 1',
  latestRoots: 'SELECT thread_id, turn_id, rollout_ordinal, started_at, root_turn_id FROM thread_turns WHERE thread_id = ? AND root_turn_id = turn_id ORDER BY rollout_ordinal DESC LIMIT 2',
});
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = (reason, applicable = true) => ({ verified: false, reason, applicable });
const fail = reason => { throw Object.assign(new Error(reason), { pagedReason: reason }); };
function localPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) return null;
  if (process.platform === 'win32') {
    if (value.startsWith('\\\\?\\')) { if (!/^\\\\\?\\[A-Za-z]:\\/.test(value)) return null; value = value.slice(4); }
    if (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':')) return null;
  } else if (!path.isAbsolute(value)) return null;
  return path.resolve(value);
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.ino !== 0n; }
async function sourceFile(home, basename) {
  const homeStat = await fs.lstat(home, { bigint: true });
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) fail('invalid-source');
  const file = path.join(home, basename), stat = await fs.lstat(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino === 0n) fail('invalid-source');
  const realHome = localPath(await fs.realpath(home)), realFile = localPath(await fs.realpath(file));
  const relative = realHome && realFile ? path.relative(realHome, realFile) : null;
  if (!relative || relative.includes(path.sep) || relative.startsWith('..') || path.isAbsolute(relative)
    || (process.platform === 'win32' ? relative.toLowerCase() !== basename.toLowerCase() : relative !== basename)) fail('invalid-source');
  const realStat = await fs.lstat(realFile, { bigint: true });
  if (!realStat.isFile() || realStat.isSymbolicLink() || !sameFile(stat, realStat)) fail('source-changed');
  return { home, file, basename, stat, realFile };
}
async function unchangedFile(guard) {
  const after = await sourceFile(guard.home, guard.basename);
  if (!sameFile(guard.stat, after.stat) || guard.realFile !== after.realFile) fail('source-changed');
}
function openReadonly(file, options) {
  // Loading this module for the silent Hook must not load experimental SQLite
  // or emit its warning. Only actual metadata verification loads the builtin.
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(file, options);
}
function schema(db, table) {
  if (db.prepare(SQL.tableType).get(table)?.type !== 'table') fail('paged-schema-mismatch');
  const columns = db.prepare(SQL.columns).all(table), required = REQUIRED[table];
  if (!Array.isArray(columns) || columns.length > 256) fail('paged-schema-mismatch');
  for (const [name, [type, pk]] of Object.entries(required)) {
    const column = columns.find(row => row.name === name);
    if (!column || column.type !== type || column.pk !== pk) fail('paged-schema-mismatch');
  }
  if (columns.some(row => row.pk > 0 && (!Object.hasOwn(required, row.name) || required[row.name][1] !== row.pk))) fail('paged-schema-mismatch');
  return columns;
}
function sourceTuple(thread, turn, isChild) {
  return [thread?.id, thread?.cli_version, thread?.history_mode, thread?.source, !!isChild,
    turn?.thread_id, turn?.turn_id, turn?.root_turn_id, turn?.rollout_ordinal, turn?.started_at];
}
function validateThread(thread, event) {
  if (!thread || thread.id !== event.sessionId) fail('session-mismatch');
  if (!PAGED_VERSIONS.includes(thread.cli_version)) fail('version-mismatch');
  if (thread.history_mode !== 'paginated' || thread.source !== 'vscode' || thread.name != null && typeof thread.name !== 'string') fail('paged-source-unverified');
}
function validateTurn(turn, event, now) {
  if (turn.thread_id !== event.sessionId || turn.turn_id !== event.turnId) fail('session-mismatch');
  if (turn.root_turn_id !== turn.turn_id || !Number.isSafeInteger(turn.rollout_ordinal) || turn.rollout_ordinal < 0) fail('paged-source-unverified');
  if (!Number.isSafeInteger(turn.started_at) || turn.started_at < 0 || !Number.isSafeInteger(turn.started_at * 1000)) fail('source-time-unavailable');
  const startedAtMs = turn.started_at * 1000;
  if (now - startedAtMs > 120000 || startedAtMs - now > 5000) fail('source-expired');
  return startedAtMs;
}
function latest(db, sessionId) {
  const roots = db.prepare(SQL.latestRoots).all(sessionId);
  if (roots.length > 1 && roots[0].rollout_ordinal === roots[1].rollout_ordinal) fail('paged-source-unverified');
  return roots[0] || null;
}
async function verifyPaginatedEntrance(event, { codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now(), openDatabase = openReadonly } = {}) {
  let state, history, applicable = false;
  try {
    if (!idOK(event?.sessionId) || !idOK(event?.turnId) || !Number.isFinite(now)) return denied('invalid-source');
    const home = localPath(codexHome); if (!home) return denied('invalid-source');
    const stateGuard = await sourceFile(home, 'state_5.sqlite'); applicable = true;
    const openOptions = { readOnly: true, allowExtension: false, timeout: 100 };
    state = openDatabase(stateGuard.file, openOptions); await unchangedFile(stateGuard);
    state.exec('PRAGMA busy_timeout = 100');
    const threadColumns = schema(state, 'threads'); schema(state, 'thread_spawn_edges');
    // Optional configuration is not a per-turn observation. An absent or
    // changed column disables this field, never the already known root route.
    const effortColumn = threadColumns.find(column => column.name === 'reasoning_effort');
    const effortAvailable = effortColumn?.type === 'TEXT' && effortColumn.pk === 0;
    const threadSQL = effortAvailable ? SQL.threadConfigured : SQL.thread;
    const firstThread = state.prepare(threadSQL).get(event.sessionId);
    if (!firstThread) return denied('source-not-ready', false);
    // A real legacy transcript remains independently checked by its existing
    // contract. Unknown/future paginated versions never fall through to it.
    if (firstThread.history_mode !== 'paginated') return denied('paged-source-unverified', false);
    validateThread(firstThread, event);
    const firstChild = state.prepare(SQL.child).get(event.sessionId);
    if (firstChild) return denied('paged-source-unverified');
    const historyGuard = await sourceFile(home, 'thread_history_1.sqlite');
    history = openDatabase(historyGuard.file, openOptions); await unchangedFile(historyGuard);
    history.exec('PRAGMA busy_timeout = 100'); schema(history, 'thread_turns');
    const firstTurn = history.prepare(SQL.turn).get(event.sessionId, event.turnId);
    if (!firstTurn) return denied('source-not-ready');
    const startedAtMs = validateTurn(firstTurn, event, now), firstLatest = latest(history, event.sessionId);
    if (!firstLatest) return denied('source-not-ready');
    if (firstLatest.turn_id !== event.turnId) return denied('latest-turn-mismatch');
    const secondThread = state.prepare(threadSQL).get(event.sessionId), secondChild = state.prepare(SQL.child).get(event.sessionId);
    const secondTurn = history.prepare(SQL.turn).get(event.sessionId, event.turnId), secondLatest = latest(history, event.sessionId);
    const firstTuple = sourceTuple(firstThread, firstTurn, firstChild), secondTuple = sourceTuple(secondThread, secondTurn, secondChild);
    if (!secondThread || !secondTurn || !secondLatest || hash(firstTuple) !== hash(secondTuple)
      || hash(sourceTuple(firstThread, firstLatest, firstChild)) !== hash(sourceTuple(secondThread, secondLatest, secondChild))) return denied('source-changed');
    await unchangedFile(stateGuard); await unchangedFile(historyGuard);
    const value = safeText(firstThread.name, 240);
    const configured = effortAvailable && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(firstThread.reasoning_effort)
      && firstThread.reasoning_effort === secondThread.reasoning_effort && Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000;
    const reasoning = configured ? { value: firstThread.reasoning_effort, source: 'configured', storageSource: 'codex-thread-config',
      sessionId: event.sessionId, observedAt: now, model: null, contextOffset: null }
      : { value: null, source: 'unknown', model: null, contextOffset: null };
    return { verified: true, applicable: true, sessionId: event.sessionId, turnId: event.turnId, startedAtMs,
      sourceKind: 'codex-paginated-metadata', sourceRevision: hash([firstTuple, stateGuard.stat.dev.toString(), stateGuard.stat.ino.toString(), historyGuard.stat.dev.toString(), historyGuard.stat.ino.toString()]),
      title: { value, source: value ? 'codex-paginated-name' : 'pending' },
      reasoning, contextMissing: false };
  } catch (e) {
    const reason = e.pagedReason || (e.code === 'ENOENT' || e.errcode === 5 || e.errcode === 6 ? 'source-not-ready' : e.code === 'ERR_SQLITE_ERROR' ? 'paged-schema-mismatch' : 'paged-state-unavailable');
    return denied(reason, ['invalid-source', 'paged-schema-mismatch'].includes(reason) || applicable);
  } finally { try { history?.close(); } catch {} try { state?.close(); } catch {} }
}
function verificationAnchor(value) {
  if (value?.verified !== true || !idOK(value.sessionId) || !idOK(value.turnId) || !Number.isFinite(value.startedAtMs)
    || value.startedAtMs < 0 || value.startedAtMs > Number.MAX_SAFE_INTEGER) return null;
  const kind = value.sourceKind || 'codex-rollout';
  if (kind === 'codex-paginated-metadata') {
    if (typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceRevision)) return null;
    return kind + ':' + hash([kind, value.sessionId, value.turnId, value.startedAtMs, value.sourceRevision]);
  }
  if (kind !== 'codex-rollout' || !Number.isSafeInteger(value.offset) || value.offset < 0) return null;
  return kind + ':' + hash([kind, value.sessionId, value.turnId, value.startedAtMs, value.offset]);
}
module.exports = { PAGED_VERSIONS, SQL, verifyPaginatedEntrance, verificationAnchor };
