'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let RolloutAdapter, EnvelopeBridge, HookAdapter, sanitizeHook;
try { ({ RolloutAdapter } = require('../adapter/rollout.cjs')); } catch {}
try { ({ EnvelopeBridge } = require('../adapter/envelope.cjs')); } catch {}
try { ({ HookAdapter, sanitizeHook } = require('../adapter/hook.cjs')); } catch {}
const VERSION = '0.163.0-alpha.10.2';
const record = (type, payload) => ({ timestamp: new Date().toISOString(), type, payload });
const meta = () => record('session_meta', { id: 's1', session_id: 's1', cli_version: VERSION, originator: 'Codex Desktop' });
function run(id, prompt = '修复测试页面', started = Date.now() / 1000) {
  return [record('event_msg', { type: 'task_started', turn_id: id, started_at: started }),
    record('turn_context', { turn_id: id, model: 'exact-model', effort: 'high', cwd: 'C:/project/example' }),
    record('event_msg', { type: 'item_completed', thread_id: 's1', turn_id: id, item: { type: 'UserMessage', id: 'u-' + id, content: [{ type: 'text', text: prompt }] } })];
}
const event = (type, turn, extra = {}) => record('event_msg', { type, turn_id: turn, thread_id: 's1', ...extra });
async function fixture(t, records, options = {}) {
  assert.equal(typeof RolloutAdapter, 'function', 'RolloutAdapter must be implemented');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-adapter-test-'));
  const file = path.join(dir, 'rollout.jsonl');
  await fs.writeFile(file, records.map(x => JSON.stringify(x) + '\n').join(''));
  const envelopes = [], diagnostics = [];
  const adapter = new RolloutAdapter({ file, sessionId: 's1', expectedVersion: VERSION,
    onEnvelope: e => envelopes.push(e), onDiagnostic: d => diagnostics.push(d), pollMs: 60000, ...options });
  t.after(async () => { adapter.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  await adapter.start();
  return { adapter, file, envelopes, diagnostics, append: async records => { await fs.appendFile(file, records.map(x => JSON.stringify(x) + '\n').join('')); await adapter.poll(); } };
}
test('rollout joins matching start, context and prompt; freezes seven-field provenance', async t => {
  const f = await fixture(t, [meta(), ...run('a')]);
  const e = f.envelopes.at(-1);
  assert.equal(e.state, 'working'); assert.equal(e.runId, 'a');
  assert.equal(e.metadata.model, 'exact-model'); assert.equal(e.metadata.reasoning, 'high');
  assert.equal(e.metadata.task, '修复测试页面'); assert.equal(e.metadata.environment, 'example');
  assert.equal(e.metadata.company, null); assert.equal(e.provenance.company, 'unknown');
  assert.equal(e.provenance.model, 'reported'); assert.equal(e.source, 'codex-rollout');
  await f.append([record('turn_context', { turn_id: 'a', model: 'changed' }), ...run('a', '不得覆盖')]);
  assert.equal(f.envelopes.at(-1).metadata.task, '修复测试页面');
});
test('manual binding permits only explicitly selected verified CLI versions', async t => {
  const newerMeta = () => record('session_meta', { id: 's1', cli_version: '0.163.0-alpha.11' });
  const supportedVersions = [VERSION, '0.163.0-alpha.11'];
  const newer = await fixture(t, [newerMeta(), ...run('new')], { supportedVersions });
  assert.equal(newer.envelopes.at(-1)?.runId, 'new');
  const legacy = await fixture(t, [meta(), ...run('old')], { supportedVersions });
  assert.equal(legacy.envelopes.at(-1)?.runId, 'old');
  const exactNew = await fixture(t, [newerMeta(), ...run('exact')], { expectedVersion: '0.163.0-alpha.11' });
  assert.equal(exactNew.envelopes.at(-1)?.runId, 'exact');
  const mismatch = await fixture(t, [newerMeta(), ...run('no')]);
  assert.equal(mismatch.adapter.halted, true);
  const futureVersion = '0.163.0-alpha.12';
  const future = await fixture(t, [record('session_meta', { id: 's1', cli_version: futureVersion }), ...run('no')], { supportedVersions: [...supportedVersions, futureVersion], expectedVersion: futureVersion });
  assert.equal(future.adapter.halted, true);
  assert.equal(future.envelopes.some(e => e.state === 'working'), false);
});
test('source file order and closed runs reject foreign session and late start replay', async t => {
  const f = await fixture(t, [meta(), ...run('a', 'A', 100)]);
  await f.append([...run('b', 'B', 200), event('task_complete', 'a'), ...run('a', 'late A', 100),
    event('item_completed', 'b', { thread_id: 'other', item: { type: 'AgentMessage', id: 'foreign' } })]);
  assert.equal(f.envelopes.at(-1).runId, 'b'); assert.equal(f.envelopes.at(-1).metadata.task, 'B');
  const seq = f.envelopes.map(e => e.sequence); assert.ok(seq.every((v, i) => i === 0 || v > seq[i - 1]));
});
test('two genuine source starts in the same second still create separate runs', async t => {
  const f = await fixture(t, [meta(), ...run('a', 'A', 100)]);
  await f.append([...run('b', 'B', 100)]);
  assert.equal(f.envelopes.at(-1).runId, 'b');
});
test('completion without explicit status is unknown and cannot reopen from late activity', async t => {
  const f = await fixture(t, [meta(), ...run('a')]);
  await f.append([event('task_complete', 'a'), event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'late' } })]);
  assert.equal(f.envelopes.at(-1).state, 'unknown');
});
test('root-qualified terminal event completes; child turns cannot change the root display', async t => {
  const records = run('a', 'root', 100); records[0].payload.root_turn_id = 'a';
  const f = await fixture(t, [meta(), ...records]);
  const child = run('child', 'child text', 101); child[0].payload.root_turn_id = 'a';
  await f.append([...child, event('task_complete', 'child', { root_turn_id: 'a', started_at: 101, completed_at: 102 })]);
  assert.equal(f.envelopes.at(-1).runId, 'a');
  await f.append([event('task_complete', 'a', { root_turn_id: 'a', started_at: 100, completed_at: 103 })]);
  assert.equal(f.envelopes.at(-1).state, 'completed');
});
test('terminal errors and inconsistent completion identity never become success', async t => {
  const records = run('a', 'root', 100); records[0].payload.root_turn_id = 'a';
  const f = await fixture(t, [meta(), ...records]);
  await f.append([event('task_complete', 'a', { root_turn_id: 'other', started_at: 100, completed_at: 103 })]);
  assert.equal(f.envelopes.at(-1).state, 'working');
  await f.append([record('event_msg', { type: 'error', message: 'not displayed' }),
    event('task_complete', 'a', { root_turn_id: 'a', started_at: 100, completed_at: 103 })]);
  assert.equal(f.envelopes.at(-1).state, 'error');
});
test('wrong version and session fail closed without disclosing task data', async t => {
  const f = await fixture(t, [record('session_meta', { id: 's1', cli_version: 'unsupported' }), ...run('a', 'private text')]);
  assert.equal(f.envelopes.length, 0); assert.ok(f.diagnostics.some(d => d.code === 'unsupported-version'));
  assert.ok(!JSON.stringify(f.diagnostics).includes('private text'));
});
test('partial UTF8 record completes once; truncation never replays history', async t => {
  const records = run('a', '中英 Mixed');
  const f = await fixture(t, [meta(), ...records.slice(0, 2)]);
  assert.equal(f.envelopes.length, 0);
  const bytes = Buffer.from(JSON.stringify(records[2]) + '\n'); const split = bytes.indexOf(Buffer.from('中')) + 1;
  await fs.appendFile(f.file, bytes.subarray(0, split)); await f.adapter.poll(); assert.equal(f.envelopes.length, 0);
  await fs.appendFile(f.file, bytes.subarray(split)); await f.adapter.poll(); assert.equal(f.envelopes.at(-1).metadata.task, '中英 Mixed');
  await fs.writeFile(f.file, JSON.stringify(meta()) + '\n'); await f.adapter.poll();
  assert.equal(f.envelopes.at(-1).state, 'unknown'); assert.ok(f.diagnostics.some(x => x.code === 'source-replaced'));
});
test('stale semantics and sleep resume never treat token counts as working', async t => {
  let now = Date.now(); const f = await fixture(t, [meta(), ...run('a')], { now: () => now, staleMs: 1000 });
  now += 2000; await f.append([event('token_count', 'a')]); assert.equal(f.envelopes.at(-1).state, 'unknown');
  f.adapter.suspend(); await f.adapter.resume(); assert.equal(f.envelopes.at(-1).state, 'unknown');
  await f.append([{ ...event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'new' } }), timestamp: new Date(now).toISOString() }]);
  assert.equal(f.envelopes.at(-1).state, 'working');
});
test('in-flight poll cannot resume working after suspend or emit after stop', async t => {
  const f = await fixture(t, [meta(), ...run('a')]);
  await fs.appendFile(f.file, JSON.stringify(event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'racing' } })) + '\n');
  const original = fs.stat; let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  fs.stat = async p => { const result = await original(p); if (p === f.file) { entered(); await new Promise(resolve => { release = resolve; }); } return result; };
  t.after(() => { fs.stat = original; });
  const poll = f.adapter.poll(); await enteredPromise; f.adapter.suspend(); release(); await poll;
  assert.equal(f.envelopes.at(-1).state, 'unknown');
  fs.stat = original;
  await f.adapter.resume();
  let releaseStop, enteredStop;
  const waitStop = new Promise(resolve => { enteredStop = resolve; });
  fs.stat = async p => { const result = await original(p); if (p === f.file) { enteredStop(); await new Promise(resolve => { releaseStop = resolve; }); } return result; };
  const stoppedPoll = f.adapter.poll(); await waitStop; const count = f.envelopes.length;
  f.adapter.stop(); releaseStop(); await stoppedPoll; assert.equal(f.envelopes.length, count);
  fs.stat = original;
});
test('resume watermark excludes multi-batch sleep backlog and partial pre-resume records', async t => {
  const f = await fixture(t, [meta(), ...run('a')]);
  f.adapter.suspend();
  const ignored = record('ignored', { padding: 'x'.repeat(600000) });
  const oldActivity = event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'sleep-old' } });
  await fs.appendFile(f.file, [ignored, ignored, oldActivity].map(x => JSON.stringify(x) + '\n').join(''));
  await f.adapter.resume(); await f.adapter.poll(); assert.equal(f.envelopes.at(-1).state, 'unknown');
  f.adapter.suspend();
  const partial = Buffer.from(JSON.stringify(event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'partial-old' } })) + '\n');
  await fs.appendFile(f.file, partial.subarray(0, 70)); await f.adapter.resume();
  await fs.appendFile(f.file, partial.subarray(70)); await f.adapter.poll(); assert.equal(f.envelopes.at(-1).state, 'unknown');
  await f.append([event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'new-after-resume' } })]);
  assert.equal(f.envelopes.at(-1).state, 'working');
});
test('resume reinstalls polling when sleep interrupted the initial scan', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-start-race-'));
  const file = path.join(directory, 'rollout.jsonl');
  await fs.writeFile(file, [meta(), ...run('a')].map(x => JSON.stringify(x) + '\n').join(''));
  const out = []; const a = new RolloutAdapter({ file, sessionId: 's1', onEnvelope: e => out.push(e), pollMs: 100 });
  const original = fs.stat; let calls = 0, release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  fs.stat = async p => { const value = await original(p); if (p === file && ++calls === 2) { entered(); await new Promise(resolve => { release = resolve; }); } return value; };
  t.after(async () => { fs.stat = original; a.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const started = a.start(); await enteredPromise; a.suspend(); release(); await started; fs.stat = original;
  await a.resume();
  assert.ok(a.timer, 'resumed adapter must own a polling timer');
  await fs.appendFile(file, JSON.stringify(event('item_completed', 'a', { item: { type: 'AgentMessage', id: 'after-start-resume' } })) + '\n');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(out.at(-1).state, 'working');
});
test('bridge explicitly maps metadata and sources, starts new run once and closes terminals', async () => {
  assert.equal(typeof EnvelopeBridge, 'function');
  const b = new EnvelopeBridge({ sessionId: 's1' });
  const e = { schemaVersion: 1, sessionId: 's1', runId: 'a', source: 'codex-rollout', state: 'working', sequence: 1,
    metadata: { model: 'm', task: 't', fullTask: 'full text' }, provenance: { model: 'reported', task: 'reported' } };
  const first = b.convert(e); assert.equal(first[0].type, 'start'); assert.equal(first[0].metadata.sources.model, 'reported');
  assert.equal(first[0].metadata.fullTask, 'full text'); assert.deepEqual(b.convert(e), []);
  assert.equal(b.convert({ ...e, sequence: 2, state: 'cancelled' })[0].type, 'cancelled');
  assert.deepEqual(b.convert({ ...e, sequence: 3 }), []);
  assert.deepEqual(b.convert({ ...e, sessionId: 'other', runId: 'b', sequence: 4 }), []);
});
test('hooks without trusted source order cannot allow late new run; Stop never succeeds', () => {
  assert.equal(typeof HookAdapter, 'function');
  const out = []; const h = new HookAdapter({ sessionId: 's1', onEnvelope: e => out.push(e) });
  h.accept({ hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'a', model: 'm', prompt: 'A', cwd: 'C:/p' });
  assert.equal(out.at(-1).state, 'working');
  h.accept({ hook_event_name: 'PermissionRequest', session_id: 's1', turn_id: 'a' }); assert.equal(out.at(-1).state, 'waiting');
  h.accept({ hook_event_name: 'Stop', session_id: 's1', turn_id: 'a' }); assert.equal(out.at(-1).state, 'unknown');
  h.accept({ hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'b', model: 'm', prompt: 'B' });
  assert.equal(out.at(-1).runId, 'a');
  h.accept({ hook_event_name: 'Interrupt', session_id: 's1', turn_id: 'a' }); assert.equal(out.at(-1).state, 'cancelled');
});
test('hook handoff allowlists fields and suppresses credential-bearing strings', () => {
  assert.equal(typeof sanitizeHook, 'function');
  const safe = sanitizeHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'a',
    model: 'm', prompt: 'look https://user:pass@example.test/x and api_key=secret-value',
    Authorization: 'Bearer secret', token: 'private', tool_input: { password: 'secret' } });
  const json = JSON.stringify(safe); assert.ok(!json.includes('secret')); assert.ok(!json.includes('user:pass')); assert.ok(!json.includes('Authorization'));
});
test('hook CLI is fail-open, silent and only writes sanitized local spool', async t => {
  const { spawnSync } = require('node:child_process');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-hook-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const script = path.resolve(__dirname, '../adapter/hook-handoff.cjs');
  const malformed = spawnSync(process.execPath, [script, '--spool', directory], { input: '{', encoding: 'utf8', timeout: 3000 });
  assert.equal(malformed.status, 0); assert.equal(malformed.stdout, ''); assert.equal(malformed.stderr, '');
  const result = spawnSync(process.execPath, [script, '--spool', directory], { input: JSON.stringify({
    hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'a', prompt: 'api_key=private-example', model: 'm', Authorization: 'private'
  }), encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const files = await fs.readdir(directory); assert.equal(files.length, 1);
  const value = await fs.readFile(path.join(directory, files[0]), 'utf8');
  assert.ok(!value.includes('private')); assert.ok(!value.includes('Authorization'));
  assert.equal(JSON.parse(value).event.turn_id, 'a');
});
