'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const root = path.resolve(__dirname, '..');
const RUNTIME_FILES = new Set(['Summoning-Fu.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'display-aliases.example.json', 'README.md', 'resources/app.asar']);
// Reviewed portable launchers/reports are not runtime dependencies and must
// never be inherited as plugin launch instructions or user configuration.
const PORTABLE_ONLY = new Set(['PREVIEW.cmd', 'NORMAL.cmd', 'START.cmd', 'SOURCE-MANIFEST.json', 'README.txt', 'PACKAGE-VERIFICATION.json', 'VERIFICATION.json', 'VERIFICATION.md', 'PREVIEW-ACCEPTANCE.json', 'resources/default_app.asar']);
function validatePackageVersion(projectVersion, pluginVersion, runtimeVersion) {
  if (typeof projectVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(projectVersion) || projectVersion !== pluginVersion || projectVersion !== runtimeVersion) throw Error('Project, plugin and desktop runtime versions must match. Rebuild the current desktop first.');
  return projectVersion;
}
async function copyRuntime(source, destination) {
  const files = [];
  async function inventory(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory() && (relative === 'locales' || relative === 'resources' || relative === 'resources/send-observer')) await inventory(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile() && (RUNTIME_FILES.has(relative) || relative === 'resources/send-observer/windows-send-observer.ps1' || /^locales\/[A-Za-z0-9_-]+\.pak$/.test(relative))) files.push(relative);
      else if (!(entry.isFile() && PORTABLE_ONLY.has(relative))) throw Error('Unexpected runtime file: ' + relative + '. Rebuild a clean desktop package.');
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
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const pluginMetadata = JSON.parse(await fs.readFile(path.join(root, 'plugin/.codex-plugin/plugin.json'), 'utf8'));
  const version = validatePackageVersion(metadata.version, pluginMetadata.version, JSON.parse((await readRuntime('package.json')).toString('utf8')).version);
  async function verifySources(directory) {
    for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory + '/' + item.name;
      if (item.isDirectory()) await verifySources(relative);
      else if (item.isFile() && !(await fs.readFile(path.join(root, relative))).equals(await readRuntime(relative))) throw Error('Stale desktop runtime source: ' + relative + '. Rebuild desktop.');
    }
  }
  for (const directory of ['desktop', 'renderer', 'adapter', 'assets/fonts', 'assets/providers', 'licenses/third-party']) await verifySources(directory);
  const includedFiles = ['package.json', 'package-lock.json', 'THIRD-PARTY-NOTICES.md', 'config/task-envelope.schema.json', 'config/display-aliases.example.json', 'config/provider-catalog.json', 'README.md', 'INSTALL.md', 'AGENTS.md', 'CLAUDE.md'];
  const includedDocs = ["docs/PUBLIC-VERIFICATION.md","docs/ARCHITECTURE.md","docs/SETUP.md","docs/DECISIONS.md","docs/KNOWN_ISSUES.md","docs/TESTING.md","docs/HANDOVER.md"];
  for (const file of [...includedFiles, ...includedDocs]) {
    if (!(await fs.readFile(path.join(root, file))).equals(await readRuntime(file))) throw Error('Stale desktop runtime document: ' + file + '. Rebuild desktop.');
  }
  if (!(await fs.readFile(path.join(root, 'desktop/windows-send-observer.ps1'))).equals(await fs.readFile(path.join(desktop, 'resources/send-observer/windows-send-observer.ps1')))) throw Error('Stale external send observer helper. Rebuild desktop.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(root, 'dist', 'plugins', 'summoning-fu-' + version + '-win32-x64-' + stamp);
  const plugin = path.join(output, 'plugins', 'summoning-fu');
  await fs.mkdir(plugin, { recursive: true });
  if (await fs.stat(path.join(root, 'plugin/plugin.json')).then(() => true, () => false)) throw Error('Portable root plugin.json suppresses hooks in this client. Use legacy-only manifest.');
  for (const item of ['.codex-plugin', 'hooks', 'scripts']) await fs.cp(path.join(root, 'plugin', item), path.join(plugin, item), { recursive: true, force: false, errorOnExist: true });
  await fs.mkdir(path.join(plugin, 'adapter'));
  for (const item of ['envelope.cjs', 'chat-title.cjs', 'entrance-event.cjs', 'paginated-state.cjs']) await fs.copyFile(path.join(root, 'adapter', item), path.join(plugin, 'adapter', item));
  await copyRuntime(desktop, path.join(plugin, 'runtime'));
  for (const doc of ["README.md","INSTALL.md","AGENTS.md","CLAUDE.md","docs/PUBLIC-VERIFICATION.md","docs/ARCHITECTURE.md","docs/SETUP.md","docs/DECISIONS.md","docs/KNOWN_ISSUES.md","docs/TESTING.md","docs/HANDOVER.md","config/provider-catalog.json","assets/providers/USAGE.md","assets/providers/SOURCE.json","assets/providers/openai-black-monoblossom.svg","assets/providers/generic-summoning-mark.svg","assets/fonts/OFL.txt","assets/fonts/NOTICE.txt","assets/fonts/SOURCE.json"]) { const destination = path.join(plugin, doc); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(path.join(root, doc), destination); }
  await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(plugin, 'THIRD-PARTY-NOTICES.md'));
  await fs.cp(path.join(root, 'vendor/licenses'), path.join(plugin, 'licenses'), { recursive: true });
  await fs.cp(path.join(root, 'licenses/third-party'), path.join(plugin, 'licenses/third-party'), { recursive: true, force: false, errorOnExist: true });
  const market = { name: 'summoning-fu-local', interface: { displayName: 'Summoning Fu local' }, plugins: [{ name: 'summoning-fu', source: { source: 'local', path: './plugins/summoning-fu' } }] };
  await fs.mkdir(path.join(output, '.agents', 'plugins'), { recursive: true });
  await fs.writeFile(path.join(output, '.agents', 'plugins', 'marketplace.json'), JSON.stringify(market, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'README.md'), "# 召唤符本地插件市场\n\n这是本地市场根目录。请保留完整目录结构及隐藏的 `.agents` 文件夹。\n\n安装、信任和移除步骤见 [安装指南](plugins/summoning-fu/INSTALL.md)。不要直接运行来源不明的安装脚本。\n\n" + 'Release: https://github.com/XXbq567/summoning-fu-v2/releases/tag/v' + version + '\n');
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
  await fs.writeFile(path.join(output, 'INTEGRITY.json'), JSON.stringify({ version, platform: 'win32-x64', nodePrerequisite: '>=22 (installed locally)', files: integrity }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, plugin, marketplace: path.join(output, '.agents', 'plugins', 'marketplace.json'), runtime: desktop, installed: false, hooksTrusted: false }, null, 2) + '\n');
}
if (require.main === module) build().catch(e => { process.stderr.write('Plugin packaging failed: ' + e.message + '\n'); process.exitCode = 1; });
module.exports = { build, copyRuntime, validatePackageVersion };
