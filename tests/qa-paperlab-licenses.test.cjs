'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectPaperlabArchive, collectInstalledNotices, inspectBundleScope } = require('../scripts/qa-paperlab-licenses.cjs');
const root = path.resolve(__dirname, '..');
const integrity = 'sha512-PKXArVLRDzxWMgsNOH0mNw9PzQkc8vDBoLDXJVpxQTNm9DB2Rexis7V7vgWOKXVhRsnF67rIkVfGvHxwXLiXcw==';

test('Paperlab source notice is copied from the verified fixed archive, with its Apache copyright', () => {
  const archive = fs.readFileSync(path.join(root, 'qa/burn-research/paperlab-0.8.1.tgz'));
  const result = inspectPaperlabArchive(archive, integrity);
  assert.equal(result.manifest.name, 'paperlab'); assert.equal(result.manifest.version, '0.8.1');
  assert.equal(result.manifest.license, 'Apache-2.0');
  assert.match(result.license, /Apache License[\s\S]*Version 2\.0[\s\S]*Copyright 2026 Noor Mtir/);
  assert.match(result.notice, /Redistributions[\s\S]*NOTICE[\s\S]*Section 4\(d\)/);
  assert.throws(() => inspectPaperlabArchive(archive, 'sha512-invalid'), /integrity/);
});
test('distribution scope counts emitted bundle bytes and excludes parsed-only optional models and build tools',()=>{
 assert.equal(typeof inspectBundleScope,'function');
 const scope=inspectBundleScope(root),rows=collectInstalledNotices(root);
 assert.equal(scope.output,'renderer/generated/paperlab-runtime.js');assert.deepEqual(scope.externalImports,[]);
 assert.ok(scope.packages['node_modules/paperlab']>0);
 for(const name of ['@mediapipe/tasks-vision','draco3d','maath','stats-gl'])assert.equal(scope.packages['node_modules/'+name]||0,0);
 for(const row of rows.filter(row=>scope.packages[row.packagePath]>0))assert.ok(row.files.length,'missing shipped license: '+row.name);
 assert.equal(scope.packages['node_modules/esbuild']||0,0);
});

test('installed Paperlab runtime notices preserve actual dependency licenses, including GSAP custom terms', () => {
  const rows = collectInstalledNotices(root);
  for (const name of ['paperlab', 'react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', 'gsap']) {
    const row = rows.find(row => row.name === name);
    assert.ok(row, `missing installed dependency notice: ${name}`);
    assert.ok(row.files.length, `missing original license file: ${name}`);
  }
  assert.equal(rows.find(row => row.name === 'paperlab').license, 'Apache-2.0');
  const gsap = rows.find(row => row.name === 'gsap');
  assert.notEqual(gsap.license, 'MIT');
  assert.ok(gsap.files.some(file => /standard|license|greensock|webflow/i.test(file.content)));
});
