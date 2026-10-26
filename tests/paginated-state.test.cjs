'use strict';
// Synthetic databases only: never open the user's CODEX_HOME or real history.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFS = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const moduleFile = path.join(__dirname, '../adapter/paginated-state.cjs');
assert.ok(syncFS.existsSync(moduleFile), 'an explicit read-only paginated metadata contract must exist');
const P = require(moduleFile);
const { createEntranceEvent, verifyEntranceTurn } = require('../adapter/entrance-event.cjs');
const now = Date.parse('2026-10-25T10:00:00Z');
function write(home, which, sql, ...params) {
  const db = new DatabaseSync(path.join(home, which === 'state' ? 'state_5.sqlite' : 'thread_history_1.sqlite'));
  try { return db.prepare(sql).run(...params); } finally { db.close(); }
}
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'summoning-paged-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('summoning-paged-test-'));
    await fs.rm(home, { recursive: true, force: true });
  });
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  state.exec(`CREATE TABLE threads(id TEXT PRIMARY KEY, cli_version ${options.versionType || 'TEXT'}, history_mode TEXT, source TEXT, name TEXT,
    title TEXT, preview TEXT, first_user_message TEXT, model TEXT, model_provider TEXT, reasoning_effort ${options.effortType || 'TEXT'});
    CREATE TABLE thread_spawn_edges(parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT);`);
  state.prepare('INSERT INTO threads(id,cli_version,history_mode,source,name,title,preview,first_user_message,model,model_provider,reasoning_effort) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('session-a', options.version || '0.164.0-alpha.11.1', options.mode || 'paginated', options.source || 'vscode', options.name === undefined ? '本地合成标题' : options.name,
      'DO_NOT_READ_TITLE', 'DO_NOT_READ_PREVIEW', 'DO_NOT_READ_PROMPT', 'DO_NOT_READ_CONFIGURED_MODEL', 'DO_NOT_READ_COMPANY', options.effort === undefined ? null : options.effort);
  state.close();
  const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
  history.exec(`CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, started_at INTEGER, root_turn_id TEXT,
    status TEXT, error_json TEXT, first_user_item_id TEXT, final_agent_item_id TEXT, ${options.historyPk || 'PRIMARY KEY(thread_id,turn_id)'});`);
  if (!options.noTurn) history.prepare('INSERT INTO thread_turns(thread_id,turn_id,rollout_ordinal,started_at,root_turn_id,status,error_json) VALUES(?,?,?,?,?,?,?)')
    .run('session-a', 'turn-a', 10, options.startedAt === undefined ? now / 1000 : options.startedAt,
      options.rootTurnId === undefined ? 'turn-a' : options.rootTurnId, 'inProgress', 'DO_NOT_READ_ERROR');
  history.close();
  const event = createEntranceEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'session-a', turn_id: 'turn-a', model: 'gpt-5.6-luna', transcript_path: null }, { now });
  return { home, event, options: { codexHome: home, now } };
}
test('known paginated root with null transcript verifies without fabricated offset or reasoning', async t => {
  const f = await fixture(t), v = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.equal(v.verified, true); assert.equal(v.sourceKind, 'codex-paginated-metadata');
  assert.equal(v.sessionId, 'session-a'); assert.equal(v.turnId, 'turn-a'); assert.equal(v.startedAtMs, now);
  assert.match(v.sourceRevision, /^[a-f0-9]{64}$/); assert.equal(Object.hasOwn(v, 'offset'), false);
  assert.deepEqual(v.title, { value: '本地合成标题', source: 'codex-paginated-name' });
  assert.equal(v.reasoning.source, 'unknown'); assert.equal(v.reasoning.value, null); assert.equal(v.contextMissing, false);
  const wrapped = await verifyEntranceTurn(f.event, f.options); assert.equal(wrapped.verified, true);
  assert.equal(P.verificationAnchor(v), P.verificationAnchor(wrapped));
});
test('three observed created versions work, but future and unverified imported versions fail closed', async t => {
  const supported = ['0.163.0-alpha.10.2', '0.163.0-alpha.11', '0.164.0-alpha.11.1'];
  for (const version of [...supported, '0.164.0-alpha.11.2', '0.155.0-alpha.9.2']) {
    const f = await fixture(t, { version }), v = await P.verifyPaginatedEntrance(f.event, f.options);
    assert.equal(v.verified, supported.includes(version), version);
    if (!v.verified) assert.equal(v.reason, 'version-mismatch');
  }
});
test('explicit paginated storage uses its own contract even when a transcript string exists', async t => {
  const f = await fixture(t), event = { ...f.event, transcriptPath: path.join(f.home, 'sessions', 'rollout-unused.jsonl') };
  assert.equal((await verifyEntranceTurn(event, f.options)).sourceKind, 'codex-paginated-metadata');
  write(f.home, 'state', 'UPDATE threads SET cli_version=?', '0.165.0-unverified');
  const rejected = await verifyEntranceTurn(event, f.options); assert.equal(rejected.verified, false); assert.equal(rejected.reason, 'version-mismatch');
});
test('latest root ordering rejects prior, foreign and continuation requests', async t => {
  const f = await fixture(t);
  write(f.home, 'history', 'INSERT INTO thread_turns(thread_id,turn_id,rollout_ordinal,started_at,root_turn_id) VALUES(?,?,?,?,?)', 'session-a', 'turn-b', 11, now / 1000, 'turn-b');
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'latest-turn-mismatch');
  assert.equal((await P.verifyPaginatedEntrance({ ...f.event, sessionId: 'other-session' }, f.options)).verified, false);
  write(f.home, 'history', 'UPDATE thread_turns SET root_turn_id=? WHERE turn_id=?', 'turn-a', 'turn-b');
  assert.equal((await P.verifyPaginatedEntrance({ ...f.event, turnId: 'turn-b' }, f.options)).reason, 'paged-source-unverified');
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).verified, true, 'a later continuation does not replace its genuine root');
});
test('unproven source, spawn-edge child and null or mismatched root identity are rejected', async t => {
  for (const source of ['cli', 'subagent', '{"subagent":{}}']) {
    const f = await fixture(t, { source }); assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'paged-source-unverified');
  }
  for (const rootTurnId of [null, 'another-root']) {
    const f = await fixture(t, { rootTurnId }); assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'paged-source-unverified');
  }
  const f = await fixture(t); write(f.home, 'state', 'INSERT INTO thread_spawn_edges VALUES(?,?,?)', 'parent', 'session-a', 'completed');
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'paged-source-unverified');
});
test('required SQL column types and primary key positions are exact', async t => {
  for (const bad of [{ versionType: 'INTEGER' }, { historyPk: 'PRIMARY KEY(thread_id,rollout_ordinal)' }]) {
    const f = await fixture(t, bad); assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'paged-schema-mismatch');
  }
  const f = await fixture(t); write(f.home, 'state', 'ALTER TABLE threads RENAME COLUMN history_mode TO unknown_mode');
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'paged-schema-mismatch');
});
test('source start is safe epoch seconds, not receive time, milliseconds or missing data', async t => {
  for (const [startedAt, reason] of [[null, 'source-time-unavailable'], ['invalid', 'source-time-unavailable'],
    [now, 'source-expired'], [now / 1000 - 121, 'source-expired'], [now / 1000 + 6, 'source-expired']]) {
    const f = await fixture(t, { startedAt }); assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, reason);
  }
});
test('missing database and late turn remain explicit bounded-retry failures', async t => {
  const f = await fixture(t, { noTurn: true });
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'source-not-ready');
  write(f.home, 'history', 'INSERT INTO thread_turns(thread_id,turn_id,rollout_ordinal,started_at,root_turn_id) VALUES(?,?,?,?,?)', 'session-a', 'turn-a', 1, now / 1000, 'turn-a');
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).verified, true);
  await fs.unlink(path.join(f.home, 'thread_history_1.sqlite'));
  assert.equal((await P.verifyPaginatedEntrance(f.event, f.options)).reason, 'source-not-ready');
  assert.equal(syncFS.existsSync(path.join(f.home, 'thread_history_1.sqlite')), false, 'readonly verification must never create a missing DB');
});
test('name is the only title source and metadata status changes do not change the source anchor', async t => {
  const f = await fixture(t, { name: '' }), first = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.deepEqual(first.title, { value: null, source: 'pending' });
  write(f.home, 'state', 'UPDATE threads SET name=?', '迟到标题');
  write(f.home, 'history', 'UPDATE thread_turns SET status=?', 'completed');
  const second = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.equal(second.title.value, '迟到标题'); assert.equal(P.verificationAnchor(first), P.verificationAnchor(second));
  assert.doesNotMatch(JSON.stringify(second), /DO_NOT_READ|xhigh/);
  write(f.home, 'state', 'UPDATE threads SET name=?', '长标题'.repeat(1000));
  const long = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.equal(Array.from(long.title.value).length, 240); assert.match(long.title.value, /…$/);
  assert.equal(P.verificationAnchor(first), P.verificationAnchor(long));
});
test('parameterized metadata-only SQL and readonly connections leave existing fixtures unchanged', async t => {
  const f = await fixture(t), statements = [], opened = [], before = {};
  for (const name of ['state_5.sqlite', 'thread_history_1.sqlite']) before[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(f.home, name))).digest('hex');
  const names = await fs.readdir(f.home);
  const openDatabase = (file, options) => {
    opened.push(options); const db = new DatabaseSync(file, options);
    assert.throws(() => db.exec('CREATE TABLE forbidden_write(x)'), /readonly|read.only/i);
    return { exec(sql) { statements.push(sql); return db.exec(sql); }, prepare(sql) { statements.push(sql); return db.prepare(sql); }, close() { db.close(); } };
  };
  assert.equal((await P.verifyPaginatedEntrance(f.event, { ...f.options, openDatabase })).verified, true);
  assert.equal(opened.length, 2); assert.ok(opened.every(x => x.readOnly === true && x.allowExtension === false));
  assert.ok(statements.every(sql => /^SELECT\b|^PRAGMA busy_timeout\s*=\s*100\s*;?$/i.test(sql)));
  assert.doesNotMatch(statements.join('\n'), /\b(?:items|error_json|preview|first_user_message|title|model|model_provider)\b/i);
  assert.doesNotMatch(statements.join('\n'), /session-a|turn-a/);
  for (const name of Object.keys(before)) assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(f.home, name))).digest('hex'), before[name]);
  assert.deepEqual(await fs.readdir(f.home), names);
});
test('a changed keyed source tuple during verification is never returned as verified', async t => {
  const f = await fixture(t); let changed = false;
  const openDatabase = (file, options) => {
    const db = new DatabaseSync(file, options);
    return { exec: sql => db.exec(sql), close: () => db.close(), prepare(sql) {
      const statement = db.prepare(sql);
      return { get: (...args) => statement.get(...args), all(...args) {
        const rows = statement.all(...args);
        if (!changed && /ORDER BY rollout_ordinal/.test(sql)) { changed = true; write(f.home, 'history', 'UPDATE thread_turns SET rollout_ordinal=11'); }
        return rows;
      } };
    } };
  };
  assert.equal((await P.verifyPaginatedEntrance(f.event, { ...f.options, openDatabase })).reason, 'source-changed');
});
test('malformed IDs and unsupported path namespaces fail before opening databases', async t => {
  const f = await fixture(t); let opened = 0; const openDatabase = () => { opened++; throw Error('must not open'); };
  assert.equal((await P.verifyPaginatedEntrance({ ...f.event, sessionId: "bad';SELECT" }, { ...f.options, openDatabase })).reason, 'invalid-source');
  if (process.platform === 'win32') for (const codexHome of ['\\\\server\\share', '\\\\?\\GLOBALROOT\\Device\\private', '\\\\.\\C:\\private']) {
    assert.equal((await P.verifyPaginatedEntrance(f.event, { ...f.options, codexHome, openDatabase })).reason, 'invalid-source');
  }
  assert.equal(opened, 0);
});
test('directory reparse points cannot redirect the fixed database source', async t => {
  const f = await fixture(t), link = path.join(f.home, 'redirect');
  try { await fs.symlink(f.home, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('directory symlink/junction unavailable'); return; } throw e; }
  assert.equal((await P.verifyPaginatedEntrance(f.event, { ...f.options, codexHome: link })).reason, 'invalid-source');
});
test('anchors are typed, bound to immutable identity and never reinterpret ordinal as offset', async t => {
  const f = await fixture(t), v = await P.verifyPaginatedEntrance(f.event, f.options), anchor = P.verificationAnchor(v);
  assert.match(anchor, /^codex-paginated-metadata:[a-f0-9]{64}$/);
  assert.equal(P.verificationAnchor({ ...v, sourceRevision: null, offset: 10 }), null);
  assert.notEqual(P.verificationAnchor({ ...v, sourceRevision: 'a'.repeat(64) }), anchor);
  assert.notEqual(P.verificationAnchor({ ...v, startedAtMs: now + 1000 }), anchor);
  const legacy = { verified: true, sessionId: 'session-a', turnId: 'turn-a', startedAtMs: now, offset: 0 };
  assert.match(P.verificationAnchor(legacy), /^codex-rollout:[a-f0-9]{64}$/);
  assert.equal(P.verificationAnchor({ ...legacy, sourceKind: 'unverified-provider' }), null);
  assert.equal(P.verificationAnchor({ ...legacy, offset: '10' }), null);
});
test('same-session stable thread effort is a configured snapshot, never current reported reasoning', async t => {
  const f = await fixture(t, { effort: 'high' }), v = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.equal(v.verified, true);
  assert.deepEqual(v.reasoning, { value: 'high', source: 'configured', storageSource: 'codex-thread-config',
    sessionId: 'session-a', observedAt: now, model: null, contextOffset: null });
  const anchor = P.verificationAnchor(v);
  write(f.home, 'state', 'UPDATE threads SET reasoning_effort=?', 'low');
  const later = await P.verifyPaginatedEntrance(f.event, f.options);
  assert.equal(later.reasoning.value, 'low'); assert.equal(later.reasoning.source, 'configured');
  assert.equal(P.verificationAnchor(later), anchor, 'mutable configured effort is not source identity');
});
test('unavailable or invalid optional effort does not block the verified root', async t => {
  for (const effort of [null, '', 'unrecognized', 42]) {
    const f = await fixture(t, { effort }), v = await P.verifyPaginatedEntrance(f.event, f.options);
    assert.equal(v.verified, true); assert.equal(v.reasoning.source, 'unknown');
  }
  const wrong = await fixture(t, { effort: 'high', effortType: 'INTEGER' });
  const wrongResult = await P.verifyPaginatedEntrance(wrong.event, wrong.options);
  assert.equal(wrongResult.verified, true); assert.equal(wrongResult.reasoning.source, 'unknown');
  const missing = await fixture(t, { effort: 'high' });
  write(missing.home, 'state', 'ALTER TABLE threads DROP COLUMN reasoning_effort');
  const missingResult = await P.verifyPaginatedEntrance(missing.event, missing.options);
  assert.equal(missingResult.verified, true); assert.equal(missingResult.reasoning.source, 'unknown');
});
test('configuration changing between metadata reads degrades only the optional effort', async t => {
  const f = await fixture(t, { effort: 'high' }); let changed = false;
  const openDatabase = (file, options) => {
    const db = new DatabaseSync(file, options);
    return { exec: sql => db.exec(sql), close: () => db.close(), prepare(sql) {
      const statement = db.prepare(sql);
      return { all: (...args) => statement.all(...args), get(...args) {
        const row = statement.get(...args);
        if (!changed && /FROM threads WHERE id/.test(sql)) { changed = true; write(f.home, 'state', 'UPDATE threads SET reasoning_effort=?', 'low'); }
        return row;
      } };
    } };
  };
  const v = await P.verifyPaginatedEntrance(f.event, { ...f.options, openDatabase });
  assert.equal(v.verified, true); assert.equal(v.reasoning.source, 'unknown');
});
