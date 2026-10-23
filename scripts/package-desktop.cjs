'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const root = path.resolve(__dirname, '..');
async function build() {
  await require('./build-paperlab.cjs').build();
  assertPaperlabArtifacts(root);
  const { packager } = await import('@electron/packager');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(root, 'dist', 'staging-' + crypto.randomUUID());
  const output = path.join(root, 'dist', 'releases', stamp);
  await fs.mkdir(staging, { recursive: true });
  const licenses = path.join(root, 'vendor', 'licenses'); await fs.mkdir(licenses, { recursive: true });
  await fs.copyFile(path.join(root, 'node_modules', 'electron', 'LICENSE'), path.join(licenses, 'electron-LICENSE.txt'));
  await fs.copyFile(path.join(root, 'node_modules', '@electron', 'packager', 'LICENSE'), path.join(licenses, 'electron-packager-LICENSE.txt'));
  // Deliberate allowlist. No sessions, screenshots, reference images or captured task text.
  for (const item of ['desktop', 'renderer', 'adapter', 'config/task-envelope.schema.json', 'config/display-aliases.example.json', 'assets/fonts', 'vendor/licenses', 'licenses/third-party', 'package.json', 'package-lock.json', 'THIRD-PARTY-NOTICES.md', 'capability.json', 'docs/DESKTOP.md', 'docs/ADAPTER.md', 'docs/PLUGIN.md', 'docs/MOTION-PREVIEW.md', 'docs/SEND-INTEGRATION-2026-10-23.md', 'docs/PAPERLAB-IMPLEMENTATION-2026-10-23.md', 'docs/PAPERLAB-VERIFICATION-2026-10-23.md', 'docs/PAPERLAB-UPGRADE-2026-10-23.md', 'docs/MOTION-VERIFICATION-2026-10-22.md', 'docs/DEFAULT-MOTION-VERIFICATION-2026-10-23.md', 'docs/PLUGIN-CAPABILITY-RESEARCH.md', 'docs/UPGRADE-PLAN.md', 'docs/UPGRADE-VERIFICATION.md', 'docs/VERIFICATION-WINDOWS.md', '00-START-HERE.txt', '03-ACCEPTANCE.txt']) {
    const destination = path.join(staging, item); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(root, item), destination, { recursive: true, errorOnExist: true, force: false });
  }
  // Supply metadata explicitly: never walk unrelated parent package.json files for author inference.
  const paths = await packager({ dir: staging, out: output, name: 'Summoning-Fu', executableName: 'Summoning-Fu', platform: 'win32', arch: 'x64', electronVersion: '44.9.3', appVersion: '0.5.0', win32metadata: { CompanyName: 'Summoning Fu local project', FileDescription: 'Codex companion Pet' }, overwrite: false, prune: false, asar: true, appCopyright: 'Summoning Fu original project; third party components retain their licenses' });
  for (const destination of paths) {
    const helperDirectory = path.join(destination, 'resources', 'send-observer');
    await fs.mkdir(helperDirectory, { recursive: true });
    await fs.copyFile(path.join(root, 'desktop/windows-send-observer.ps1'), path.join(helperDirectory, 'windows-send-observer.ps1'));
    await fs.copyFile(path.join(root, 'config/display-aliases.example.json'), path.join(destination, 'display-aliases.example.json'));
    await fs.copyFile(path.join(root, 'docs/DESKTOP.md'), path.join(destination, 'README.md'));
    await fs.copyFile(path.join(root, 'docs/VERIFICATION-WINDOWS.md'), path.join(destination, 'VERIFICATION-WINDOWS.md'));
    await fs.copyFile(path.join(root, 'docs/SEND-INTEGRATION-2026-10-23.md'), path.join(destination, 'SEND-INTEGRATION-2026-10-23.md'));
  }
  process.stdout.write(JSON.stringify({ output: paths, staging, sourceContents: 'allowlisted; no user session data' }, null, 2) + '\n');
}
if (require.main === module) build().catch(error => { process.stderr.write('Desktop packaging failed: ' + (error.stack || error.message) + '\n'); process.exitCode = 1; });
module.exports = { build };
