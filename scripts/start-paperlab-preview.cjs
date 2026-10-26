'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const options = process.argv.slice(2);
const profile = path.join(root, 'qa', 'paperlab-preview-local', 'summoning-fu-preview-local-' + crypto.randomBytes(8).toString('hex'));
const args = [root, '--paperlab-preview-only', '--user-data-dir=' + profile, '--motion-preview'];
const buildScript = path.join(root, 'scripts', 'build-paperlab.cjs');
if (options.includes('--dry-run')) process.stdout.write(JSON.stringify({ args, buildScript, source: 'local-project-only' }) + '\n');
else {
  try {
    if (!fs.existsSync(buildScript)) throw new Error('本地 Paperlab 构建入口尚未就绪。');
    const built = spawnSync(process.execPath, [buildScript], { cwd: root, shell: false, windowsHide: true, stdio: 'inherit', timeout: 60000 });
    if (built.error || built.status !== 0 || !fs.existsSync(path.join(root, 'renderer/generated/paperlab-runtime.js'))) throw new Error('Paperlab 本地资源构建失败；没有打开旧版替代效果。');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const detached = options.includes('--detached');
    const child = spawn(require('electron'), args, { cwd: root, env, shell: false, windowsHide: false, detached, stdio: detached ? 'ignore' : 'inherit' });
    child.on('error', () => { process.stderr.write('Paperlab 独立预览未能启动。请检查项目本地依赖。\n'); process.exitCode = 1; });
    if (detached) child.unref(); else child.on('exit', code => { process.exitCode = code || 0; });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
