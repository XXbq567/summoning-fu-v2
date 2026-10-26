'use strict';
// Offline integrity check. It never installs dependencies, starts the app or reads a user profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const outputRoots = new Set(['.git', 'node_modules', 'dist', 'qa']);
function relativeName(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw Error('Invalid integrity path');
  return value;
}
async function readRegular(root, name) {
  let file = root;
  for (const part of relativeName(name).split('/')) { file = path.join(file, part); if ((await fs.lstat(file)).isSymbolicLink()) throw Error('Linked integrity source'); }
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > 32n * 1024n * 1024n) throw Error('Invalid integrity source');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw Error('Integrity identity changed');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || BigInt(bytes.length) !== before.size) throw Error('Integrity source changed');
    return bytes;
  } finally { await handle.close(); }
}
async function verifyPublicSource(root = path.resolve(__dirname, '..')) {
  const stat = await fs.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid integrity root');
  const integrity = JSON.parse((await readRegular(root, 'INTEGRITY.json')).toString('utf8'));
  if (integrity.schemaVersion !== 1 || integrity.algorithm !== 'sha256' || !Array.isArray(integrity.files) || !integrity.files.length || integrity.files.length > 10000) throw Error('Invalid integrity manifest');
  const seen = new Set(['integrity.json']);
  for (const entry of integrity.files) {
    const name = relativeName(entry.path), folded = name.toLowerCase();
    if (seen.has(folded) || outputRoots.has(name.split('/')[0]) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid integrity entry');
    seen.add(folded);
    const bytes = await readRegular(root, name);
    if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Source integrity mismatch: ' + name);
  }
  async function inventory(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!prefix && (outputRoots.has(entry.name) || entry.name === 'SUMMONING-FU-PREVIEW.html')) continue;
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error('Linked unlisted integrity source');
      if (entry.isDirectory()) await inventory(path.join(directory, entry.name), name + '/');
      else if (!entry.isFile() || !seen.has(name.toLowerCase())) throw Error('Unlisted integrity source: ' + name);
    }
  }
  await inventory(root);
  return { result: 'PASS', version: integrity.version, files: integrity.files.length, algorithm: 'sha256', ignoredBuildOutputs: [...outputRoots, 'SUMMONING-FU-PREVIEW.html'] };
}
if (require.main === module) verifyPublicSource().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => { process.stderr.write('Public source integrity verification failed.\n'); process.exitCode = 1; });
module.exports = { verifyPublicSource };
