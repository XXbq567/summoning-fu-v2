'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const Hook = require('../plugin/scripts/user-prompt-submit.cjs');
const input = { hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-session', turn_id: 'synthetic-turn', model: 'gpt-5.6-luna' };
async function fixture(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'summoning-hook-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
test('large legitimate stdin discards its body and emits only fixed bounded stage diagnostics', async t => {
  const dir = await fixture(t), raw = JSON.stringify({ ...input, prompt: 'PRIVATE-PROMPT'.repeat(10000), authorization: 'PRIVATE-KEY' });
  assert.ok(Buffer.byteLength(raw) > 65536);
  const ok = await Hook.handoff(raw, { dataRoot: dir, codexHome: path.join(dir, 'codex'), launch: async () => {} });
  assert.equal(ok, true);
  const rows = (await fs.readFile(path.join(dir, 'hook-stages.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(rows.some(r => r.stage === 'module' && r.reason === 'ready'));
  assert.ok(rows.some(r => r.stage === 'spool' && r.reason === 'stored'));
  assert.ok(rows.some(r => r.stage === 'launch' && r.reason === 'launched'));
  for (const row of rows) { assert.deepEqual(Object.keys(row).sort(), ['atMs', 'bytes', 'ok', 'reason', 'stage']); assert.ok(Number.isSafeInteger(row.bytes)); }
  const all = JSON.stringify(rows); assert.doesNotMatch(all, /PRIVATE|synthetic-session|synthetic-turn|gpt-5/);
  const eventFiles = await fs.readdir(path.join(dir, 'entrance-events'));
  const event = await fs.readFile(path.join(dir, 'entrance-events', eventFiles[0]), 'utf8');
  assert.ok(Buffer.byteLength(event) < 65536); assert.doesNotMatch(event, /PRIVATE/);
});
test('adapter module load failure is silent fail-open and recorded before any spool exists', async t => {
  const dir = await fixture(t), preload = path.join(dir, 'block.cjs');
  await fs.writeFile(preload, "const M=require('node:module'),load=M._load;M._load=function(id,...args){if(/adapter[\\\\/]entrance-event\\.cjs$/.test(id))throw Error('PRIVATE-MODULE-ERROR');return load.call(this,id,...args)};\n");
  const result = spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '../plugin/scripts/user-prompt-submit.cjs')], { input: JSON.stringify(input), env: { ...process.env, APPDATA: dir }, encoding: 'utf8', timeout: 3500, windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stdout + result.stderr, '');
  const log = await fs.readFile(path.join(dir, 'summoning-fu-handoff', 'hook-stages.jsonl'), 'utf8');
  assert.match(log, /module-unavailable/); assert.doesNotMatch(log, /PRIVATE|synthetic-session/);
});
