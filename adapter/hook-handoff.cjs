#!/usr/bin/env node
'use strict';
// Fail-open local handoff. It never emits prompt text (or any developer context) on stdout.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { sanitizeHook } = require('./hook.cjs');
async function handoff(input, directory) {
  const value = sanitizeHook(input);
  if (!value || !path.isAbsolute(directory)) return false;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  // Spool is intentionally bounded. If full, drop this visual-only event, never block the host.
  if ((await fs.readdir(directory)).length >= 256) return false;
  const file = path.join(directory, crypto.randomUUID() + '.json');
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, event: value }), { flag: 'wx', mode: 0o600 });
  return true;
}
async function main() {
  const index = process.argv.indexOf('--spool');
  const directory = index >= 0 ? process.argv[index + 1] : path.resolve(__dirname, '../.runtime/hook-spool');
  let bytes = 0; const chunks = [];
  const deadline = setTimeout(() => process.exit(0), 900);
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length; if (bytes > 256 * 1024) return;
      chunks.push(chunk);
    }
    await handoff(JSON.parse(Buffer.concat(chunks).toString('utf8')), directory);
  } catch { /* This optional display integration never changes model execution. */ }
  finally { clearTimeout(deadline); }
}
if (require.main === module) main().then(() => { process.exitCode = 0; }, () => { process.exitCode = 0; });
module.exports = { handoff };
