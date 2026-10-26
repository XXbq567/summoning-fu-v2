'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
// Raw input may contain a long message, which is discarded. The allowlisted
// event has an independent, much smaller output bound.
const MAX_HOOK_INPUT_BYTES = 2 * 1024 * 1024, MAX_EVENT_BYTES = 65536;
const STAGES = new Set(['stdin', 'module', 'spool', 'launch', 'complete']);
const REASONS = new Set(['start', 'ready', 'end', 'stdin-error', 'timeout', 'too-large', 'invalid-input', 'parse-invalid', 'event-invalid', 'module-unavailable', 'unsupported-platform', 'root-invalid', 'root-identity-invalid', 'directory-invalid', 'directory-identity-invalid', 'spool-full', 'duplicate', 'stored', 'launch-failed', 'launched', 'io-failed', 'accepted', 'rejected', 'exception']);
function defaultDataRoot() { return process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'summoning-fu-handoff') : null; }
function localDirectoryPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) return null;
  if (process.platform === 'win32') {
    if (value.startsWith('\\\\?\\')) { if (!/^\\\\\?\\[A-Za-z]:\\/.test(value)) return null; value = value.slice(4); }
    if (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':')) return null;
  } else if (!path.isAbsolute(value)) return null;
  return path.resolve(value);
}
const plainDirectory = stat => stat.isDirectory() && !stat.isSymbolicLink();
const sameDirectory = (a, b) => typeof a.dev === 'bigint' && typeof a.ino === 'bigint'
  && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
async function resolvedDirectoryOwnerMatches(root, directory, rootStat, directoryStat) {
  const realRoot = localDirectoryPath(await fs.realpath(root)), realDir = localDirectoryPath(await fs.realpath(directory));
  if (!realRoot || !realDir) return false;
  const resolvedRoot = await fs.lstat(realRoot, { bigint: true }), resolvedOwner = await fs.lstat(path.dirname(realDir), { bigint: true });
  const resolvedDir = await fs.lstat(realDir, { bigint: true });
  // MSIX can retain unequal realpath spellings for one physical directory.
  // Exact 64-bit identities prove ownership without adding alternate roots.
  return [resolvedRoot, resolvedOwner, resolvedDir].every(plainDirectory)
    && sameDirectory(rootStat, resolvedRoot) && sameDirectory(rootStat, resolvedOwner) && sameDirectory(directoryStat, resolvedDir);
}
function createDiagnostics(dataRoot) {
  let pending = Promise.resolve(), count = 0;
  return Object.freeze({
    record(stage, reason, bytes = 0, ok = false) {
      if (!dataRoot || count++ >= 24) return;
      const record = { atMs: Date.now(), stage: STAGES.has(stage) ? stage : 'complete', reason: REASONS.has(reason) ? reason : 'rejected',
        bytes: Number.isSafeInteger(bytes) ? Math.max(0, Math.min(MAX_HOOK_INPUT_BYTES + 1, bytes)) : 0, ok: ok === true };
      pending = pending.then(async () => {
        await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
        const root = await fs.lstat(dataRoot); if (!root.isDirectory() || root.isSymbolicLink()) return;
        const file = path.join(dataRoot, 'hook-stages.jsonl');
        let stat; try { stat = await fs.lstat(file); } catch (e) { if (e.code !== 'ENOENT') return; }
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) return;
        const line = JSON.stringify(record) + '\n';
        await fs.writeFile(file, line, { flag: stat && stat.size + Buffer.byteLength(line) > 65536 ? 'w' : 'a', mode: 0o600 });
      }).catch(() => {});
    },
    flush() { return pending; }
  });
}
function loadAdapters() {
  let adapters, titles;
  try { adapters = require('../adapter/entrance-event.cjs'); } catch { adapters = require('../../adapter/entrance-event.cjs'); }
  try { titles = require('../adapter/chat-title.cjs'); } catch { titles = require('../../adapter/chat-title.cjs'); }
  return { ...adapters, ...titles };
}
async function launchRuntime(executable, file) {
  await new Promise((resolve, reject) => {
    // The requested GUI must be visible; SW_HIDE suppresses Electron's first ShowWindow on Windows.
    // Keep the option and its value together across Electron's single-instance handoff.
    const child = spawn(executable, ['--entrance-file=' + file], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function handoff(raw, options = {}) {
  const dataRoot = options.dataRoot || defaultDataRoot(), diagnostic = options.diagnostic || createDiagnostics(dataRoot);
  const bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : 0;
  const note = (stage, reason, ok = false) => diagnostic.record(stage, reason, bytes, ok);
  try {
    if (typeof raw !== 'string') { note('stdin', 'invalid-input'); return false; }
    if (bytes > MAX_HOOK_INPUT_BYTES) { note('stdin', 'too-large'); return false; }
    note('module', 'start');
    let adapters;
    try { adapters = loadAdapters(); } catch { note('module', 'module-unavailable'); return false; }
    note('module', 'ready', true);
    const { createEntranceEvent, EVENT_TTL_MS, readChatTitle } = adapters;
    let input; try { input = JSON.parse(raw); } catch { note('stdin', 'parse-invalid'); return false; }
    const preliminary = createEntranceEvent(input);
    if (!preliminary) { note('spool', 'event-invalid'); return false; }
    const pluginRoot = options.pluginRoot || path.resolve(__dirname, '..');
    if (!dataRoot) { note('spool', 'unsupported-platform'); return false; }
    const dir = path.join(dataRoot, 'entrance-events');
    note('spool', 'start');
    await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(dataRoot, { bigint: true });
    if (!plainDirectory(rootStat)) { note('spool', 'root-invalid'); return false; }
    if (!sameDirectory(rootStat, rootStat)) { note('spool', 'root-identity-invalid'); return false; }
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(dir, { bigint: true });
    if (!plainDirectory(stat)) { note('spool', 'directory-invalid'); return false; }
    if (!sameDirectory(stat, stat) || !await resolvedDirectoryOwnerMatches(dataRoot, dir, rootStat, stat)) { note('spool', 'directory-identity-invalid'); return false; }
    const entries = await fs.readdir(dir);
    if (entries.length > 512) { note('spool', 'spool-full'); return false; }
    const now = Date.now(); let live = 0;
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
      const file = path.join(dir, entry), s = await fs.lstat(file);
      if (!s.isFile() || s.isSymbolicLink()) continue;
      if (now - s.mtimeMs > EVENT_TTL_MS) await fs.unlink(file).catch(() => {}); else live++;
    }
    if (live >= 128) { note('spool', 'spool-full'); return false; }
    const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const title = await readChatTitle(input.session_id, { file: path.join(codexHome, 'session_index.jsonl') });
    const event = createEntranceEvent(input, { title, now }), encoded = JSON.stringify(event);
    if (Buffer.byteLength(encoded) > MAX_EVENT_BYTES) { note('spool', 'too-large'); return false; }
    const file = path.join(dir, event.eventId + '.json');
    try { await fs.writeFile(file, encoded, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code === 'EEXIST') { note('spool', 'duplicate'); return false; } throw e; }
    note('spool', 'stored', true); note('launch', 'start');
    try { await (options.launch || launchRuntime)(path.join(pluginRoot, 'runtime', 'Summoning-Fu.exe'), file); }
    catch { await fs.unlink(file).catch(() => {}); note('launch', 'launch-failed'); return false; }
    note('launch', 'launched', true); note('complete', 'accepted', true);
    return true;
  } catch { note('complete', 'io-failed'); return false; }
  finally { await diagnostic.flush(); }
}
function runStdin() {
  // Establish the fail-open deadline before loading project adapters.
  let bytes = 0, chunks = [], done = false;
  const diagnostic = createDiagnostics(defaultDataRoot()), exit = () => process.exit(0);
  const timer = setTimeout(() => { done = true; diagnostic.record('stdin', 'timeout', bytes); void diagnostic.flush().then(exit); setTimeout(exit, 20); }, 1450);
  const finish = async (raw, reason = 'end') => { if (done) return; done = true; diagnostic.record('stdin', reason, bytes, reason === 'end'); await handoff(raw, { diagnostic }); clearTimeout(timer); exit(); };
  process.on('uncaughtException', () => { diagnostic.record('complete', 'exception', bytes); void diagnostic.flush().then(exit); });
  process.on('unhandledRejection', () => { diagnostic.record('complete', 'exception', bytes); void diagnostic.flush().then(exit); });
  diagnostic.record('stdin', 'start');
  process.stdin.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_HOOK_INPUT_BYTES) { process.stdin.pause(); void finish(null, 'too-large'); return; } chunks.push(chunk); });
  process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', () => finish('', 'stdin-error'));
}
if (require.main === module) runStdin();
module.exports = { handoff, runStdin, createDiagnostics, MAX_HOOK_INPUT_BYTES };
