'use strict';
// Local export only. No network, Git, credentials, home-directory content or uploads.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PUBLIC_TREES = ['renderer', 'desktop', 'adapter', 'plugin', 'preview', 'tests', 'assets/fonts', 'vendor/licenses'];
const PUBLIC_FILES = ['config/task-envelope.schema.json', 'config/task.example.json', 'config/display-aliases.example.json', 'package.json', 'package-lock.json', 'START-SUMMONING-FU.cmd', 'PREVIEW-MOTION.cmd', 'THIRD-PARTY-NOTICES.md'];
const PUBLIC_SCRIPTS = ['build-preview.cjs', 'build-font-coverage.cjs', 'start-desktop.cjs', 'package-desktop.cjs', 'package-plugin.cjs', 'qa-plugin-entrance.cjs', 'qa-motion-preview.cjs'];
const REQUIRED_DOCS = ['README.md', '00-START-HERE.txt', '03-ACCEPTANCE.txt', 'capability.json', 'docs/DESKTOP.md', 'docs/ADAPTER.md', 'docs/PLUGIN.md', 'docs/MOTION-PREVIEW.md', 'docs/VERIFICATION.md', 'docs/PUBLICATION-NOTES.md'];
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.json', '.html', '.css', '.md', '.txt', '.cmd', '.ttf', '.pb']);
const PRIVATE_DIRS = new Set(['.git', '.codex', '.agents', '.aws', 'node_modules', 'dist']);
const QA_SKIP_DIRS = /^(?:node_modules|runtime|resources|locales|plugins|sessions|fixture.*|codex-home|plugin-data|isolated-home|home|cache)$/i;
const QA_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.png']);

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.split('/').some(v => !v || v === '.' || v === '..' || /[. ]$/.test(v) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(v)) || /[:\x00-\x1f]/.test(value)) throw Error('Invalid relative path or traversal');
  return value;
}
function within(root, file) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
async function assertRegularChain(root, relative) {
  safeRelative(relative);
  const base = path.resolve(root), baseStat = await fs.lstat(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw Error('Source root symbolic or invalid boundary');
  let current = base;
  for (const part of relative.split('/')) { current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Rejected symbolic source boundary: ' + relative); }
  if (!within(await fs.realpath(base), await fs.realpath(current))) throw Error('Source escaped real boundary: ' + relative);
  return current;
}
async function readSourceFile(root, relative) {
  const file = await assertRegularChain(root, relative);
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > 256n * 1024n * 1024n) throw Error('Nonregular or oversized source: ' + relative);
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw Error('Source identity changed: ' + relative);
    const bytes = await handle.readFile(); const after = await handle.stat({ bigint: true });
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || BigInt(bytes.length) !== before.size) throw Error('Source changed while reading: ' + relative);
    return bytes;
  } finally { await handle.close(); }
}
async function inventory(root, relative = '', excluded = [], mode = 'private') {
  const directory = relative ? await assertRegularChain(root, relative) : path.resolve(root);
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? relative + '/' + entry.name : entry.name;
    safeRelative(rel);
    const qa = rel.startsWith('docs/QA/');
    if (mode === 'private' && ((relative === '' && PRIVATE_DIRS.has(entry.name)) || (entry.isDirectory() && qa && QA_SKIP_DIRS.test(entry.name)) || (entry.isDirectory() && entry.name.startsWith('.') && rel !== 'plugin/.codex-plugin'))) { excluded.push({ path: rel, reason: 'dependency/output/private-environment or copied QA fixture/runtime directory' }); continue; }
    if (entry.isSymbolicLink()) throw Error('Rejected symbolic source: ' + rel);
    if (entry.isDirectory()) files.push(...await inventory(root, rel, excluded, mode));
    else if (entry.isFile()) {
      if (mode === 'private' && qa && (!QA_EXTENSIONS.has(path.extname(rel).toLowerCase()) || (await fs.stat(path.join(root, rel))).size > 16 * 1024 * 1024)) { excluded.push({ path: rel, reason: 'QA evidence policy: only json/jsonl/md/txt/png up to 16 MiB' }); continue; }
      if (mode === 'private' && /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|.*\.(?:pem|key|p12|pfx))$/i.test(rel)) { excluded.push({ path: rel, reason: 'credential-like filename excluded from archives' }); continue; }
      files.push(rel);
    } else throw Error('Rejected nonregular source: ' + rel);
  }
  return files;
}
function scanPublicFile(relative, bytes, { forbiddenTerms = [] } = {}) {
  safeRelative(relative);
  const segments = relative.toLowerCase().split('/');
  if (segments.some(v => ['qa', 'reference', 'native-probe', 'dist', 'node_modules', '.git', '.aws', '.codex', 'sessions', 'entrance-events', 'runtime'].includes(v)) || /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|display-aliases\.json|.*\.(?:pem|key|p12|pfx|jsonl|exe|dll|zip|asar))$/i.test(relative)) throw Error('Forbidden public path: ' + relative);
  if (relative !== '.gitignore' && !SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) throw Error('Unsupported public suffix: ' + relative);
  if (bytes.length > 20 * 1024 * 1024) throw Error('Oversized public source: ' + relative);
  const text = bytes.toString('utf8');
  const reject = type => { throw Error('Public scan rejected ' + type + ' in ' + relative); };
  for (const term of forbiddenTerms.filter(v => typeof v === 'string' && v.length >= 3)) if (text.toLowerCase().includes(term.toLowerCase())) reject('personal-identifier');
  if (/[a-z]:[\\/]+Users[\\/]+[^\s\\/"'`]+/i.test(text) || /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text)) reject('absolute-home-path');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) reject('private-key');
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/.test(text)) reject('credential-token');
  const urls = text.match(/https?:\/\/[^\s'"<>`]+/g) || [];
  for (const url of urls) {
    let parsed; try { parsed = new URL(url); } catch { continue; }
    if (parsed.username || parsed.password) {
      // This exact reserved .test URL is an existing credential-redaction unit fixture.
      if (!(relative === 'tests/adapter.test.cjs' && url === 'https://user:pass@example.test/x')) reject('credential-url');
    }
  }
}
function transformPublicFile(relative, bytes, publicDocs) {
  if (relative === 'package.json') {
    const value = JSON.parse(bytes.toString('utf8'));
    delete value.scripts['check:plugin-hooks'];
    return Buffer.from(JSON.stringify(value, null, 2) + '\n');
  }
  let text = bytes.toString('utf8');
  if (relative === 'scripts/package-desktop.cjs') {
    const required = ['desktop', 'renderer', 'adapter', 'config/task-envelope.schema.json', 'config/display-aliases.example.json', 'assets/fonts', 'vendor/licenses', 'package.json', 'package-lock.json', 'THIRD-PARTY-NOTICES.md', 'capability.json', '00-START-HERE.txt', '03-ACCEPTANCE.txt', ...publicDocs];
    const marker = /for \(const item of \[[^\]]*\]\)/;
    if ((text.match(new RegExp(marker.source, 'g')) || []).length !== 1) throw Error('Desktop packager allowlist marker changed; review required');
    text = text.replace(marker, 'for (const item of ' + JSON.stringify(required) + ')');
    text = text.replaceAll("path.join(root, 'docs/VERIFICATION-WINDOWS.md')", "path.join(root, 'docs/VERIFICATION.md')");
    const copyAnchor = "  for (const destination of paths) {";
    if (text.includes(copyAnchor)) text = text.replace(copyAnchor, copyAnchor + '\n    for (const doc of ' + JSON.stringify(publicDocs) + ") await fs.copyFile(path.join(root, doc), path.join(destination, path.basename(doc)));" );
    return Buffer.from(text);
  }
  if (relative === 'scripts/package-plugin.cjs') {
    text = text.split(/\r?\n/).filter(line => !line.includes("await fs.copyFile(path.join(root, 'docs/MOTION-VERIFICATION-") && !line.includes("await fs.copyFile(path.join(root, 'docs/DEFAULT-MOTION-VERIFICATION-")).join('\n');
    const anchor = "  await fs.copyFile(path.join(root, 'docs/MOTION-PREVIEW.md'), path.join(plugin, 'MOTION-PREVIEW.md'));";
    if (!text.includes(anchor)) throw Error('Plugin packager documentation marker changed; review required');
    text = text.replace(anchor, '  for (const doc of ' + JSON.stringify(publicDocs) + ") await fs.copyFile(path.join(root, doc), path.join(plugin, path.basename(doc)));" );
    text = text.replace("'resources/app.asar']);", "'resources/app.asar', " + publicDocs.map(name => JSON.stringify(path.posix.basename(name))).join(', ') + ']);');
    return Buffer.from(text);
  }
  return bytes;
}
async function uniqueOutput(root, kind) {
  const base = path.resolve(root);
  if ((await fs.lstat(base)).isSymbolicLink()) throw Error('Output source root cannot be symbolic');
  let directory = base;
  for (const component of ['dist', 'archives']) {
    directory = path.join(directory, component);
    try { await fs.mkdir(directory); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !within(await fs.realpath(base), await fs.realpath(directory))) throw Error('Output directory boundary rejected');
  }
  const output = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + kind + '-' + crypto.randomBytes(6).toString('hex'));
  await fs.mkdir(output, { mode: 0o700 }); return output;
}
async function writePlan(root, kind, plan, metadata) {
  const output = await uniqueOutput(root, kind), source = path.join(output, kind + '-source');
  await fs.mkdir(source, { mode: 0o700 });
  const files = [];
  for (const item of [...plan].sort((a, b) => a.path.localeCompare(b.path))) {
    const destination = path.join(source, safeRelative(item.path));
    if (!within(source, destination)) throw Error('Output escaped boundary');
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, item.bytes, { flag: 'wx', mode: 0o600 });
    files.push({ path: item.path, bytes: item.bytes.length, sha256: crypto.createHash('sha256').update(item.bytes).digest('hex') });
  }
  const manifest = path.join(output, 'MANIFEST.json');
  await fs.writeFile(manifest, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), ...metadata, files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, source, manifest, files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0) };
}
async function archiveMilestone(root) {
  const excluded = [], plan = [];
  for (const relative of await inventory(root, '', excluded, 'private')) plan.push({ path: relative, bytes: await readSourceFile(root, relative) });
  return writePlan(root, 'private', plan, { classification: 'PRIVATE_LOCAL_ONLY', public: false, excluded, limits: ['No external home/AppData/Codex reads.', 'Dependencies and build outputs excluded; reinstall from the preserved lockfile.', 'QA evidence restricted to json/jsonl/md/txt/png up to 16 MiB, copied runtime/fixture trees excluded.'] });
}
async function preparePublicSnapshot(root, options = {}) {
  const templates = await inventory(root, 'docs/public', [], 'public');
  const templateMap = new Map(templates.map(relative => [relative.slice('docs/public/'.length), relative]));
  for (const name of templateMap.keys()) if (!REQUIRED_DOCS.includes(name) && name !== 'THIRD-PARTY-NOTICES.md' && name !== '.gitignore') throw Error('Unexpected public template destination: ' + name);
  for (const name of REQUIRED_DOCS) if (!templateMap.has(name)) throw Error('Missing reviewed public template: ' + name);
  const publicDocs = [...templateMap.keys()].filter(name => name.startsWith('docs/'));
  const candidates = [];
  for (const tree of PUBLIC_TREES) candidates.push(...await inventory(root, tree, [], 'public'));
  candidates.push(...PUBLIC_FILES, ...PUBLIC_SCRIPTS.map(name => 'scripts/' + name));
  const mappings = new Map(candidates.filter(name => name !== 'tests/publication.test.cjs').map(name => [name, name]));
  for (const [destination, source] of templateMap) mappings.set(destination, source);
  const forbiddenTerms = options.forbiddenTerms || [os.userInfo().username];
  const plan = [], transformed = [];
  const caseNames = new Set();
  for (const [relative, source] of mappings) {
    if (caseNames.has(relative.toLowerCase())) throw Error('Case-colliding public destination: ' + relative);
    caseNames.add(relative.toLowerCase());
    const original = await readSourceFile(root, source), bytes = transformPublicFile(relative, original, publicDocs);
    scanPublicFile(relative, bytes, { forbiddenTerms });
    if (!bytes.equals(original)) transformed.push(relative);
    plan.push({ path: relative, bytes });
  }
  const ignored = Buffer.from('node_modules/\ndist/\ndocs/QA/\nreference/\nnative-probe/\n.env\n.env.*\nconfig/display-aliases.json\n*.log\n');
  if (!mappings.has('.gitignore')) plan.push({ path: '.gitignore', bytes: ignored });
  return writePlan(root, 'public', plan, { classification: 'PUBLIC_SOURCE_REVIEW_CANDIDATE', public: true, runtimeSourceUnmodified: true, excluded: ['docs/QA/**', 'reference/**', 'native-probe/**', 'dist/**', 'node_modules/**', 'historical internal root/docs documents', 'config/hooks.example.json (personalized legacy example)', 'config/display-aliases.json', 'scripts/probe-plugin-hooks.cjs', 'scripts/build-native-probe.cjs', 'publication/archive scripts and their private-boundary test'], transformed, templateFiles: [...templateMap.keys()].sort(), scan: { result: 'PASS', types: ['forbidden-path/suffix', 'known-local-username', 'absolute-home-path', 'private-key', 'credential-token', 'credential-url'], allowedSyntheticFixture: 'tests/adapter.test.cjs: exact reserved example.test credential-redaction fixture' }, limits: ['Source disclosure does not grant an open-source license; original project remains UNLICENSED.', 'Pattern scanning is defense in depth, not a proof of absence of all secrets.', 'No runtime binaries or machine-specific QA evidence are part of this source export.'] });
}
module.exports = { safeRelative, scanPublicFile, readSourceFile, transformPublicFile, archiveMilestone, preparePublicSnapshot };
