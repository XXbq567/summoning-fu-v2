'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
// Distribution copies the exact project adapters into plugin/adapter; source uses ../.. .
let adapters;
try { adapters = require('../adapter/entrance-event.cjs'); } catch { adapters = require('../../adapter/entrance-event.cjs'); }
let titles;
try { titles = require('../adapter/chat-title.cjs'); } catch { titles = require('../../adapter/chat-title.cjs'); }
const { createEntranceEvent, MAX_EVENT_BYTES, EVENT_TTL_MS } = adapters;
async function launchRuntime(executable, file) {
  await new Promise((resolve, reject) => {
    // The requested GUI must be visible; SW_HIDE suppresses Electron's first ShowWindow on Windows.
    // Keep the option and its value together across Electron's single-instance handoff.
    const child = spawn(executable, ['--entrance-file=' + file], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function handoff(raw, options = {}) {
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_EVENT_BYTES) return false;
    const input = JSON.parse(raw), preliminary = createEntranceEvent(input);
    if (!preliminary) return false;
    const pluginRoot = options.pluginRoot || path.resolve(__dirname, '..');
    const dataRoot = options.dataRoot || (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'summoning-fu-handoff') : null);
    if (!dataRoot) return false; // This artifact is Windows-only; no unverified platform launch.
    const dir = path.join(dataRoot, 'entrance-events');
    await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(dataRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await fs.realpath(dir)) !== await fs.realpath(dataRoot)) return false;
    const entries = await fs.readdir(dir);
    if (entries.length > 512) return false;
    const now = Date.now(); let live = 0;
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
      const file = path.join(dir, entry), s = await fs.lstat(file);
      if (!s.isFile() || s.isSymbolicLink()) continue;
      if (now - s.mtimeMs > EVENT_TTL_MS) await fs.unlink(file).catch(() => {}); else live++;
    }
    if (live >= 128) return false;
    const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const title = await titles.readChatTitle(input.session_id, { file: path.join(codexHome, 'session_index.jsonl') });
    const event = createEntranceEvent(input, { title, now });
    const file = path.join(dir, event.eventId + '.json');
    try { await fs.writeFile(file, JSON.stringify(event), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    try { await (options.launch || launchRuntime)(path.join(pluginRoot, 'runtime', 'Summoning-Fu.exe'), file); }
    catch { await fs.unlink(file).catch(() => {}); return false; }
    return true;
  } catch { return false; }
}
function runStdin() {
  // No stdout/stderr: hook output must never enter developer context.
  let bytes = 0, chunks = [], done = false;
  const finish = async raw => { if (done) return; done = true; await handoff(raw); clearTimeout(timer); process.exit(0); };
  const timer = setTimeout(() => { done = true; process.exit(0); }, 1500);
  process.stdin.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_EVENT_BYTES) { done = true; process.exit(0); } chunks.push(chunk); });
  process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', () => finish(''));
  process.on('uncaughtException', () => process.exit(0)); process.on('unhandledRejection', () => process.exit(0));
}
if (require.main === module) runStdin();
module.exports = { handoff, runStdin };
