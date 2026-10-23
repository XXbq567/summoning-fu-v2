'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { safeText, idOK } = require('./envelope.cjs');
const pending = () => ({ value: null, source: 'pending' });
async function readChatTitle(sessionId, { file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'session_index.jsonl') } = {}) {
  if (!idOK(sessionId)) return pending();
  let handle;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return pending();
    handle = await fs.open(file, 'r');
    const current = await handle.stat();
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size > 4 * 1024 * 1024) return pending();
    const bytes = Buffer.alloc(current.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    let found = null, latest = -Infinity;
    for (const line of bytes.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (line.length > 16384) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row?.id !== sessionId || typeof row.thread_name !== 'string') continue;
      const stamp = Date.parse(row.updated_at);
      if (!Number.isFinite(stamp) || stamp < latest) continue;
      const value = safeText(row.thread_name, 240);
      if (value) { found = value; latest = stamp; }
    }
    return found ? { value: found, source: 'codex-session-index' } : pending();
  } catch { return pending(); }
  finally { await handle?.close().catch(() => {}); }
}
module.exports = { readChatTitle };
