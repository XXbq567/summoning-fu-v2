'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const profile = path.join(root, 'qa', 'roll-local', 'profile-' + crypto.randomBytes(8).toString('hex'));
const entry = path.join(root, 'desktop', 'roll-preview-main.cjs');
const buildScript = path.join(root, 'scripts', 'build-paperlab.cjs');
if (args.includes('--dry-run')) process.stdout.write(JSON.stringify({ entry, buildScript, profile, source: 'local-project-only' }) + '\n');
else {
  try {
    const built = spawnSync(process.execPath, [buildScript], { cwd: root, shell: false, windowsHide: true, stdio: 'inherit', timeout: 60000 });
    if (built.error || built.status !== 0 || !fs.existsSync(path.join(root, 'renderer', 'generated', 'paperlab-runtime.js'))) throw Error('本地卷纸资源构建失败，没有打开旧版替代效果。');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const detached = args.includes('--detached');
    const child = spawn(require('electron'), [entry, '--roll-preview-only', '--user-data-dir=' + profile], { cwd: root, env, shell: false, windowsHide: false, detached, stdio: detached ? 'ignore' : 'inherit' });
    child.once('error', () => { process.stderr.write('独立卷纸预览未能启动，请检查本地依赖。\n'); process.exitCode = 1; });
    if (detached) child.unref(); else child.once('exit', code => { process.exitCode = code || 0; });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
