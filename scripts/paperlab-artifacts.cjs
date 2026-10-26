'use strict';
const fs = require('node:fs');
const path = require('node:path');
function assertPaperlabArtifacts(root) {
  const runtime = path.join(root, 'renderer/generated/paperlab-runtime.js');
  let stat;
  try { stat = fs.lstatSync(runtime); } catch { throw Error('Paperlab runtime missing. Run npm run build:paperlab first.'); }
  if (!stat.isFile() || stat.size < 1000 || stat.size > 32 * 1024 * 1024 || !fs.readFileSync(runtime, 'utf8').includes('RitualPaperlab')) throw Error('Paperlab runtime missing or invalid. Rebuild the local runtime.');
  const licenseRoot = path.join(root, 'licenses/third-party'), licenseFiles = [];
  function inventory(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) throw Error('Linked third-party notice is not allowed.');
      if (item.isDirectory()) inventory(path.join(directory, item.name), relative + '/');
      else if (item.isFile()) licenseFiles.push(relative);
    }
  }
  inventory(licenseRoot);
  for (const file of ['paperlab-0.8.1/LICENSE', 'paperlab-0.8.1/NOTICE', 'SOURCE.json']) if (!licenseFiles.includes(file)) throw Error('Required Paperlab notice missing: ' + file);
  return Object.freeze({ runtime, runtimeBytes: stat.size, licenseRoot, licenseFiles: Object.freeze(licenseFiles.sort()) });
}
module.exports = { assertPaperlabArtifacts };
