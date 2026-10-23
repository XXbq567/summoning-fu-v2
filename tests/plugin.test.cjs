'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let readChatTitle, createEntranceEvent, validateEntranceEvent, readEntranceFile, verifyEntranceTurn, applyVerifiedReasoning, handoff;
try { ({ readChatTitle } = require('../adapter/chat-title.cjs')); } catch {}
try { ({ createEntranceEvent, validateEntranceEvent, readEntranceFile, verifyEntranceTurn, applyVerifiedReasoning } = require('../adapter/entrance-event.cjs')); } catch {}
try { ({ handoff } = require('../plugin/scripts/user-prompt-submit.cjs')); } catch {}
const input = { hook_event_name: 'UserPromptSubmit', session_id: 'test-session', turn_id: 'test-turn', model: 'example-model', cwd: 'C:/work/project' };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(path.resolve(__dirname, '..'), '.plugin-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('title uses exact session id, latest matching timestamp and no prompt fallback', async t => {
  assert.equal(typeof readChatTitle, 'function');
  const dir = await fixture(t), file = path.join(dir, 'session_index.jsonl');
  await fs.writeFile(file, [JSON.stringify({ id: 'other', thread_name: '错误标题', updated_at: '2026-10-21T10:02:00Z' }), JSON.stringify({ id: 'test-session', thread_name: '正确标题', updated_at: '2026-10-21T10:01:00Z' }), JSON.stringify({ id: 'test-session', thread_name: '旧标题', updated_at: '2026-10-21T10:00:00Z' }), '{partial'].join('\n'));
  assert.equal((await readChatTitle('test-session', { file })).value, '正确标题');
  assert.deepEqual(await readChatTitle('missing', { file }), { value: null, source: 'pending' });
  await fs.writeFile(file, 'x'.repeat(4 * 1024 * 1024 + 1));
  assert.equal((await readChatTitle('test-session', { file })).value, null);
});
test('entrance events whitelist hook metadata, redact credentials and never mark working', () => {
  assert.equal(typeof createEntranceEvent, 'function');
  const e = createEntranceEvent({ ...input, prompt: 'DO NOT COPY', authorization: 'DO NOT COPY' }, { title: { value: '研究 api_key=secret123', source: 'codex-session-index' } });
  assert.equal(e.kind, 'codex-user-prompt-submit'); assert.equal(e.metadata.model, input.model);
  assert.equal(e.metadata.reasoning, null); assert.equal(e.provenance.reasoning, 'unknown');
  assert.equal(e.title.value.includes('secret123'), false);
  assert.equal(JSON.stringify(e).includes('DO NOT COPY'), false); assert.equal('state' in e, false);
  assert.equal(createEntranceEvent({ ...input, turn_id: '' }), null);
  assert.equal(createEntranceEvent({ ...input, hook_event_name: 'SessionStart' }), null);
  assert.equal(createEntranceEvent({ ...input, session_id: '../../bad' }), null);
  const pending = createEntranceEvent(input); assert.equal(pending.metadata.task, null);
});
test('entrance file rejects expired, outside, nonregular and oversized inputs', async t => {
  assert.equal(typeof readEntranceFile, 'function');
  const dir = await fixture(t), events = path.join(dir, 'entrance-events'); await fs.mkdir(events);
  const e = createEntranceEvent(input), file = path.join(events, e.eventId + '.json'); await fs.writeFile(file, JSON.stringify(e));
  assert.equal((await readEntranceFile(file, { dataRoot: dir })).sessionId, input.session_id);
  assert.equal(validateEntranceEvent(e, { now: Date.now() + 121000 }), null);
  assert.equal(validateEntranceEvent({ ...e, createdAt: new Date(Date.now() + 60000).toISOString() }), null);
  const outside = path.join(dir, 'outside.json'); await fs.writeFile(outside, JSON.stringify(e));
  assert.equal(await readEntranceFile(outside, { dataRoot: dir }), null);
  assert.equal(await readEntranceFile(events, { dataRoot: dir }), null);
  await fs.writeFile(file, 'x'.repeat(65537)); assert.equal(await readEntranceFile(file, { dataRoot: dir }), null);
});
test('entrance reader accepts equivalent local paths but rejects outside roots and linked event directories', async t => {
  const dir = await fixture(t), real = path.join(dir, 'real'), dataRoot = path.join(real, 'app');
  const events = path.join(dataRoot, 'entrance-events'); await fs.mkdir(events, { recursive: true });
  const e = createEntranceEvent(input), name = e.eventId + '.json', file = path.join(events, name);
  await fs.writeFile(file, JSON.stringify(e));
  if (process.platform === 'win32') assert.equal((await readEntranceFile(path.toNamespacedPath(file), { dataRoot }))?.eventId, e.eventId);
  const alias = path.join(dir, 'alias'); await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasFile = path.join(alias, 'app', 'entrance-events', name);
  assert.equal((await readEntranceFile(aliasFile, { dataRoot }))?.eventId, e.eventId);
  assert.equal((await readEntranceFile(file, { dataRoot: path.join(alias, 'app') }))?.eventId, e.eventId);
  // Simulate MSIX retaining different realpath spellings; dev/ino remain real filesystem identity.
  const originalRealpath = fs.realpath;
  fs.realpath = async value => path.resolve(value).startsWith(alias + path.sep) ? path.resolve(value) : originalRealpath(value);
  try { assert.equal((await readEntranceFile(aliasFile, { dataRoot }))?.eventId, e.eventId); }
  finally { fs.realpath = originalRealpath; }
  const outside = path.join(dir, 'outside', 'entrance-events'); await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, name), JSON.stringify(e));
  const reasons = [];
  assert.equal(await readEntranceFile(path.join(outside, name), { dataRoot, onDiagnostic: d => reasons.push(d.reason) }), null);
  assert.deepEqual(reasons, ['event-outside-root']);
  const linked = path.join(dir, 'linked'); await fs.mkdir(linked);
  await fs.symlink(events, path.join(linked, 'entrance-events'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await readEntranceFile(path.join(linked, 'entrance-events', name), { dataRoot }), null);
  assert.equal(await readEntranceFile(file, { dataRoot: linked }), null);
});
test('hook handoff is silent fail-open and deduplicates while bounding input', async t => {
  assert.equal(typeof handoff, 'function');
  const dir = await fixture(t), codexHome = path.join(dir, 'codex'), dataRoot = path.join(dir, 'app'), pluginData = path.join(dir, 'plugin');
  await fs.mkdir(codexHome); await fs.writeFile(path.join(codexHome, 'session_index.jsonl'), JSON.stringify({ id: input.session_id, thread_name: '测试标题', updated_at: new Date().toISOString() }) + '\n');
  let launches = 0;
  const options = { dataRoot, pluginData, codexHome, pluginRoot: path.resolve(__dirname, '../plugin'), launch: async () => { launches++; } };
  assert.equal(await handoff('{bad', options), false);
  assert.equal(await handoff('x'.repeat(65537), options), false);
  assert.equal(await handoff(JSON.stringify(input), options), true);
  assert.equal(await handoff(JSON.stringify(input), options), false);
  assert.equal(launches, 1);
  const files = await fs.readdir(path.join(dataRoot, 'entrance-events')); assert.equal(files.length, 1);
  assert.equal((await readEntranceFile(path.join(dataRoot, 'entrance-events', files[0]), { dataRoot })).title.value, '测试标题');
});
test('desktop hook plugin uses legacy-only manifest because portable root silently suppresses hooks', async () => {
  const base = path.resolve(__dirname, '../plugin');
  await assert.rejects(fs.stat(path.join(base, 'plugin.json')), { code: 'ENOENT' });
  const legacy = JSON.parse(await fs.readFile(path.join(base, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(legacy.version, '0.5.0'); assert.equal(legacy.hooks, './hooks/hooks.json');
  assert.equal(legacy.skills, undefined);
  const hooks = JSON.parse(await fs.readFile(path.join(base, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['UserPromptSubmit']);
  assert.equal(hooks.hooks.UserPromptSubmit[0].matcher, undefined);
  assert.match(hooks.hooks.UserPromptSubmit[0].hooks[0].command, /PLUGIN_ROOT/);
  assert.doesNotMatch(JSON.stringify(hooks), /C:\/Users|SessionStart/);
});
test('source-byte verification rejects old turns, wrong sessions and arbitrary transcript paths', async t => {
  assert.equal(typeof verifyEntranceTurn, 'function');
  const dir = await fixture(t), sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions);
  const file = path.join(sessions, 'rollout-test.jsonl');
  const meta = { type: 'session_meta', payload: { id: input.session_id, cli_version: '0.163.0-alpha.10.2' } };
  const start = turn => ({ type: 'event_msg', payload: { type: 'task_started', turn_id: turn, root_turn_id: turn, started_at: Date.now() / 1000 } });
  await fs.writeFile(file, [meta, start('old-turn'), start(input.turn_id)].map(JSON.stringify).join('\n') + '\n');
  const event = createEntranceEvent({ ...input, transcript_path: file });
  assert.equal((await verifyEntranceTurn(event, { codexHome: dir })).verified, true);
  assert.equal((await verifyEntranceTurn(createEntranceEvent({ ...input, turn_id: 'old-turn', transcript_path: file }), { codexHome: dir })).verified, false);
  assert.equal((await verifyEntranceTurn({ ...event, sessionId: 'other' }, { codexHome: dir })).verified, false);
  assert.equal((await verifyEntranceTurn({ ...event, transcriptPath: path.join(dir, 'auth.json') }, { codexHome: dir })).verified, false);
  const expired = start(input.turn_id); expired.payload.started_at -= 300;
  await fs.writeFile(file, [meta, expired].map(JSON.stringify).join('\n') + '\n');
  assert.equal((await verifyEntranceTurn(event, { codexHome: dir })).reason, 'source-expired');
});
test('exact alpha11 contract is accepted while future versions and invalid identities remain rejected', async t => {
  const dir = await fixture(t), sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions);
  const file = path.join(sessions, 'rollout-alpha11.jsonl'), now = Date.now();
  const meta = { type: 'session_meta', payload: { id: input.session_id, cli_version: '0.163.0-alpha.11' } };
  const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: input.turn_id, root_turn_id: input.turn_id, started_at: now / 1000 } };
  const context = { type: 'turn_context', payload: { turn_id: input.turn_id, model: input.model, effort: 'high' } };
  const event = createEntranceEvent({ ...input, transcript_path: file });
  const check = async rows => { await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n'); return verifyEntranceTurn(event, { codexHome: dir, now }); };
  let v = await check([meta, start, context]); assert.equal(v.verified, true); assert.equal(v.reasoning.value, 'high');
  assert.equal((await check([{ ...meta, payload: { ...meta.payload, cli_version: '0.163.0-alpha.12' } }, start, context])).reason, 'version-mismatch');
  assert.equal((await check([{ ...meta, payload: { ...meta.payload, id: 'other' } }, start, context])).reason, 'session-mismatch');
  assert.equal((await check([meta, start, { ...start, payload: { ...start.payload, turn_id: 'new', root_turn_id: 'new' } }])).reason, 'latest-turn-mismatch');
  assert.equal((await check([meta, { ...start, payload: { ...start.payload, root_turn_id: 'parent', turn_attribution: { parent_turn_id: 'parent' } } }, context])).reason, 'source-not-ready');
  v = await check([meta, start, { ...context, payload: { ...context.payload, effort: undefined } }]);
  assert.equal(v.verified, true); assert.equal(v.reasoning.source, 'unknown');
});
test('reasoning joins only the matching current root turn context and never trusts event claims', async t => {
  const dir = await fixture(t), sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions);
  const file = path.join(sessions, 'rollout-effort.jsonl'), now = Date.now();
  const meta = { type: 'session_meta', payload: { id: input.session_id, cli_version: '0.163.0-alpha.10.2' } };
  const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: input.turn_id, root_turn_id: input.turn_id, started_at: now / 1000 } };
  const context = overrides => ({ type: 'turn_context', payload: { turn_id: input.turn_id, model: input.model, effort: 'xhigh', ...overrides } });
  const event = createEntranceEvent({ ...input, transcript_path: file });
  event.metadata.reasoning = 'high'; event.provenance.reasoning = 'reported';
  const verify = async rows => { await fs.writeFile(file, rows.map(JSON.stringify).join('\n') + '\n'); return verifyEntranceTurn(event, { codexHome: dir, now }); };
  let v = await verify([meta, start, context()]);
  assert.equal(v.verified, true); assert.equal(v.reasoning?.value, 'xhigh'); assert.equal(v.reasoning?.source, 'reported');
  assert.ok(v.reasoning.contextOffset > v.offset); assert.equal(v.contextMissing, false);
  assert.equal(applyVerifiedReasoning(event, v).metadata.reasoning, 'xhigh');
  assert.equal(applyVerifiedReasoning(event, { ...v, verified: false }).metadata.reasoning, null);
  assert.equal(applyVerifiedReasoning({ ...event, turnId: 'other' }, v).provenance.reasoning, 'unknown');
  for (const rows of [
    [meta, context(), start],
    [meta, start, context({ turn_id: 'other-turn' })],
    [meta, start, context({ root_turn_id: 'other-root' })],
    [meta, start, context({ parent_turn_id: 'parent' })],
    [meta, start, context({ turn_attribution: { initiating_agent_path: 'child' } })],
    [meta, start, context({ model: 'other-model' })],
    [meta, start, context({ effort: 'untrusted-value' })],
    [meta, start, context(), context({ effort: 'low' })],
    [meta, start, context(), context({ model: 'other-model' })],
    [meta, start, context(), context({ effort: 'low', padding: 'x'.repeat(1024 * 1024) })]
  ]) {
    v = await verify(rows); assert.equal(v.verified, true);
    const merged = applyVerifiedReasoning(event, v);
    assert.equal(merged.metadata.reasoning, null); assert.equal(merged.provenance.reasoning, 'unknown');
  }
  v = await verify([meta, start]); assert.equal(v.contextMissing, true);
  assert.equal(applyVerifiedReasoning(event, v).metadata.reasoning, null);
  await fs.appendFile(file, JSON.stringify(context()) + '\n');
  v = await verifyEntranceTurn(event, { codexHome: dir, now });
  assert.equal(v.reasoning.value, 'xhigh'); assert.equal(v.contextMissing, false);
  assert.equal((await verify([meta, start, context(), context()])).reasoning.value, 'xhigh');
});
test('CLI hook stays silent and exits within deadline when local I/O stalls', async t => {
  const dir = await fixture(t), preload = path.join(dir, 'slow-io.cjs');
  await fs.writeFile(preload, "require('node:fs/promises').mkdir=()=>new Promise(()=>{});\n");
  const { spawn } = require('node:child_process');
  const start = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', preload, path.resolve(__dirname, '../plugin/scripts/user-prompt-submit.cjs')], { env: { ...process.env, APPDATA: dir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.once('error', reject); child.once('exit', code => resolve({ code, output }));
    child.stdin.end(JSON.stringify(input));
    const watchdog = setTimeout(() => { child.kill(); reject(Error('hook failed hard deadline')); }, 4000); watchdog.unref(); child.once('exit', () => clearTimeout(watchdog));
  });
  assert.equal(result.code, 0); assert.equal(result.output, ''); assert.ok(Date.now() - start < 3500);
});
test('hook hands the entrance file to the GUI as one attached argument', async t => {
  const dir = await fixture(t), preload = path.join(dir, 'capture-spawn.cjs'), captured = path.join(dir, 'argv.json');
  await fs.writeFile(preload, "const fs=require('node:fs'),EventEmitter=require('node:events');require('node:child_process').spawn=(exe,args)=>{fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify(args));const child=new EventEmitter();child.unref=()=>{};process.nextTick(()=>child.emit('spawn'));return child};\n");
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '../plugin/scripts/user-prompt-submit.cjs')], { env: { ...process.env, APPDATA: dir, CODEX_HOME: path.join(dir, 'codex'), TEST_CAPTURE: captured }, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const args = JSON.parse(await fs.readFile(captured, 'utf8'));
  assert.equal(args.length, 1); assert.ok(args[0].startsWith('--entrance-file='));
  const eventFile = args[0].slice('--entrance-file='.length);
  assert.equal(path.dirname(eventFile), path.join(dir, 'summoning-fu-handoff', 'entrance-events'));
  assert.match(path.basename(eventFile), /^[a-f0-9]{64}\.json$/);
});
test('plugin runtime copy refuses personal aliases, screenshots and extra resources', async t => {
  const packaging = require('../scripts/package-plugin.cjs');
  assert.equal(typeof packaging.copyRuntime, 'function');
  const dir = await fixture(t), runtime = path.join(dir, 'runtime'), dest = path.join(dir, 'dest'); await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime, 'Summoning-Fu.exe'), 'fixture');
  await fs.writeFile(path.join(runtime, 'display-aliases.json'), '{"private":"must not package"}');
  await assert.rejects(packaging.copyRuntime(runtime, dest), /Unexpected runtime file/);
  assert.equal(await fs.stat(dest).then(() => true, () => false), false);
  await fs.unlink(path.join(runtime, 'display-aliases.json')); await fs.writeFile(path.join(runtime, 'QA.png'), 'private');
  await assert.rejects(packaging.copyRuntime(runtime, dest), /Unexpected runtime file/);
});
test('hook bootstrap silently fails open if installed script is unavailable', async () => {
  const hooks = JSON.parse(await fs.readFile(path.resolve(__dirname, '../plugin/hooks/hooks.json'), 'utf8'));
  const command = hooks.hooks.UserPromptSubmit[0].hooks[0].commandWindows;
  const code = command.slice('node -e "'.length, -1);
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, 'missing-plugin-root') }, input: '{}', encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
test('source verification accepts a real-sized large metadata line and rejects oversized headers', async t => {
  const dir = await fixture(t), sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions);
  const file = path.join(sessions, 'rollout-large-header.jsonl');
  const meta = { type: 'session_meta', payload: { id: input.session_id, cli_version: '0.163.0-alpha.10.2', base_instructions: { text: 'fixture-only'.repeat(3000) } } };
  const start = { type: 'event_msg', payload: { type: 'task_started', turn_id: input.turn_id, root_turn_id: input.turn_id, started_at: Date.now() / 1000 } };
  await fs.writeFile(file, [meta, start].map(JSON.stringify).join('\n') + '\n');
  const event = createEntranceEvent({ ...input, transcript_path: file });
  const valid = await verifyEntranceTurn(event, { codexHome: dir });
  assert.equal(valid.verified, true);
  assert.equal(JSON.stringify(valid).includes('fixture-only'), false);
  meta.payload.base_instructions.text = 'x'.repeat(1024 * 1024);
  await fs.writeFile(file, [meta, start].map(JSON.stringify).join('\n') + '\n');
  assert.equal((await verifyEntranceTurn(event, { codexHome: dir })).reason, 'source-header-too-large');
});
test('Windows namespaced local transcript paths keep lexical and real containment checks', { skip: process.platform !== 'win32' }, async t => {
  const dir = await fixture(t), sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions);
  const file = path.join(sessions, 'rollout-namespaced.jsonl');
  const records = [{ type: 'session_meta', payload: { id: input.session_id, cli_version: '0.163.0-alpha.10.2' } }, { type: 'event_msg', payload: { type: 'task_started', turn_id: input.turn_id, root_turn_id: input.turn_id, started_at: Date.now() / 1000 } }];
  await fs.writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  const event = createEntranceEvent({ ...input, transcript_path: path.toNamespacedPath(file) });
  assert.equal((await verifyEntranceTurn(event, { codexHome: dir })).verified, true);
  const outside = path.join(dir, 'rollout-outside.jsonl'); await fs.copyFile(file, outside);
  assert.equal((await verifyEntranceTurn({ ...event, transcriptPath: path.toNamespacedPath(outside) }, { codexHome: dir })).reason, 'invalid-source');
  for (const unsafe of ['\\\\?\\UNC\\server\\share\\rollout-test.jsonl', '\\\\.\\C:\\rollout-test.jsonl', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\rollout-test.jsonl']) assert.equal((await verifyEntranceTurn({ ...event, transcriptPath: unsafe }, { codexHome: dir })).reason, 'invalid-source');
  const outsideDir = path.join(dir, 'outside'); await fs.mkdir(outsideDir); await fs.copyFile(file, path.join(outsideDir, 'rollout-reparse.jsonl'));
  const junction = path.join(sessions, 'redirect'); await fs.symlink(outsideDir, junction, 'junction');
  assert.equal((await verifyEntranceTurn({ ...event, transcriptPath: path.toNamespacedPath(path.join(junction, 'rollout-reparse.jsonl')) }, { codexHome: dir })).reason, 'invalid-source');
});
