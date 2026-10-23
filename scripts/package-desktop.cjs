'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
(async () => {
  const { packager } = await import('@electron/packager');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(root, 'dist', 'staging-' + crypto.randomUUID());
  const output = path.join(root, 'dist', 'releases', stamp);
  await fs.mkdir(staging, { recursive: true });
  const licenses = path.join(root, 'vendor', 'licenses'); await fs.mkdir(licenses, { recursive: true });
  await fs.copyFile(path.join(root, 'node_modules', 'electron', 'LICENSE'), path.join(licenses, 'electron-LICENSE.txt'));
  await fs.copyFile(path.join(root, 'node_modules', '@electron', 'packager', 'LICENSE'), path.join(licenses, 'electron-packager-LICENSE.txt'));
  // Deliberate allowlist. No sessions, screenshots, reference images or captured task text.
  for (const item of ["desktop","renderer","adapter","config/task-envelope.schema.json","config/display-aliases.example.json","assets/fonts","vendor/licenses","package.json","package-lock.json","THIRD-PARTY-NOTICES.md","capability.json","00-START-HERE.txt","03-ACCEPTANCE.txt","docs/ADAPTER.md","docs/DESKTOP.md","docs/MOTION-PREVIEW.md","docs/PLUGIN.md","docs/PUBLICATION-NOTES.md","docs/VERIFICATION.md"]) {
    const destination = path.join(staging, item); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(root, item), destination, { recursive: true, errorOnExist: true, force: false });
  }
  // Supply metadata explicitly: never walk unrelated parent package.json files for author inference.
  const paths = await packager({ dir: staging, out: output, name: 'Summoning-Fu', executableName: 'Summoning-Fu', platform: 'win32', arch: 'x64', electronVersion: '44.9.3', appVersion: '0.4.1', win32metadata: { CompanyName: 'Summoning Fu local project', FileDescription: 'Codex companion Pet' }, overwrite: false, prune: false, asar: true, appCopyright: 'Summoning Fu original project; third party components retain their licenses' });
  for (const destination of paths) {
    for (const doc of ["docs/ADAPTER.md","docs/DESKTOP.md","docs/MOTION-PREVIEW.md","docs/PLUGIN.md","docs/PUBLICATION-NOTES.md","docs/VERIFICATION.md"]) await fs.copyFile(path.join(root, doc), path.join(destination, path.basename(doc)));
    await fs.copyFile(path.join(root, 'config/display-aliases.example.json'), path.join(destination, 'display-aliases.example.json'));
    await fs.copyFile(path.join(root, 'docs/DESKTOP.md'), path.join(destination, 'README.md'));
    await fs.copyFile(path.join(root, 'docs/VERIFICATION.md'), path.join(destination, 'VERIFICATION-WINDOWS.md'));
  }
  process.stdout.write(JSON.stringify({ output: paths, staging, sourceContents: 'allowlisted; no user session data' }, null, 2) + '\n');
})().catch(error => { process.stderr.write('Desktop packaging failed: ' + (error.stack || error.message) + '\n'); process.exitCode = 1; });
