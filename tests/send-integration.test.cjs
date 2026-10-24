'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const host = require('../desktop/host-state.cjs');
const observation = (sequence = 1, mode = 'chat') => ({ schemaVersion: 1, kind: 'send-invoked', observerId: 'observer-a', sequence, monotonicMs: sequence * 100,
  host: { package: 'OpenAI.Codex', pid: 42, hwnd: '1234' }, mode: { value: mode, source: 'explicit-selection' }, coordinateSpace: 'physical-screen-px',
  anchor: { x: 800, y: 700, width: 30, height: 30 }, viewport: { x: 100, y: 50, width: 900, height: 700 },
  evidence: { invoke: true, composerBound: true, foreground: true, minimized: false } });

async function normalMainFixture({ diagnostics = false, profile = null, workArea = { x: 0, y: 0, width: 1200, height: 800 } } = {}) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
  const filename = path.resolve(__dirname, '../desktop/main.cjs'), localRequire = createRequire(filename);
  const app = new EventEmitter(), screen = new EventEmitter(), powerMonitor = new EventEmitter();
  const windows = [], handlers = {}, timers = [], intervals = [], snapshots = [], titleReads = [], settingsWrites = [], diagnosticRows = [];
  const event = { eventId: 'verified-hook-event', sessionId: 'session-a', turnId: 'turn-a', metadata: { model: 'model-a', reasoning: 'untrusted' }, provenance: { model: 'reported', reasoning: 'reported' } };
  const verification = { verified: true, sessionId: 'session-a', turnId: 'turn-a', startedAtMs: 100, offset: 100, contextMissing: false, reasoning: { value: 'xhigh', source: 'reported', model: 'model-a', contextOffset: 200 } };
  let ready, observer, deliveryBridge, now = 1000;
  app.setPath = () => {}; app.getPath = () => 'C:\\AppData'; app.requestSingleInstanceLock = () => true; app.setName = () => {}; app.quit = () => {};
  app.whenReady = () => ({ then(fn) { ready = fn; return { catch() {} }; } });
  class FakeWindow extends EventEmitter {
    constructor(options) { super(); this.bounds = options; this.visible = false; this.webContents = new EventEmitter(); this.webContents.isLoading = () => false; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = (channel, value) => { if (channel === 'fu:snapshot') snapshots.push(value); }; windows.push(this); }
    loadFile(file) { this.file = file; } isDestroyed() { return false; } isVisible() { return this.visible; } isMinimized() { return false; } isFocused() { return false; }
    hide() { this.visible = false; } showInactive() { this.visible = true; } getBounds() { return this.bounds; } setBounds(bounds) { this.bounds = bounds; } setIgnoreMouseEvents() {}
  }
  class FakeTray extends EventEmitter { setToolTip() {} destroy() {} }
  screen.getPrimaryDisplay = () => ({ workArea }); screen.getDisplayMatching = screen.getPrimaryDisplay; screen.screenToDipRect = (_w, rect) => rect;
  screen.getAllDisplays = () => [{ id: 1, scaleFactor: 1, ...screen.getPrimaryDisplay() }];
  const permission = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } };
  const electron = { app, screen, powerMonitor, BrowserWindow: FakeWindow, Tray: FakeTray, nativeImage: { createFromBitmap: () => ({}) }, Menu: { setApplicationMenu() {} }, session: { defaultSession: permission }, ipcMain: { handle(channel, fn) { handlers[channel] = fn; }, on(channel, fn) { handlers[channel] = fn; } }, systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), Buffer, performance: { now: () => now }, process: { argv: ['electron', '.', ...(profile || ['--hide']), ...(diagnostics ? ['--diagnostics-file', 'C:\\fixture\\runtime.jsonl'] : [])], platform: 'win32', versions: {}, execPath: 'C:\\candidate\\Summoning-Fu.exe' },
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return { readFileSync: () => '{}', statSync() { throw new Error('no aliases'); }, writeFileSync(file, value) { if (file.endsWith('summoning-fu-settings.json.tmp')) settingsWrites.push(JSON.parse(value)); }, appendFile(_file, value, _options, callback) { diagnosticRows.push(JSON.parse(value)); callback(); }, renameSync() {} };
      if (name === 'node:perf_hooks') return { performance: { now: () => now } };
      if (name === './host-state.cjs') return { ...localRequire(name), DeliveryTargetBridge: class extends localRequire(name).DeliveryTargetBridge { constructor() { super(); deliveryBridge = this; } } };
      if (name === './send-observer.cjs') return { SendObserver: class { constructor(options) { observer = options; } start() {} stop() {} } };
      if (name === '../adapter/entrance-event.cjs') return { ...localRequire(name), readEntranceFile: async () => event, verifyEntranceTurn: async () => ({ ...verification }) };
      if (name === '../adapter/chat-title.cjs') return { readChatTitle: async id => { titleReads.push(id); return { value: 'verified title', source: 'codex-session-index' }; } };
      return localRequire(name);
    }
  });
  await ready();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { app, screen, powerMonitor, windows, handlers, snapshots, event, verification, titleReads, settingsWrites, diagnosticRows, observer, flush, latest: () => snapshots.at(-1), receiveTarget: raw => deliveryBridge.receive(raw, { sourceNowMs: now, receivedAtMs: now }), advance: ms => { now += ms; intervals.forEach(fn => fn()); }, submit: async () => { app.emit('second-instance', {}, ['electron', '--entrance-file=C:\\fixture\\event.json']); await flush(); } };
}

test('only automatic isolated QA samples short delivery stages at 100ms while normal and interactive profiles retain 1000ms', async () => {
  for (const [profile, interval] of [[null, 1000], [['--preview-qa-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-qa-a1b2c3d4', '--motion-preview'], 100], [['--paperlab-preview-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-local-a1b2c3d4', '--motion-preview'], 1000]]) {
    const f = await normalMainFixture({ diagnostics: true, profile }); f.advance(0);
    const initial = f.diagnosticRows.length; assert.ok(initial > 0);
    f.advance(interval - 1); assert.equal(f.diagnosticRows.length, initial);
    f.advance(1); assert.equal(f.diagnosticRows.length, initial + 1);
    f.advance(interval); assert.equal(f.diagnosticRows.length, initial + 2);
  }
});

test('verified hook uses an independent Pet and starts its full clock only after the current renderer is ready', async () => {
  const f = await normalMainFixture(); await f.submit();
  const preparing = f.latest();
  assert.equal(preparing.presentationMode, 'independent-hook');
  assert.equal(preparing.presentationPreparing, true); assert.equal(preparing.visible, false);
  assert.equal(preparing.metadata.reasoning, 'xhigh'); assert.equal(preparing.metadata.task, 'verified title');
  assert.deepEqual(f.titleReads, ['session-a']);
  f.advance(4500);
  f.observer.onDiagnostic({ reason: 'mode-unknown' });
  assert.equal(f.latest().presentationPreparing, true);
  const ready = { runId: preparing.runId, token: preparing.presentationToken, status: 'ready' };
  await f.handlers['fu:renderer-ready']({ sender: f.windows[1].webContents }, ready);
  assert.equal(f.latest().visible, false);
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, { ...ready, token: ready.token + 1 });
  assert.equal(f.latest().visible, false);
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, ready);
  await f.flush();
  assert.equal(f.latest().visible, true); assert.equal(f.latest().elapsedMs, 0);
  const timing = require('../renderer/entrance-timeline.js').timings;
  f.advance(timing.holdStartMs); assert.equal(f.latest().phase, 'hold');
  f.advance(timing.holdMs - 1); assert.equal(f.latest().phase, 'hold');
  f.advance(1); assert.equal(f.latest().phase, 'hidden');
  assert.equal(f.latest().deliveryReason, 'target-unavailable');
  f.handlers['fu:action']({ sender: f.windows[0].webContents }, 'hide');
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, ready);
  assert.equal(f.latest().visible, false);
});

test('normal delivery consumes only the private host target and rebases once without changing the screen paper anchor', async () => {
  const f = await normalMainFixture({ workArea: { x: 0, y: 0, width: 1600, height: 1200 } }); await f.submit(); const ready = f.latest();
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, { runId: ready.runId, token: ready.presentationToken, status: 'ready' }); await f.flush();
  const outer = f.windows[0].getBounds(), paper = f.latest().geometry.targetRect;
  const anchor = { x: outer.x + paper.x, y: outer.y + paper.y };
  const target = { targetId: 'private-adapter-target', revision: 1, rect: { x: -180, y: 400, width: 80, height: 70 }, coordinateSpace: 'overlay-local-dip', source: 'supported-host-adapter', valid: true, visible: true, observedAtMonotonicMs: 1000, expiresAtMonotonicMs: 30000 };
  assert.equal(f.receiveTarget({ ...target, source: 'preview-example' }), false);
  assert.equal(f.receiveTarget(target), true);
  f.advance(require('../renderer/entrance-timeline.js').timings.leaveAtMs);
  assert.equal(f.latest().phase, 'folding', JSON.stringify({ reason: f.latest().deliveryReason, outer, paper, geometry: f.latest().geometry })); assert.equal(f.latest().deliveryReason, 'none');
  const after = f.windows[0].getBounds(), rect = f.latest().geometry.targetRect;
  assert.deepEqual({ x: after.x + rect.x, y: after.y + rect.y }, anchor);
  const frozen = JSON.stringify(f.latest().deliveryPlan);
  f.advance(100); assert.equal(JSON.stringify(f.latest().deliveryPlan), frozen);
  assert.equal(f.receiveTarget({ ...target, revision: 2, observedAtMonotonicMs: 7250, visible: false }), false);
  f.advance(1); assert.equal(f.latest().visible, false);
  assert.equal(f.receiveTarget({ ...target, revision: 3, observedAtMonotonicMs: 7251 }), true);
  f.advance(1); assert.equal(f.latest().visible, false);
});

test('monitor geometry changes cancel independent hook presentations and old readiness cannot revive them', async () => {
  const f = await normalMainFixture(); await f.submit(); const ready = f.latest();
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, { runId: ready.runId, token: ready.presentationToken, status: 'ready' }); await f.flush();
  assert.equal(f.latest().visible, true);
  f.screen.emit('display-metrics-changed'); assert.equal(f.latest().visible, false);
  f.handlers['fu:action']({ sender: f.windows[0].webContents }, 'show'); assert.equal(f.latest().visible, false);
});

test('verified hook final source change, cancellation and duplicate cannot release a prepared run', async () => {
  const f = await normalMainFixture(); await f.submit(); const preparing = f.latest();
  f.verification.verified = false; f.verification.reason = 'latest-turn-mismatch';
  await f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, { runId: preparing.runId, token: preparing.presentationToken, status: 'ready' });
  await f.flush();
  assert.equal(f.latest().visible, false);
  f.verification.verified = true; await f.submit();
  assert.equal(f.latest().visible, false); assert.equal(f.titleReads.length, 1);
});
test('normal main saves the inset paper anchor rather than the padded native window origin', async () => {
  const f = await normalMainFixture(); await f.submit(); const preparing = f.latest();
  assert.ok(preparing.geometry.targetRect.x > 0 && preparing.geometry.targetRect.y > 0);
  f.handlers['fu:renderer-ready']({ sender: f.windows[0].webContents }, { runId: preparing.runId, token: preparing.presentationToken, status: 'ready' }); await f.flush();
  const target = f.latest().geometry.targetRect, outer = f.windows[0].getBounds();
  f.app.emit('before-quit');
  assert.deepEqual(f.settingsWrites.at(-1).petPosition, { x: outer.x + target.x, y: outer.y + target.y });
  assert.notDeepEqual(f.settingsWrites.at(-1).petPosition, { x: outer.x, y: outer.y });
});

test('preview QA requires an isolated absolute profile and cannot accept real source commands', () => {
  const profile = ['--preview-qa-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-qa-a1b2c3d4'];
  assert.deepEqual(host.previewQaProfile(profile), { valid: true, enabled: true, userData: 'C:\\qa\\summoning-fu-preview-qa-a1b2c3d4' });
  assert.equal(host.previewQaProfile([]).enabled, false);
  for (const extra of [['--session-file', 'C:\\private\\rollout.jsonl'], ['--entrance-file=C:\\private\\event.json'], ['--read']]) {
    assert.equal(host.previewQaProfile([...profile, ...extra]).valid, false);
  }
  for (const directory of ['relative/summoning-fu-preview-qa-a1b2c3d4', 'C:\\qa\\summoning-fu-handoff', 'C:\\qa\\summoning-fu-preview-qa-..', 'C:\\qa\\summoning-fu-preview-qa-a1b2c3d4\\..']) {
    assert.equal(host.previewQaProfile(['--preview-qa-only', '--user-data-dir', directory]).valid, false);
  }
  assert.equal(host.previewQaProfile([...profile, '--user-data-dir=C:\\other']).valid, false);
  assert.equal(host.samePreviewQaProfile(profile, [...profile, '--quit']), true);
  assert.equal(host.samePreviewQaProfile(profile, ['--quit']), false);
  assert.equal(host.samePreviewQaProfile(profile, ['--preview-qa-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-qa-ffffffff', '--quit']), false);
});
test('interactive Paperlab preview owns a distinct profile without enabling real session commands', () => {
  const args = ['--paperlab-preview-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-local-a1b2c3d4'];
  const profile = host.previewQaProfile(args);
  assert.equal(profile.valid, true); assert.equal(profile.enabled, true); assert.equal(profile.interactive, true);
  assert.equal(host.previewQaProfile([...args, '--read']).valid, false);
  assert.equal(host.previewQaProfile([...args, '--preview-qa-only']).valid, false);
  assert.equal(host.samePreviewQaProfile(args, [...args, '--motion-preview']), true);
  assert.equal(host.samePreviewQaProfile(args, ['--quit']), false);
});
test('Paperlab double-click launcher plans only its local renderer and isolated interactive profile', () => {
  const path = require('node:path'), { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/start-paperlab-preview.cjs'), '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.ok(plan.args.includes('--paperlab-preview-only'));
  assert.match(plan.args.find(arg => arg.startsWith('--user-data-dir=')), /summoning-fu-preview-local-[a-f0-9]{16}$/);
  assert.ok(plan.args.includes('--motion-preview'));
  assert.equal(plan.args.includes('--quit'), false);
  assert.match(plan.buildScript, /scripts[\\/]build-paperlab\.cjs$/);
});
test('offline preview builds the exact shared renderer and controller without import side effects or external scripts', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const filename = path.resolve(__dirname, '../scripts/build-preview.cjs'), loaded = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), module: loaded, require(name) {
    if (name === 'node:fs') return { ...fs, writeFileSync() { throw Error('Import must not overwrite a user preview'); } };
    return localRequire(name);
  } });
  assert.equal(typeof loaded.exports.createStandalone, 'function');
  const html = loaded.exports.createStandalone();
  for (const file of ['renderer/generated/paperlab-runtime.js', 'renderer/burn-view.js', 'desktop/motion-preview.js']) {
    assert.ok(html.includes(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8').replace(/<\/script/gi, '<\\/script')), file);
  }
  assert.equal(/<script\b[^>]*\bsrc\s*=/.test(html), false);
  assert.equal(/\{\{[A-Z_]+\}\}/.test(html), false);
  assert.ok(html.includes('id="preview-speed"')); assert.ok(html.includes('"qaOnly":false'));
  assert.ok(html.includes("connect-src 'none'"));
});
test('candidate preflight rejects a missing Paperlab bundle instead of shipping the previous SVG effect', () => {
  const path = require('node:path');
  const { assertPaperlabArtifacts } = require('../scripts/paperlab-artifacts.cjs');
  assert.throws(() => assertPaperlabArtifacts(path.resolve(__dirname, 'fixtures/no-paperlab-runtime')), /Paperlab runtime missing/);
  const artifacts = assertPaperlabArtifacts(path.resolve(__dirname, '..'));
  assert.ok(artifacts.runtimeBytes > 1000);
  assert.ok(artifacts.licenseFiles.includes('paperlab-0.8.1/NOTICE'));
});
test('cold Pet probe plans its own hidden renderer fixture without real hooks or shared product profile', () => {
  const path = require('node:path'), { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/probe-paperlab-host.cjs'), '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.match(plan.profile, /summoning-fu-host-probe-[a-f0-9]{16}$/);
  assert.ok(plan.args.includes('--fixture-child'));
  assert.equal(plan.args.some(arg => /--quit|--entrance-file|--session-file/.test(arg)), false);
  assert.equal(plan.initiallyHidden, true); assert.equal(plan.realHookAcceptance, false);
  assert.equal(plan.renderer, 'desktop/pet.html');
});
test('normal Pet CSP permits the embedded Paperlab brush font while keeping scripts and network closed', () => {
  const html = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../desktop/pet.html'), 'utf8');
  assert.match(html, /font-src 'self' data:/);
  assert.match(html, /script-src 'self';/);
  assert.match(html, /connect-src 'none'/);
});
test('Pet probe watchdog persists failure and cannot be overwritten by a killed child null exit code', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { EventEmitter } = require('node:events');
  const filename = path.resolve(__dirname, '../scripts/probe-paperlab-host.cjs'), loaded = { exports: {} }, writes = [], timers = [];
  const child = new EventEmitter(); child.kill = () => true;
  const processStub = { argv: ['node', filename], env: {}, versions: {}, stdout: { write() {} }, stderr: { write() {} }, exitCode: 0 };
  const localRequire = require('node:module').createRequire(filename);
  function probeRequire(name) {
    if (name === 'node:fs') return { ...fs, mkdirSync() {}, writeFileSync(file, value) { writes.push({ file, value }); }, readFileSync(file, ...rest) { if (file.endsWith('report.json')) throw Object.assign(Error('none'), { code: 'ENOENT' }); return fs.readFileSync(file, ...rest); } };
    if (name === 'node:child_process') return { spawn: () => child };
    if (name === 'electron') return 'own-electron.exe';
    return localRequire(name);
  }
  probeRequire.main = loaded;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), __filename: filename, module: loaded, require: probeRequire, process: processStub,
    console: { log() {} }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  timers[0]();
  child.emit('exit', null, 'SIGTERM');
  assert.equal(processStub.exitCode, 1);
  const report = writes.filter(item => item.file.endsWith('report.json')).map(item => JSON.parse(item.value)).at(-1);
  assert.equal(report.result, 'FAIL'); assert.equal(report.reason, 'pet-child-deadline');
});
test('Electron default-app loader starts only the explicit Pet fixture even when require.main differs', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), writes = [];
  const filename = path.resolve(__dirname, '../scripts/probe-paperlab-host.cjs'), loaded = { exports: {} };
  const planned = require('../scripts/probe-paperlab-host.cjs').plan(), localRequire = require('node:module').createRequire(filename);
  let selectedProfile;
  const app = { setPath(_name, value) { selectedProfile = value; }, requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}), exit() {} };
  function probeRequire(name) {
    if (name === 'electron') return { app };
    if (name === 'node:fs') return { ...fs, mkdirSync() {}, appendFileSync(file, value) { writes.push({ file, value }); }, writeFileSync(file, value) { writes.push({ file, value }); } };
    return localRequire(name);
  }
  probeRequire.main = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), __filename: filename, module: loaded, require: probeRequire,
    process: { argv: ['own-electron.exe', ...planned.args], versions: { electron: '44.9.3' }, stderr: { write() {} } }, setTimeout() {}, clearTimeout() {} });
  assert.equal(selectedProfile, planned.profile);
  assert.ok(writes.some(item => item.file.endsWith('progress.jsonl') && JSON.parse(item.value).stage === 'child-entry'));
});

test('preview QA main process opens only its own preview and ignores unscoped quit', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
  const filename = path.resolve(__dirname, '../desktop/main.cjs'), localRequire = createRequire(filename);
  const argv = ['electron', '.', '--preview-qa-only', '--user-data-dir=C:\\qa\\summoning-fu-preview-qa-a1b2c3d4', '--motion-preview', '--diagnostics-file', 'C:\\qa\\runtime.jsonl', '--capture-dir', 'C:\\qa\\captures'];
  const app = new EventEmitter(), files = [], windows = [], paths = [], sent = [], handlers = {}, state = { observers: 0, locks: 0, quits: 0, focusCalls: 0, activeShows: 0, inactiveShows: 0 };
  let ready;
  app.setPath = (name, value) => paths.push({ name, value });
  app.getPath = name => name === 'appData' ? 'C:\\AppData' : paths.find(p => p.name === name)?.value;
  app.requestSingleInstanceLock = () => { state.locks++; return true; };
  app.setName = () => {}; app.quit = () => { state.quits++; app.emit('before-quit'); };
  app.whenReady = () => ({ then(fn) { ready = fn; return { catch() {} }; } });
  class FakeWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.isLoading = () => false; this.webContents.send = (channel, value) => sent.push({ channel, value }); windows.push(this); }
    loadFile(file) { this.file = file; queueMicrotask(() => this.emit('ready-to-show')); }
    isDestroyed() { return false; } isVisible() { return true; } isMinimized() { return false; }
    show() { state.activeShows++; } showInactive() { state.inactiveShows++; } focus() { state.focusCalls++; } hide() {} setIgnoreMouseEvents() {} on() { return super.on(...arguments); }
  }
  const permission = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } };
  const electron = { app, BrowserWindow: FakeWindow, Menu: { setApplicationMenu() {} }, session: { defaultSession: permission }, ipcMain: { handle(channel, fn) { handlers[channel] = fn; }, on() {} }, systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), Buffer, performance: require('node:perf_hooks').performance,
    process: { argv, platform: 'win32', versions: { electron: '44.9.3' }, execPath: 'C:\\candidate\\Summoning-Fu.exe' },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return { ...fs, promises: { ...fs.promises, mkdir: async () => {} }, readFileSync(file) { files.push(file); return '{}'; }, writeFileSync(file) { files.push(file); }, renameSync(file) { files.push(file); } };
      if (name === './send-observer.cjs') return { SendObserver: class { constructor() { state.observers++; } } };
      return localRequire(name);
    }
  });
  assert.equal(paths.find(p => p.name === 'userData').value, 'C:\\qa\\summoning-fu-preview-qa-a1b2c3d4');
  await ready();
  assert.deepEqual(windows.map(w => path.basename(w.file)), ['motion-preview.html']);
  assert.equal(windows[0].options.focusable, false);
  assert.equal(windows[0].options.resizable, false); assert.equal(windows[0].options.maximizable, false); assert.equal(windows[0].options.fullscreenable, false);
  assert.equal(windows[0].options.minimizable, false);
  assert.equal(state.focusCalls, 0); assert.equal(state.activeShows, 0); assert.equal(state.inactiveShows, 1);
  assert.equal(handlers['fu:preview-initial']({ sender: windows[0].webContents }).qaOnly, true);
  assert.equal(state.observers, 0);
  assert.equal(files.some(file => String(file).includes('summoning-fu-settings')), false);
  app.emit('second-instance', {}, [...argv, '--preview-qa=unfold']);
  assert.deepEqual(sent.at(-1), { channel: 'fu:preview-command', value: 'unfold' });
  app.emit('second-instance', {}, ['electron', '--quit']); assert.equal(state.quits, 0);
  app.emit('second-instance', {}, [...argv, '--quit']); assert.equal(state.quits, 1);
  assert.equal(files.some(file => String(file).includes('summoning-fu-settings')), false);
});

test('preview preload delivers new bounded stage commands and rejects arbitrary messages', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { EventEmitter } = require('node:events'), ipc = new EventEmitter(), exposed = {}, received = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/preload.cjs'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: ipc }) });
  exposed.fuPreview.subscribe(value => received.push(value));
  for (const value of ['unfold', 'folding', 'intake-tail', 'target-hide', 'speed-0.5', 'fixture-b', 'executeScript', { command: 'unfold' }]) ipc.emit('fu:preview-command', {}, value);
  assert.deepEqual(received, ['unfold', 'folding', 'intake-tail', 'target-hide', 'speed-0.5', 'fixture-b']);
});

test('normal and preview HTML load the same local Paperlab runtime before their shared renderer', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const file of ['pet.html', 'motion-preview.html']) {
    const html = fs.readFileSync(path.resolve(__dirname, '../desktop', file), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
    const runtime = scripts.indexOf('../renderer/generated/paperlab-runtime.js');
    assert.ok(runtime > scripts.indexOf('../renderer/send-geometry.js'));
    assert.ok(runtime < scripts.indexOf('../renderer/burn-view.js'));
    assert.equal(scripts.filter(src => src.includes('paperlab-runtime')).length, 1);
    assert.equal(scripts.some(src => /^https?:/.test(src)), false);
  }
});

test('pet reports readiness only for the latest prepared run and hides its material on cancellation', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const readyReports = [], renders = [], resolvers = [], listeners = {};
  let update, now = 1000;
  const snapshot = n => ({ runId: 'run-' + n, presentationToken: n, presentationPreparing: true, metadata: {}, geometry: { targetRect: { x: 0, y: 0, width: 320, height: 676 } }, elapsedMs: 0, hidden: true, visible: false, reducedMotion: false, state: 'unknown' });
  class View {
    constructor() { this.svg = { querySelectorAll: () => [], querySelector: () => null }; this.setMetadata(); }
    setMetadata() { this.ready = new Promise(resolve => resolvers.push(resolve)); }
    render(frame) { renders.push(frame); }
  }
  const document = { hidden: true, querySelector: () => ({ style: {} }), addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/pet.js'), 'utf8'), { document, matchMedia: () => ({ matches: false, addEventListener() {} }), performance: { now: () => now }, setInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, RitualEntrance: require('../renderer/entrance-timeline.js'), RitualBurn: { BurnView: View }, fuHost: { subscribe: fn => { update = fn; }, initial: async () => ({ coverage: {}, snapshot: snapshot(1) }), reportReady: value => readyReports.push(value), reportRender() {} } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readyReports.length, 0);
  update(snapshot(2)); resolvers[0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(readyReports.length, 0);
  resolvers[1](); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(readyReports)), [{ runId: 'run-2', token: 2, status: 'ready' }]);
  document.hidden = false; update({ ...snapshot(2), presentationPreparing: false, hidden: false, visible: true });
  assert.equal(renders.at(-1).visible, true);
  now += 10; update({ ...snapshot(2), presentationPreparing: false, hidden: true, visible: false });
  assert.equal(renders.at(-1).visible, false);
});

test('normal main gives the observer the shared presentation lifetime', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
  const filename = path.resolve(__dirname, '../desktop/main.cjs'), localRequire = createRequire(filename), app = new EventEmitter();
  let ready, observerOptions;
  const paths = {};
  app.setPath = (name, value) => { paths[name] = value; }; app.getPath = name => paths[name] || 'C:\\AppData';
  app.requestSingleInstanceLock = () => true; app.setName = () => {}; app.quit = () => {};
  app.whenReady = () => ({ then(fn) { ready = fn; return { catch() {} }; } });
  class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.isLoading = () => false; this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; }
    loadFile() {} isDestroyed() { return false; } isVisible() { return false; } hide() {} setIgnoreMouseEvents() {}
  }
  class FakeTray extends EventEmitter { setToolTip() {} }
  const screen = new EventEmitter(); screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } });
  const permission = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } };
  const electron = { app, screen, BrowserWindow: FakeWindow, Tray: FakeTray, nativeImage: { createFromBitmap: () => ({}) }, Menu: { setApplicationMenu() {} }, session: { defaultSession: permission }, ipcMain: { handle() {}, on() {} }, powerMonitor: new EventEmitter(), systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), Buffer, performance: require('node:perf_hooks').performance,
    process: { argv: ['electron', '.', '--hide'], platform: 'win32', versions: {}, execPath: 'C:\\candidate\\Summoning-Fu.exe' },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return { readFileSync: () => '{}', statSync() { throw new Error('no aliases'); } };
      if (name === './send-observer.cjs') return { SendObserver: class { constructor(options) { observerOptions = options; } start() {} } };
      return localRequire(name);
    }
  });
  await ready();
  assert.equal(observerOptions.presentationTotalMs, require('../renderer/entrance-timeline.js').timings.totalMs);
});

test('preview QA runner plans every command inside one isolated profile', () => {
  const path = require('node:path'), { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/qa-motion-preview.cjs'), '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.match(plan.profile, /summoning-fu-preview-qa-[a-f0-9]{8,32}$/);
  for (const argv of Object.values(plan.commands)) {
    assert.ok(argv.includes('--preview-qa-only'));
    assert.ok(argv.includes('--user-data-dir=' + plan.profile));
  }
  assert.ok(plan.commands.quit.includes('--quit'));
  const timing = require('../renderer/entrance-timeline.js').timings;
  assert.equal(plan.holdMs, 2000); assert.equal(plan.totalMs, timing.totalMs);
});

test('legacy hook GUI QA fails before starting a shared production runtime', () => {
  const path = require('node:path'), { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/qa-plugin-entrance.cjs'), '--package-root', 'C:\\unopened-legacy-package'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Legacy hook GUI QA is disabled for the current strict-send candidate/);
});
test('Chat send admits once without server identity and never inherits Codex metadata', () => {
  const gate = new host.SendAdmissionGate();
  const result = gate.accept(observation(), 100);
  assert.equal(result.accepted, true); assert.equal(result.source, 'chatgpt-uia');
  assert.equal(result.confirmation, 'send-invoked'); assert.equal(result.sessionId, null); assert.equal(result.turnId, null);
  assert.equal(result.metadata.model, null); assert.equal(result.metadata.reasoning, null); assert.equal(result.metadata.sources.model, 'unknown');
  assert.equal(gate.accept(observation(), 110).reason, 'duplicate');
  assert.equal(gate.accept(observation(2), 120).accepted, true);
});

test('host gate rejects the complete untrusted schema before changing observer watermarks', () => {
  const gate = new host.SendAdmissionGate(), first = gate.accept(observation(), 0);
  assert.equal(first.accepted, true);
  const raw = observation(2);
  const invalid = [
    { ...raw, prompt: 'must not enter host admission' },
    { ...raw, coordinateSpace: 'dip-screen' },
    { ...raw, observerId: 'observer:invalid' },
    { ...raw, sequence: 0 },
    { ...raw, monotonicMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...raw, host: { ...raw.host, pid: 0 } },
    { ...raw, host: { ...raw.host, hwnd: 'not-a-hwnd' } },
    { ...raw, host: { ...raw.host, package: 'Other.Application' } },
    { ...raw, anchor: { ...raw.anchor, width: -1 } },
    { ...raw, anchor: { ...raw.anchor, x: Infinity } },
    { ...raw, viewport: { ...raw.viewport, message: 'private' } },
    { ...raw, mode: { ...raw.mode, selectedText: 'private' } },
    { ...raw, evidence: { ...raw.evidence, extra: true } },
    { schemaVersion: 1, kind: 'unavailable', observerId: 'observer-b', sequence: 1, monotonicMs: 1, reason: 'raw provider exception' },
    { schemaVersion: 1, kind: 'unavailable', observerId: 'observer-b', sequence: 1, monotonicMs: 1, reason: 'mode-changed', anchor: raw.anchor }
  ];
  for (const candidate of invalid) {
    assert.equal(gate.accept(candidate, 1).accepted, false);
    assert.equal(gate.observerId, 'observer-a');
    assert.equal(gate.sequence, 1);
    assert.equal(gate.isCurrent(first.token), true);
  }
  assert.equal(gate.accept(raw, 2).accepted, true);
});
test('Work source cannot be authorized by UI time correlation and unknown mode stays unavailable', () => {
  const gate = new host.SendAdmissionGate();
  assert.equal(gate.accept(observation(1, 'work'), 0).reason, 'work-association-unavailable');
  assert.equal(gate.accept(observation(2, 'unknown'), 10).accepted, false);
  assert.equal(host.workAnchorAssociation({ sessionId: 'actual', turnId: 'actual' }, observation(3, 'work')).verified, false);
});
test('observer epochs, invalidations and cancellation cannot revive old submissions', () => {
  const gate = new host.SendAdmissionGate();
  gate.accept(observation(), 0); const token = gate.generation;
  gate.invalidate(); assert.equal(gate.isCurrent(token), false);
  assert.equal(gate.accept(observation(), 10).accepted, false);
  const next = { ...observation(1), observerId: 'observer-b' };
  assert.equal(gate.accept(next, 20).accepted, true);
  assert.equal(gate.accept(observation(99), 30).reason, 'retired-observer');
  const invalid = { schemaVersion: 1, kind: 'unavailable', observerId: 'observer-b', sequence: 2, monotonicMs: 500, reason: 'mode-changed' };
  const current = gate.generation; gate.accept(invalid, 40); assert.equal(gate.isCurrent(current), false);
});

test('natural Send to Stop unavailability preserves a confirmed context, while host loss cancels', () => {
  const gate = new host.SendAdmissionGate(), admission = gate.accept(observation(), 0);
  assert.equal(typeof host.sendDiagnosticInvalidates, 'function');
  for (const reason of ['send-unavailable', 'composer-unproven', 'protocol-invalid']) {
    assert.equal(host.sendDiagnosticInvalidates(reason), false);
  }
  const unavailable = { schemaVersion: 1, kind: 'unavailable', observerId: 'observer-a', sequence: 2, monotonicMs: 200, reason: 'send-unavailable' };
  assert.equal(gate.accept(unavailable, 200).invalidated, false);
  assert.equal(gate.isCurrent(admission.token), true);
  for (const reason of ['window-unavailable', 'window-minimized', 'mode-changed', 'viewport-unavailable', 'geometry-changed', 'observer-exited', 'unknown-reason']) assert.equal(host.sendDiagnosticInvalidates(reason), true);
  assert.equal(gate.accept({ ...unavailable, sequence: 3, monotonicMs: 300, reason: 'mode-changed' }, 300).invalidated, true);
  assert.equal(gate.isCurrent(admission.token), false);
});
test('overlay layout preserves exact local button center and refuses invalid or cross-display geometry', () => {
  const layout = host.sendOverlayLayout({ x: 850, y: 680, width: 32, height: 32 }, { x: 100, y: 20, width: 900, height: 720 }, { x: 0, y: 0, width: 1200, height: 800 });
  assert.ok(layout); assert.equal(layout.geometry.originRect.x + layout.bounds.x, 850);
  assert.equal(layout.geometry.targetRect.x + layout.geometry.targetRect.width / 2 + layout.bounds.x, 550);
  assert.equal(layout.geometry.targetRect.y + layout.geometry.targetRect.height * 375 / 760 + layout.bounds.y, 380);
  assert.equal(host.sendOverlayLayout({ x: 1250, y: 500, width: 20, height: 20 }, { x: 100, y: 20, width: 900, height: 720 }, { x: 0, y: 0, width: 1200, height: 800 }), null);
  assert.equal(host.sendOverlayLayout({ x: NaN, y: 5, width: 20, height: 20 }, {}, {}), null);
  const negative = host.sendOverlayLayout({ x: -200, y: 680, width: 32, height: 32 }, { x: -1100, y: 20, width: 900, height: 720 }, { x: -1200, y: 0, width: 1200, height: 800 });
  assert.ok(negative); assert.equal(negative.geometry.originRect.x + negative.bounds.x, -200);
});
test('runtime copying allows the exact packaged observer helper but rejects arbitrary scripts', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { copyRuntime } = require('../scripts/package-plugin.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fu-send-package-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'); await fs.mkdir(path.join(source, 'resources/send-observer'), { recursive: true });
  await fs.writeFile(path.join(source, 'resources/send-observer/windows-send-observer.ps1'), '# synthetic helper fixture');
  await copyRuntime(source, path.join(dir, 'accepted'));
  assert.equal(await fs.readFile(path.join(dir, 'accepted/resources/send-observer/windows-send-observer.ps1'), 'utf8'), '# synthetic helper fixture');
  await fs.writeFile(path.join(source, 'resources/send-observer/other.ps1'), '# unapproved');
  await assert.rejects(copyRuntime(source, path.join(dir, 'rejected')), /Unexpected runtime/);
  await assert.rejects(fs.stat(path.join(dir, 'rejected')), { code: 'ENOENT' });
});
