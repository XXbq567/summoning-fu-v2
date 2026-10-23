'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const root = path.resolve(__dirname, '..');
const RUNTIME_FILES = new Set(['Summoning-Fu.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'display-aliases.example.json', 'README.md', 'VERIFICATION-WINDOWS.md', 'SEND-INTEGRATION-2026-10-23.md', 'resources/app.asar']);
async function copyRuntime(source, destination) {
  const files = [];
  async function inventory(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory() && (relative === 'locales' || relative === 'resources' || relative === 'resources/send-observer')) await inventory(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile() && (RUNTIME_FILES.has(relative) || relative === 'resources/send-observer/windows-send-observer.ps1' || /^locales\/[A-Za-z0-9_-]+\.pak$/.test(relative))) files.push(relative);
      else throw Error('Unexpected runtime file: ' + relative + '. Rebuild a clean desktop package.');
    }
  }
  // Validate the whole tree before copying anything. Personal config and QA artifacts are never included.
  await inventory(source);
  for (const relative of files) {
    const dest = path.join(destination, relative); await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(source, relative), dest, require('node:fs').constants.COPYFILE_EXCL);
  }
}
async function archiveReader(file) {
  const handle = await fs.open(file, 'r');
  try {
    const prefix = Buffer.alloc(16); await handle.read(prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (jsonSize > 8 * 1024 * 1024) throw Error('Unexpected ASAR header size');
    const header = Buffer.alloc(jsonSize); await handle.read(header, 0, header.length, 16);
    const tree = JSON.parse(header.toString('utf8'));
    return async name => {
      let entry = tree; for (const part of name.split('/')) entry = entry.files?.[part];
      if (!entry || entry.unpacked || !Number.isSafeInteger(entry.size) || entry.size > 32 * 1024 * 1024) throw Error('Missing/invalid archive source: ' + name);
      const bytes = Buffer.alloc(entry.size), h = await fs.open(file, 'r');
      try { await h.read(bytes, 0, bytes.length, 8 + headerSize + Number(entry.offset)); } finally { await h.close(); }
      return bytes;
    };
  } finally { await handle.close(); }
}
async function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This release packages Windows x64 only.');
  assertPaperlabArtifacts(root);
  const releaseRoot = path.join(root, 'dist', 'releases');
  const releases = (await fs.readdir(releaseRoot, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse();
  let desktop;
  for (const release of releases) {
    const candidate = path.join(releaseRoot, release, 'Summoning-Fu-win32-x64');
    try { if ((await fs.stat(path.join(candidate, 'Summoning-Fu.exe'))).isFile()) { desktop = candidate; break; } } catch {}
  }
  if (!desktop) throw Error('Run npm run package:desktop first.');
  const readRuntime = await archiveReader(path.join(desktop, 'resources', 'app.asar'));
  if (JSON.parse((await readRuntime('package.json')).toString('utf8')).version !== '0.5.0') throw Error('Latest desktop runtime is not v0.5.0. Rebuild desktop first.');
  async function verifySources(directory) {
    for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory + '/' + item.name;
      if (item.isDirectory()) await verifySources(relative);
      else if (item.isFile() && !(await fs.readFile(path.join(root, relative))).equals(await readRuntime(relative))) throw Error('Stale desktop runtime source: ' + relative + '. Rebuild desktop.');
    }
  }
  for (const directory of ['desktop', 'renderer', 'adapter', 'licenses/third-party']) await verifySources(directory);
  for (const file of ['THIRD-PARTY-NOTICES.md', 'docs/PAPERLAB-IMPLEMENTATION-2026-10-23.md', 'docs/PAPERLAB-VERIFICATION-2026-10-23.md', 'docs/PAPERLAB-UPGRADE-2026-10-23.md']) {
    if (!(await fs.readFile(path.join(root, file))).equals(await readRuntime(file))) throw Error('Stale desktop runtime document: ' + file + '. Rebuild desktop.');
  }
  if (!(await fs.readFile(path.join(root, 'desktop/windows-send-observer.ps1'))).equals(await fs.readFile(path.join(desktop, 'resources/send-observer/windows-send-observer.ps1')))) throw Error('Stale external send observer helper. Rebuild desktop.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(root, 'dist', 'plugins', 'summoning-fu-0.5.0-win32-x64-' + stamp);
  const plugin = path.join(output, 'plugins', 'summoning-fu');
  await fs.mkdir(plugin, { recursive: true });
  if (await fs.stat(path.join(root, 'plugin/plugin.json')).then(() => true, () => false)) throw Error('Portable root plugin.json suppresses hooks in this client. Use legacy-only manifest.');
  for (const item of ['.codex-plugin', 'hooks', 'scripts']) await fs.cp(path.join(root, 'plugin', item), path.join(plugin, item), { recursive: true, force: false, errorOnExist: true });
  await fs.mkdir(path.join(plugin, 'adapter'));
  for (const item of ['envelope.cjs', 'chat-title.cjs', 'entrance-event.cjs']) await fs.copyFile(path.join(root, 'adapter', item), path.join(plugin, 'adapter', item));
  await copyRuntime(desktop, path.join(plugin, 'runtime'));
  await fs.copyFile(path.join(root, 'docs/PLUGIN.md'), path.join(plugin, 'README.md'));
  await fs.copyFile(path.join(root, 'docs/MOTION-PREVIEW.md'), path.join(plugin, 'MOTION-PREVIEW.md'));
  await fs.copyFile(path.join(root, 'docs/SEND-INTEGRATION-2026-10-23.md'), path.join(plugin, 'SEND-INTEGRATION-2026-10-23.md'));
  for (const file of ['PAPERLAB-IMPLEMENTATION-2026-10-23.md', 'PAPERLAB-VERIFICATION-2026-10-23.md', 'PAPERLAB-UPGRADE-2026-10-23.md']) await fs.copyFile(path.join(root, 'docs', file), path.join(plugin, file));
  await fs.copyFile(path.join(root, 'docs/MOTION-VERIFICATION-2026-10-22.md'), path.join(plugin, 'MOTION-VERIFICATION-2026-10-22.md'));
  await fs.copyFile(path.join(root, 'docs/DEFAULT-MOTION-VERIFICATION-2026-10-23.md'), path.join(plugin, 'DEFAULT-MOTION-VERIFICATION-2026-10-23.md'));
  await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(plugin, 'THIRD-PARTY-NOTICES.md'));
  await fs.cp(path.join(root, 'vendor/licenses'), path.join(plugin, 'licenses'), { recursive: true });
  await fs.cp(path.join(root, 'licenses/third-party'), path.join(plugin, 'licenses/third-party'), { recursive: true, force: false, errorOnExist: true });
  const market = { name: 'summoning-fu-local', interface: { displayName: 'Summoning Fu local' }, plugins: [{ name: 'summoning-fu', source: { source: 'local', path: './plugins/summoning-fu' } }] };
  await fs.mkdir(path.join(output, '.agents', 'plugins'), { recursive: true });
  await fs.writeFile(path.join(output, '.agents', 'plugins', 'marketplace.json'), JSON.stringify(market, null, 2) + '\n');
  const integrity = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('No symlinks in distributable');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) integrity.push({ path: path.relative(output, file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') });
    }
  }
  await walk(output);
  await fs.writeFile(path.join(output, 'INTEGRITY.json'), JSON.stringify({ version: '0.5.0', platform: 'win32-x64', nodePrerequisite: '>=22 (installed locally)', files: integrity }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, plugin, marketplace: path.join(output, '.agents', 'plugins', 'marketplace.json'), runtime: desktop, installed: false, hooksTrusted: false }, null, 2) + '\n');
}
if (require.main === module) build().catch(e => { process.stderr.write('Plugin packaging failed: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { build, copyRuntime };
