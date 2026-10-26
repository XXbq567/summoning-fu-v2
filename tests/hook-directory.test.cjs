'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { handoff } = require('../plugin/scripts/user-prompt-submit.cjs');
const input = { hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-directory', turn_id: 'synthetic-root', model: 'gpt-5.6-luna' };
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'summoning-hook-directory-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith('summoning-hook-directory-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  const owner = path.join(base, 'physical'), root = path.join(owner, 'app'), dir = path.join(root, 'entrance-events');
  await fs.mkdir(dir, { recursive: true });
  return { base, owner, root, dir };
}
async function run(root, extra = {}) {
  let launches = 0; const records = [];
  const ok = await handoff(JSON.stringify(input), { dataRoot: root, codexHome: path.join(root, 'missing-codex'), launch: async () => { launches++; },
    diagnostic: { record(stage, reason, bytes, accepted) { records.push({ stage, reason, bytes, accepted }); }, flush: async () => {} }, ...extra });
  return { ok, launches, records };
}
async function withFs({ realpath, lstat }, action) {
  const oldRealpath = fs.realpath, oldLstat = fs.lstat;
  if (realpath) fs.realpath = value => realpath(value, oldRealpath);
  if (lstat) fs.lstat = (value, options) => lstat(value, options, oldLstat);
  try { return await action(); } finally { fs.realpath = oldRealpath; fs.lstat = oldLstat; }
}
function inode(stat, value) { return new Proxy(stat, { get(object, key) { return key === 'ino' ? value : Reflect.get(object, key); } }); }
test('equivalent Store-style realpath spellings authorize only the same physical root and event directory', async t => {
  const f = await fixture(t), alias = path.join(f.base, 'store-alias');
  await fs.symlink(f.owner, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasRoot = path.join(alias, 'app'), aliasDir = path.join(aliasRoot, 'entrance-events');
  const result = await withFs({ realpath: (value, original) => path.resolve(value) === f.dir ? Promise.resolve(aliasDir) : original(value) }, () => run(f.root));
  assert.equal(result.ok, true, 'different path strings with proven identical directory identities must work');
  assert.equal(result.launches, 1);
  const files = await fs.readdir(f.dir); assert.equal(files.length, 1); assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.ok(result.records.some(r => r.stage === 'spool' && r.reason === 'stored'));
  assert.doesNotMatch(JSON.stringify(result.records), /synthetic-directory|synthetic-root|store-alias|physical|[A-Z]:\\/);
});
test('ordinary directory ownership still works and final root or event junctions are rejected', async t => {
  const f = await fixture(t); assert.equal((await run(f.root)).ok, true);
  const linkedRoot = path.join(f.base, 'linked-root'); await fs.symlink(f.root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await run(linkedRoot)).ok, false);
  const second = path.join(f.base, 'other-app'); await fs.mkdir(second);
  await fs.symlink(f.dir, path.join(second, 'entrance-events'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await run(second)).ok, false);
});
test('a resolved directory cannot switch to a different physical owner or event directory', async t => {
  const f = await fixture(t), outside = path.join(f.base, 'outside'), outsideDir = path.join(outside, 'entrance-events'); await fs.mkdir(outsideDir, { recursive: true });
  const result = await withFs({ realpath: (value, original) => path.resolve(value) === f.dir ? Promise.resolve(outsideDir) : original(value) }, () => run(f.root));
  assert.equal(result.ok, false); assert.equal(result.launches, 0); assert.equal((await fs.readdir(outsideDir)).length, 0);
  const sibling = path.join(f.root, 'other-directory'); await fs.mkdir(sibling);
  const changedDir = await withFs({ realpath: (value, original) => path.resolve(value) === f.dir ? Promise.resolve(sibling) : original(value) }, () => run(f.root));
  assert.equal(changedDir.ok, false, 'the correct owner cannot authorize a different child identity');
  const ownerLink = path.join(f.base, 'owner-link'); await fs.symlink(f.root, ownerLink, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedOwner = await withFs({ realpath: (value, original) => path.resolve(value) === f.dir ? Promise.resolve(path.join(ownerLink, 'entrance-events')) : original(value) }, () => run(f.root));
  assert.equal(linkedOwner.ok, false, 'a final resolved owner junction is rejected even when it reaches the same directory');
});
test('zero or different 64-bit identities cannot be accepted after lossy Number rounding', async t => {
  const f = await fixture(t), alias = path.join(f.base, 'store-alias');
  await fs.symlink(f.owner, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasRoot = path.join(alias, 'app'), aliasDir = path.join(aliasRoot, 'entrance-events'), large = 9007199254740992n;
  const wrong = await withFs({
    realpath: (value, original) => path.resolve(value) === f.dir ? Promise.resolve(aliasDir) : original(value),
    lstat: async (value, options, original) => { const stat = await original(value, options); return path.resolve(value) === f.root ? inode(stat, large) : path.resolve(value) === aliasRoot ? inode(stat, large + 1n) : stat; }
  }, () => run(f.root));
  assert.equal(Number(large), Number(large + 1n)); assert.equal(wrong.ok, false); assert.equal(wrong.launches, 0);
  const zero = await withFs({ lstat: async (value, options, original) => { const stat = await original(value, options); return path.resolve(value) === f.root ? inode(stat, 0n) : stat; } }, () => run(f.root));
  assert.equal(zero.ok, false, 'a missing physical identity is not authority'); assert.equal(zero.launches, 0);
});
test('replacement between initial lstat and realpath resolution cannot authorize the new directory', async t => {
  const f = await fixture(t); let changed = false;
  const result = await withFs({ realpath: async (value, original) => {
    if (!changed && path.resolve(value) === f.dir) { changed = true; await fs.rename(f.root, path.join(f.owner, 'retired-app')); await fs.mkdir(f.dir, { recursive: true }); }
    return original(value);
  } }, () => run(f.root));
  assert.equal(result.ok, false); assert.equal(result.launches, 0); assert.equal((await fs.readdir(f.dir)).length, 0);
});
