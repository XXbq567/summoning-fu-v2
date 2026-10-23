'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SendObserver } = require('../desktop/send-observer.cjs');

function fixture(overrides = {}) {
  const children = [], observations = [], diagnostics = [], tasks = new Map();
  const parent = new EventEmitter();
  let timer = 0, clock = 1000;
  const spawn = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.killed = false; child.kill = () => { child.killed = true; };
    child.invocation = { executable, args, options };
    children.push(child);
    return child;
  };
  const observer = new SendObserver({
    onObservation: value => observations.push(value), onDiagnostic: value => diagnostics.push(value),
    spawn, platform: 'win32', parent, clock: () => clock,
    setTimeout: (fn, delay) => { const id = ++timer; tasks.set(id, { fn, delay }); return id; },
    clearTimeout: id => tasks.delete(id), ...overrides
  });
  const runDelay = delay => {
    const found = [...tasks.entries()].find(([, task]) => task.delay === delay);
    assert.ok(found, `expected timer delay ${delay}`);
    tasks.delete(found[0]); found[1].fn();
  };
  const payload = (child, patch = {}) => ({
    schemaVersion: 1, kind: 'send-invoked',
    observerId: child.invocation.args[child.invocation.args.indexOf('-ObserverId') + 1], sequence: 1,
    monotonicMs: 1, host: { package: 'OpenAI.Codex', pid: 123, hwnd: '456' },
    mode: { value: 'chat', source: 'explicit-selection' }, coordinateSpace: 'physical-screen-px',
    anchor: { x: 0, y: 0, width: 35, height: 35 }, viewport: { x: 0, y: 0, width: 800, height: 600 },
    evidence: { invoke: true, composerBound: true, foreground: true, minimized: false }, ...patch
  });
  return { observer, children, observations, diagnostics, tasks, parent, payload, runDelay, advance: n => { clock += n; } };
}

test('send observer reassembles split lines and enforces the private fixed helper launch', () => {
  const f = fixture(); f.observer.start(); f.observer.start();
  assert.equal(f.children.length, 1);
  const child = f.children[0]; const { executable, args, options } = child.invocation;
  assert.match(executable, /[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
  assert.ok(args.includes('-NoProfile')); assert.ok(args.includes('-NonInteractive'));
  assert.ok(!args.includes('-Command')); assert.ok(!args.includes('-ExecutionPolicy'));
  assert.match(args[args.indexOf('-File') + 1], /[\\/]desktop[\\/]windows-send-observer\.ps1$/);
  assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
  const line = JSON.stringify(f.payload(child));
  child.stdout.emit('data', Buffer.from(line.slice(0, 70)));
  assert.equal(f.observations.length, 0);
  child.stdout.emit('data', Buffer.from(`${line.slice(70)}\r\n`));
  assert.equal(f.observations[0].kind, 'send-invoked');
  child.stdout.emit('data', Buffer.from(`${line}\n`));
  assert.equal(f.observations.length, 1, 'duplicate sequence must not replay');
  f.observer.stop();
});

test('send observer drops stderr and invalid protocol without forwarding content', () => {
  const f = fixture(); f.observer.start(); const child = f.children[0];
  child.stderr.emit('data', Buffer.from('private provider exception'));
  child.stdout.emit('data', Buffer.from('private not JSON\n'));
  assert.equal(f.observations.filter(o => o.kind === 'send-invoked').length, 0);
  assert.ok(f.diagnostics.some(d => d.reason === 'protocol-invalid'));
  assert.ok(!JSON.stringify(f.diagnostics).includes('private'));
  f.observer.stop();
});

test('send observer kills oversized unterminated lines and ignores late data after stop', () => {
  const f = fixture(); f.observer.start(); const child = f.children[0];
  child.stdout.emit('data', Buffer.alloc(16385, 120));
  assert.equal(child.killed, true);
  assert.ok(f.diagnostics.some(d => d.reason === 'buffer-limit'));
  f.observer.stop(); const count = f.observations.length;
  child.stdout.emit('data', Buffer.from(`${JSON.stringify(f.payload(child))}\n`));
  child.emit('exit', 1);
  assert.equal(f.observations.length, count);
  assert.equal(f.tasks.size, 0);
});

test('send observer invalidates on exit and caps restart attempts at three', () => {
  const f = fixture(); f.observer.start();
  for (let retry = 0; retry < 3; retry++) {
    f.children.at(-1).emit('exit', 1);
    assert.equal(f.observations.at(-1).reason, 'observer-exited');
    f.runDelay(250);
  }
  assert.equal(f.children.length, 4);
  f.children.at(-1).emit('exit', 1);
  assert.ok(f.diagnostics.some(d => d.reason === 'retry-exhausted'));
  assert.equal([...f.tasks.values()].filter(task => task.delay === 250).length, 0);
  f.observer.stop();
});

test('send observer times out a silent helper and cleans up on parent exit', () => {
  const f = fixture(); f.observer.start();
  f.runDelay(12000);
  assert.equal(f.children[0].killed, true);
  assert.ok(f.observations.some(o => o.reason === 'observer-timeout'));
  f.runDelay(250);
  f.parent.emit('exit');
  assert.equal(f.children[1].killed, true);
  assert.equal(f.tasks.size, 0);
});

test('send observer stays healthy beyond eighty seconds and bounds a stuck UIA cycle', () => {
  const f = fixture(); f.observer.start(); const child = f.children[0];
  for (let sequence = 1; sequence <= 90; sequence++) {
    f.advance(1000);
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({
      schemaVersion: 1, kind: 'unavailable',
      observerId: f.payload(child).observerId, sequence, monotonicMs: sequence * 1000, reason: 'mode-unknown'
    })}\n`));
  }
  assert.equal(child.killed, false);
  assert.equal(f.children.length, 1);
  assert.equal([...f.tasks.values()].filter(task => task.delay === 20000).length, 0);
  f.runDelay(8000);
  assert.equal(child.killed, true);
  assert.equal(f.observations.at(-1).reason, 'observer-timeout');
  f.observer.stop();
});

test('send observer private health cannot authorize presentation or accept extra fields', () => {
  const f = fixture(); f.observer.start(); const child = f.children[0];
  const health = { schemaVersion: 1, kind: 'health', observerId: f.payload(child).observerId, sequence: 1, monotonicMs: 1 };
  for (const extra of [{ prompt: 'not allowed' }, { reason: 'mode-unknown' }, { host: f.payload(child).host }]) {
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ ...health, ...extra })}\n`));
  }
  assert.equal([...f.tasks.values()].filter(task => task.delay === 8000).length, 0);
  child.stdout.emit('data', Buffer.from(`${JSON.stringify(health)}\n`));
  assert.equal(f.observations.length, 0);
  assert.equal([...f.tasks.values()].filter(task => task.delay === 8000).length, 1);
  f.observer.stop(); const count = f.observations.length;
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ ...health, sequence: 2 })}\n`));
  assert.equal(f.observations.length, count);
  assert.equal(f.tasks.size, 0);
});

test('send observer uses an external resource helper in an asar package and rejects arbitrary paths', () => {
  const f = fixture({ scriptPath: 'C:/untrusted/other.ps1', packaged: true, resourcesPath: 'C:/app/resources' });
  f.observer.start();
  const args = f.children[0].invocation.args;
  assert.match(args[args.indexOf('-File') + 1].replaceAll('\\', '/'), /\/resources\/send-observer\/windows-send-observer\.ps1$/);
  assert.ok(!args.includes('C:/untrusted/other.ps1'));
  f.observer.stop();
});

test('send observer remains unavailable without launching on other platforms', () => {
  const f = fixture({ platform: 'linux' }); f.observer.start();
  assert.equal(f.children.length, 0);
  assert.equal(f.observations.at(-1).reason, 'unsupported-platform');
  f.observer.stop();
});

test('send observer passes only a bounded explicit presentation lease to its fixed helper', () => {
  const f = fixture({ presentationTotalMs: 12500 }); f.observer.start();
  const args = f.children[0].invocation.args;
  assert.equal(args[args.indexOf('-PresentationTotalMs') + 1], '12500');
  f.observer.stop();
  for (const presentationTotalMs of [0, 4999, 30001, NaN, null, '12500']) {
    assert.throws(() => fixture({ presentationTotalMs }), RangeError);
  }
});

test('native arm consumes a transitioned Send once and requires a new lifecycle for independent sends', { skip: process.platform !== 'win32' }, () => {
  const helper = path.join(__dirname, '..', 'desktop', 'windows-send-observer.ps1');
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures', 'send-arm-state.ps1'), '-Helper', helper],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 12000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr || result.error?.code);
  assert.deepEqual(JSON.parse(result.stdout), { transitionedSendConsumed: true, laterStopRejected: true,
    duplicateRejected: true, independentLifecycleAccepted: true, wrongComposerRejected: true,
    wrongTargetRejected: true, staleGenerationRejected: true, retiredArmRejected: true });
});

test('send observer helper is ASCII and compiles in the actual Windows PowerShell runtime', { skip: process.platform !== 'win32' }, () => {
  const helper = path.join(__dirname, '..', 'desktop', 'windows-send-observer.ps1');
  assert.ok([...fs.readFileSync(helper)].every(byte => byte < 128));
  const command = [
    '$ErrorActionPreference="Stop";$tokens=$null;$parseErrors=$null;',
    '$ast=[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$parseErrors);',
    'if($parseErrors.Count){exit 1};',
    '$source=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.StringConstantType -eq "SingleQuotedHereString"},$true)[0].Value;',
    'Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;Add-Type -AssemblyName WindowsBase;',
    'Add-Type -ReferencedAssemblies System.dll,System.Core.dll,UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition $source -ErrorAction Stop;'
  ].join('');
  // The helper's top-level code is never executed; this compiles its literal declaration only.
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `& { ${command} } '${helper.replaceAll("'", "''")}'`],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 12000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr || result.error?.code);
});
