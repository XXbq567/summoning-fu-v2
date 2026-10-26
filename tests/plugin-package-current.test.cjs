'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Packaging = require('../scripts/package-plugin.cjs');
test('portable launch/report files are explicitly ignored while runtime unknowns remain fatal', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'summoning-package-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), destination = path.join(dir, 'out'); await fs.mkdir(source);
  await fs.mkdir(path.join(source, 'resources'));
  await fs.writeFile(path.join(source, 'resources', 'default_app.asar'), 'Electron welcome fixture must not ship');
  for (const file of ['Summoning-Fu.exe', 'PREVIEW.cmd', 'NORMAL.cmd', 'START.cmd', 'SOURCE-MANIFEST.json', 'README.txt', 'PACKAGE-VERIFICATION.json', 'VERIFICATION.json', 'VERIFICATION.md', 'PREVIEW-ACCEPTANCE.json']) await fs.writeFile(path.join(source, file), 'synthetic');
  await Packaging.copyRuntime(source, destination);
  assert.deepEqual(await fs.readdir(destination), ['Summoning-Fu.exe']);
  await fs.writeFile(path.join(source, 'personal.json'), 'PRIVATE');
  await assert.rejects(Packaging.copyRuntime(source, path.join(dir, 'bad')), /Unexpected runtime/);
});
test('plugin metadata version is derived from project and mismatches fail closed', () => {
  assert.equal(typeof Packaging.validatePackageVersion, 'function');
  assert.equal(Packaging.validatePackageVersion('0.6.2', '0.6.2', '0.6.2'), '0.6.2');
  for (const versions of [['0.6.2', '0.5.0', '0.6.2'], ['0.6.2', '0.6.2', '0.5.0'], ['bad', 'bad', 'bad']]) assert.throws(() => Packaging.validatePackageVersion(...versions), /version/i);
});
