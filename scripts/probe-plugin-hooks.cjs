'use strict';
// Isolated contract probe only: no user CODEX_HOME, thread creation, hook execution or trust changes.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
function cleanEnv(home) {
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'COMSPEC', 'ComSpec', 'PATHEXT']) if (process.env[key]) result[key] = process.env[key];
  result.CODEX_HOME = home;
  return result;
}
async function listHooks(executable, home, cwd) {
  const child = spawn(executable, ['app-server', '--stdio'], { cwd, env: cleanEnv(home), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', counter = 0, stderr = '';
  const pending = new Map(), methods = [];
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16384); });
  child.stdout.on('data', bytes => {
    buffer += bytes;
    if (buffer.length > 2 * 1024 * 1024) { child.kill(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    }
  });
  function request(method, params) {
    if (!['initialize', 'hooks/list'].includes(method)) throw Error('Forbidden probe method');
    methods.push(method);
    return new Promise((resolve, reject) => {
      const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(Error('Probe timed out: ' + method)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  try {
    const init = await request('initialize', { clientInfo: { name: 'summoning_fu_hook_contract_probe', version: '0.3.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
    const listing = await request('hooks/list', { cwds: [cwd] });
    return { methods, serverVersion: init?.userAgent || null, listing, stderrWarningCount: stderr.split('\n').filter(x => /warn|error/i.test(x)).length };
  } finally {
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    child.stdin.end(); child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); } });
  }
}
async function main() {
  const executable = process.argv[2];
  if (!executable || !path.isAbsolute(executable)) throw Error('Pass absolute local Codex executable path');
  const flagIndex = process.argv.indexOf('--package-root');
  const source = flagIndex >= 0 ? path.resolve(process.argv[flagIndex + 1] || '') : path.join(root, 'plugin');
  const legacyManifest = JSON.parse(await fs.readFile(path.join(source, '.codex-plugin/plugin.json'), 'utf8'));
  const output = path.join(root, 'docs', 'qa', 'plugin-hook-probe', new Date().toISOString().replace(/[:.]/g, '-'));
  const observations = [];
  for (const variant of ['portable-with-compat', 'legacy-only']) {
    const base = path.join(output, variant), home = path.join(base, 'home'), market = path.join(base, 'market'), plugin = path.join(market, 'plugins', 'summoning-fu'), cwd = path.join(base, 'work');
    await fs.mkdir(home, { recursive: true }); await fs.mkdir(cwd, { recursive: true }); await fs.mkdir(plugin, { recursive: true });
    // --package-root copies the complete built/installed package, then probes only its declarative hook loading.
    if (flagIndex >= 0) await fs.cp(source, plugin, { recursive: true });
    else for (const item of ['.codex-plugin', 'hooks', 'scripts']) await fs.cp(path.join(source, item), path.join(plugin, item), { recursive: true });
    if (variant === 'portable-with-compat') await fs.writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: legacyManifest.name, version: legacyManifest.version, description: legacyManifest.description, extensions: { 'com.openai': { hooks: legacyManifest.hooks, requires_local_executor: true, interface: legacyManifest.interface } } }, null, 2));
    else await fs.unlink(path.join(plugin, 'plugin.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await fs.mkdir(path.join(market, '.agents/plugins'), { recursive: true });
    await fs.writeFile(path.join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'summoning-fu-probe', plugins: [{ name: 'summoning-fu', source: { source: 'local', path: './plugins/summoning-fu' } }] }, null, 2));
    const options = { cwd, env: cleanEnv(home), windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 };
    const added = await run(executable, ['plugin', 'marketplace', 'add', market, '--json'], options);
    const installed = await run(executable, ['plugin', 'add', 'summoning-fu@summoning-fu-probe', '--json'], options);
    const result = await listHooks(executable, home, cwd);
    const hooks = (result.listing.data || []).flatMap(x => x.hooks || []);
    const safe = { variant, methods: result.methods, serverVersion: result.serverVersion, installed: JSON.parse(installed.stdout), hookCount: hooks.length,
      hooks: hooks.map(h => ({ eventName: h.eventName, source: h.source, pluginId: h.pluginId, enabled: h.enabled, trustStatus: h.trustStatus, timeoutSec: h.timeoutSec, async: h.async, sourcePath: h.sourcePath, command: h.command })),
      errors: (result.listing.data || []).flatMap(x => x.errors || []), warnings: (result.listing.data || []).flatMap(x => x.warnings || []), stderrWarningCount: result.stderrWarningCount };
    await fs.writeFile(path.join(base, 'result.json'), JSON.stringify(safe, null, 2) + '\n');
    observations.push(safe);
  }
  const conclusion = { executable, observations, expectedDifferenceObserved: observations[0].hookCount === 0 && observations[1].hookCount === 1, userStateModified: false, hooksExecuted: false, trustChanged: false, threadOrTurnCreated: false };
  await fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(conclusion, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, variants: observations.map(x => ({ variant: x.variant, hookCount: x.hookCount, hooks: x.hooks.map(h => ({ eventName: h.eventName, trustStatus: h.trustStatus, enabled: h.enabled })), errors: x.errors, warnings: x.warnings })), expectedDifferenceObserved: conclusion.expectedDifferenceObserved }, null, 2) + '\n');
  if (!conclusion.expectedDifferenceObserved) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { process.stderr.write(e.message + '\n'); process.exitCode = 1; });
module.exports = { listHooks };
