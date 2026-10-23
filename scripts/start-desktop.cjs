'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2), detached = args.includes('--detached');
const forwarded = args.filter(a => a !== '--detached');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let executable, launchArgs;
const releases = path.join(root, 'dist', 'releases');
const latest = fs.existsSync(releases) ? fs.readdirSync(releases).sort().reverse().map(name => path.join(releases, name, 'Summoning-Fu-win32-x64', 'Summoning-Fu.exe')).find(file => fs.existsSync(file)) : null;
if (latest && !args.includes('--development')) { executable = latest; launchArgs = forwarded; }
else { executable = require('electron'); launchArgs = [root, ...forwarded.filter(a => a !== '--development')]; }
// This child is the explicitly requested GUI application. SW_HIDE would override
// its first native ShowWindow call on Windows, including the reader window.
const child = spawn(executable, launchArgs, { cwd: root, env, detached, windowsHide: false, stdio: detached ? 'ignore' : 'inherit' });
child.on('error', () => { process.stderr.write('召唤符启动失败。请检查桌面包是否完整，或安装项目锁定依赖。\n'); process.exitCode = 1; });
if (detached) child.unref(); else child.on('exit', code => { process.exitCode = code || 0; });
