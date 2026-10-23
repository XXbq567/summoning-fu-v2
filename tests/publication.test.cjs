'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../scripts/publication-core.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(path.resolve(__dirname, '..'), '.publication-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function write(relative, content = 'fixture') { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
  return { root, write };
}
test('publication paths reject traversal, absolute paths, private outputs and sensitive filenames', () => {
  for (const value of ['../outside', 'C:/outside', '/outside', 'renderer/../secret', 'renderer\\..\\secret', 'desktop/NUL.js', 'desktop/file.']) assert.throws(() => core.safeRelative(value));
  for (const name of ['docs/QA/report.json', 'reference/original-reference.jpg', 'config/display-aliases.json', '.env', 'desktop/private.pem']) assert.throws(() => core.scanPublicFile(name, Buffer.from('safe')));
  assert.doesNotThrow(() => core.scanPublicFile('tests/example.test.cjs', Buffer.from("const example = 'C:/work/example';")));
});
test('public content scanning rejects personal home paths and credentials without echoing values', () => {
  const secrets = ['C:' + '/Users/' + 'PrivateTester/project', '-----BEGIN ' + 'PRIVATE KEY-----', 'ghp_' + 'A'.repeat(36), 'https://user:pass@example.test/path'];
  for (const secret of secrets) {
    let message; try { core.scanPublicFile('desktop/example.js', Buffer.from(secret)); } catch (error) { message = error.message; }
    assert.ok(message); assert.ok(!message.includes(secret));
  }
  assert.throws(() => core.scanPublicFile('desktop/example.js', Buffer.from('unique-person-name'), { forbiddenTerms: ['unique-person-name'] }));
  assert.throws(() => core.scanPublicFile('.gitignore', Buffer.from('unique-person-name'), { forbiddenTerms: ['unique-person-name'] }));
});
test('source reads reject symbolic directory links and cannot escape the source root', async t => {
  const { root, write } = await fixture(t); await write('inside/file.txt', 'safe');
  await fs.symlink(path.join(root, 'inside'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(core.readSourceFile(root, 'link/file.txt'), /symbolic|boundary/i);
  await assert.rejects(core.readSourceFile(root, '../outside'), /relative|boundary|traversal/i);
});
test('private archive is unique, hashes original source, retains evidence and excludes copied runtimes and fixtures', async t => {
  const { root, write } = await fixture(t);
  await write('renderer/core.js', 'original'); await write('reference/original-reference.jpg', 'internal');
  await write('plugin/.codex-plugin/plugin.json', '{}');
  await write('docs/QA/run/report.json', '{}'); await write('docs/QA/run/captures/paper.png', 'image');
  await write('docs/QA/run/fixture-codex-home/sessions/private.jsonl', 'fixture'); await write('docs/QA/runtime/Summoning-Fu.exe', 'binary');
  await write('dist/old/private.txt', 'not recursive'); await write('node_modules/package/file.js', 'dependency');
  const first = await core.archiveMilestone(root), second = await core.archiveMilestone(root);
  assert.notEqual(first.output, second.output);
  const manifest = JSON.parse(await fs.readFile(first.manifest, 'utf8'));
  assert.equal(manifest.classification, 'PRIVATE_LOCAL_ONLY');
  assert.deepEqual(manifest.files.map(f => f.path).sort(), ['docs/QA/run/captures/paper.png', 'docs/QA/run/report.json', 'plugin/.codex-plugin/plugin.json', 'reference/original-reference.jpg', 'renderer/core.js']);
  assert.ok(manifest.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.ok(manifest.excluded.some(f => f.path === 'dist' && f.reason));
  assert.equal(await fs.readFile(path.join(first.source, 'renderer/core.js'), 'utf8'), 'original');
});
test('public transformation preserves runtime source but replaces package documentation references', () => {
  const desktop = "for (const item of ['desktop', 'docs/PRIVATE.md']) {}\nconst x=path.join(root, 'docs/VERIFICATION-WINDOWS.md');";
  const transformed = core.transformPublicFile('scripts/package-desktop.cjs', Buffer.from(desktop), ['docs/DESKTOP.md', 'docs/VERIFICATION.md']);
  assert.doesNotMatch(transformed.toString(), /PRIVATE|docs\/VERIFICATION-WINDOWS/);
  assert.match(transformed.toString(), /docs\/VERIFICATION.md/);
  const source = Buffer.from('original runtime'); assert.deepEqual(core.transformPublicFile('desktop/main.cjs', source, []), source);
});

test('public export uses reviewed templates, preserves runtime bytes, excludes private material and fails closed before another output', async t => {
  const { root, write } = await fixture(t);
  for (const tree of ['renderer', 'desktop', 'adapter', 'plugin', 'preview', 'tests', 'assets/fonts', 'vendor/licenses']) await write(tree + '/example.js', 'original fixture');
  await write('tests/publication.test.cjs', 'private exporter test');
  for (const name of ['config/task-envelope.schema.json', 'config/task.example.json', 'config/display-aliases.example.json', 'package-lock.json']) await write(name, '{}');
  await write('package.json', JSON.stringify({ version: '0.4.1', license: 'UNLICENSED', scripts: { test: 'node --test tests/*.test.cjs', 'check:plugin-hooks': 'private probe' } }));
  for (const name of ['START-SUMMONING-FU.cmd', 'PREVIEW-MOTION.cmd', 'THIRD-PARTY-NOTICES.md']) await write(name, 'public fixture');
  for (const name of ['build-preview.cjs', 'build-font-coverage.cjs', 'start-desktop.cjs', 'qa-plugin-entrance.cjs', 'qa-motion-preview.cjs']) await write('scripts/' + name, 'original fixture');
  await write('scripts/package-desktop.cjs', "for (const item of ['desktop', 'docs/PRIVATE.md']) {}\nconst x=path.join(root, 'docs/VERIFICATION-WINDOWS.md');");
  await write('scripts/package-plugin.cjs', "const RUNTIME_FILES = new Set(['resources/app.asar']);\n  await fs.copyFile(path.join(root, 'docs/MOTION-PREVIEW.md'), path.join(plugin, 'MOTION-PREVIEW.md'));\n  await fs.copyFile(path.join(root, 'docs/MOTION-VERIFICATION-old.md'), path.join(plugin, 'old.md'));");
  for (const name of ['README.md', '00-START-HERE.txt', '03-ACCEPTANCE.txt', 'capability.json', 'docs/DESKTOP.md', 'docs/ADAPTER.md', 'docs/PLUGIN.md', 'docs/MOTION-PREVIEW.md', 'docs/VERIFICATION.md', 'docs/PUBLICATION-NOTES.md']) await write('docs/public/' + name, 'reviewed public template');
  await write('docs/QA/private.jsonl', 'private evidence'); await write('reference/original-reference.jpg', 'internal'); await write('config/hooks.example.json', 'private legacy path');
  const exported = await core.preparePublicSnapshot(root, { forbiddenTerms: ['private-person'] });
  const manifest = JSON.parse(await fs.readFile(exported.manifest, 'utf8'));
  assert.equal(manifest.classification, 'PUBLIC_SOURCE_REVIEW_CANDIDATE');
  assert.equal(await fs.readFile(path.join(exported.source, 'desktop/example.js'), 'utf8'), 'original fixture');
  assert.equal(await fs.readFile(path.join(exported.source, 'README.md'), 'utf8'), 'reviewed public template');
  assert.equal(JSON.parse(await fs.readFile(path.join(exported.source, 'package.json'), 'utf8')).license, 'UNLICENSED');
  assert.ok(manifest.files.every(file => !/docs\/QA|reference\/|hooks\.example|publication\.test/.test(file.path)));
  const before = await fs.readdir(path.join(root, 'dist/archives'));
  await write('desktop/example.js', 'private-person');
  await assert.rejects(core.preparePublicSnapshot(root, { forbiddenTerms: ['private-person'] }), /personal-identifier/);
  assert.deepEqual(await fs.readdir(path.join(root, 'dist/archives')), before);
  await write('desktop/example.js', 'safe'); await write('docs/public/desktop/main.cjs', 'unapproved override');
  await assert.rejects(core.preparePublicSnapshot(root, { forbiddenTerms: [] }), /Unexpected public template/);
});
