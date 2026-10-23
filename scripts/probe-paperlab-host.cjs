'use strict';
// Own-window GPU/lifecycle fixture. It never imports the product main process,
// starts a hook/UIA observer, reads a session, or controls an installed runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const { EntranceTimeline, timings } = require('../renderer/entrance-timeline.js');
const { sanitizeRenderEvidence, independentPetLayout } = require('../desktop/host-state.cjs');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, reason) => { if (!condition) throw Error(reason); };
function plan() {
  const token = crypto.randomBytes(8).toString('hex');
  const output = path.join(root, 'qa/paperlab-host', new Date().toISOString().replace(/[:.]/g, '-') + '-' + token);
  const profile = path.join(output, 'summoning-fu-host-probe-' + token);
  return { output, profile, args: [__filename, '--fixture-child', '--user-data-dir=' + profile], initiallyHidden: true,
    renderer: 'desktop/pet.html', realHookAcceptance: false, totalDeadlineMs: 60000 };
}
function launch() {
  const planned = plan();
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(planned)); return; }
  assertPaperlabArtifacts(root);
  fs.mkdirSync(planned.output, { recursive: true });
  const reportFile = path.join(planned.output, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify({ classification: 'OWN_TRANSPARENT_PET_GPU_FIXTURE_NOT_HOOK_OR_UIA_ACCEPTANCE', result: 'RUNNING', stage: 'parent-launch', profile: planned.profile }) + '\n', { mode: 0o600 });
  let fatalReason = null;
  function failure(reason) {
    fatalReason ||= reason; process.exitCode = 1;
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch {}
    fs.writeFileSync(reportFile, JSON.stringify({ ...previous, result: 'FAIL', reason: fatalReason, finishedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), planned.args, { cwd: root, env, shell: false, windowsHide: false, stdio: 'inherit' });
  const watchdog = setTimeout(() => { failure('pet-child-deadline'); child.kill(); process.stderr.write('Pet probe child deadline exceeded.\n'); }, 75000);
  child.on('error', () => { clearTimeout(watchdog); failure('pet-child-launch-failed'); process.stderr.write('Pet probe launch failed.\n'); });
  child.on('exit', (code, signal) => { clearTimeout(watchdog); if (fatalReason) failure(fatalReason); else if (code !== 0 || signal) failure('pet-child-exited'); else process.exitCode = 0; });
}
async function fixture() {
  const { app, BrowserWindow, ipcMain, Menu, session, screen } = require('electron');
  const profiles = process.argv.filter(arg => arg.startsWith('--user-data-dir='));
  check(profiles.length === 1, 'probe-profile-required');
  const profile = profiles[0].slice('--user-data-dir='.length), output = path.dirname(profile);
  const relative = path.relative(path.join(root, 'qa/paperlab-host'), profile);
  check(path.isAbsolute(profile) && relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^summoning-fu-host-probe-[a-f0-9]{16}$/.test(path.basename(profile)), 'probe-profile-invalid');
  fs.mkdirSync(output, { recursive: true });
  const report = { classification: 'OWN_TRANSPARENT_PET_GPU_FIXTURE_NOT_HOOK_OR_UIA_ACCEPTANCE', result: 'RUNNING',
    profile, renderer: 'desktop/pet.html+preload.cjs+pet.js', timing: timings, startedAt: new Date().toISOString(),
    readiness: [], rows: [], actualUiSend: 'NOT_TESTED', actualHookDispatch: 'NOT_TESTED' };
  let pet, timer, watchdog, preparing = true, concealed = true, run = 'pet-probe-a', token = 1, preparedAt = performance.now(), resolveReady = null, rejectReady = null, finishing = false;
  function progress(stage) {
    report.stage = stage;
    fs.appendFileSync(path.join(output, 'progress.jsonl'), JSON.stringify({ stage, atMs: performance.now(), run, token, windowCreated: Boolean(pet), visible: pet ? pet.isVisible() : false }) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  progress('child-entry');
  app.setPath('userData', profile); progress('profile-set');
  check(app.requestSingleInstanceLock(), 'probe-profile-already-running'); progress('single-instance-acquired');
  app.on('window-all-closed', () => {});
  watchdog = setTimeout(() => finish('FAIL', 'pet-app-ready-timeout'), 15000);
  await app.whenReady(); clearTimeout(watchdog); progress('app-ready'); Menu.setApplicationMenu(null);
  const timeline = new EntranceTimeline();
  const coverage = JSON.parse(fs.readFileSync(path.join(root, 'assets/fonts/coverage.json'), 'utf8'));
  const metadata = suffix => ({ model: '本机示例模型', harness: '本机示例', environment: '隔离透明窗口', reasoning: 'xhigh',
    sources: { model: 'demo', harness: 'demo', environment: 'demo', reasoning: 'demo', task: 'demo' },
    presentation: { mode: 'entrance', sessionId: 'own-pet-probe-' + suffix, chatTitle: { value: '本机示例 · ' + suffix, source: 'manual' } } });
  let currentMetadata = metadata('甲');
  let geometry;
  function snapshot() {
    const frame = timeline.snapshot(performance.now(), false);
    return { ...frame, ...(preparing ? { elapsedMs: 0, visible: false, phase: 'hidden' } : {}), runId: run, presentationToken: token,
      presentationPreparing: preparing, presentationMode: 'independent-hook', metadata: currentMetadata, geometry,
      hidden: preparing || concealed || !frame.visible, state: 'unknown', diagnosticsEnabled: true };
  }
  function broadcast() {
    if (!pet || pet.isDestroyed()) return;
    const value = snapshot();
    if (value.hidden && pet.isVisible()) pet.hide();
    pet.webContents.send('fu:snapshot', value);
  }
  function readyPromise() { return new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); }
  let ready = readyPromise();
  async function until(read, timeout, reason) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline && !finishing) { const result = read(); if (result) return result; await wait(50); }
    throw Error(reason);
  }
  function finish(result, reason) {
    if (finishing) return;
    finishing = true; clearInterval(timer); clearTimeout(watchdog);
    report.result = result; report.reason = reason || null; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ result, reason: report.reason, report: path.join(output, 'report.json') }));
    if (pet && !pet.isDestroyed()) pet.destroy(); app.exit(result === 'PASS' ? 0 : 1);
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data|blob|devtools):/.test(details.url) }));
  ipcMain.handle('fu:initial', event => event.sender === pet?.webContents ? { snapshot: snapshot(), coverage } : null);
  ipcMain.on('fu:renderer-ready', (event, value) => {
    if (event.sender !== pet?.webContents || !preparing || !value || Object.keys(value).length !== 3 || value.runId !== run || value.token !== token || !['ready', 'error'].includes(value.status)) return;
    if (value.status === 'error') { rejectReady?.(Error('pet-material-ready-failed')); return; }
    report.readiness.push({ run, token, whileHidden: !pet.isVisible(), documentShownBeforeReady: pet.isVisible(), durationMs: performance.now() - preparedAt });
    if (pet.isVisible()) { finish('FAIL', 'pet-became-visible-before-ready'); return; }
    preparing = false; concealed = false; timeline.trigger(run, performance.now(), currentMetadata);
    const start = snapshot(); if (start.elapsedMs >= 20) { finish('FAIL', 'pet-clock-started-before-ready'); return; }
    report.readiness.at(-1).startElapsedMs = start.elapsedMs;
    progress('renderer-ready-hidden');
    pet.showInactive(); broadcast(); resolveReady?.();
  });
  ipcMain.on('fu:render-evidence', (event, value) => {
    if (event.sender !== pet?.webContents) return;
    const checked = sanitizeRenderEvidence(value);
    if (!checked || checked.runId !== run || !checked.paperlab) return;
    if (checked.paperlab.error) { finish('FAIL', 'paperlab-' + checked.paperlab.error); return; }
    const prior = report.rows.at(-1);
    report.rows.push({ atMs: performance.now(), run, windowVisible: pet.isVisible(), evidence: checked });
    if (!prior || prior.run !== run || prior.evidence.frame.phase !== checked.frame.phase) progress('render-' + checked.frame.phase);
  });
  ipcMain.on('fu:action', () => {});
  const area = screen.getPrimaryDisplay().workArea;
  const layout = independentPetLayout(null, area); check(layout, 'pet-work-area-unavailable'); geometry = layout.geometry; report.layout = layout;
  progress('window-create-start');
  pet = new BrowserWindow({ ...layout.bounds,
    show: false, frame: false, thickFrame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: false } });
  progress('window-created-hidden');
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pet.webContents.on('will-navigate', event => event.preventDefault());
  pet.webContents.on('will-attach-webview', event => event.preventDefault());
  pet.webContents.on('render-process-gone', () => finish('FAIL', 'pet-render-process-gone'));
  pet.webContents.on('did-fail-load', () => finish('FAIL', 'pet-load-failed'));
  for (const name of ['dom-ready', 'did-finish-load']) pet.webContents.on(name, () => progress(name));
  pet.once('ready-to-show', () => progress('ready-to-show-hidden'));
  watchdog = setTimeout(() => finish('FAIL', 'pet-probe-deadline'), 60000);
  timer = setInterval(broadcast, 250);
  progress('load-start');
  await pet.loadFile(path.join(root, 'desktop/pet.html'));
  progress('load-complete');
  async function stableHidden(selectedRun) {
    const hidden = await until(() => { const found = report.rows.filter(row => row.run === selectedRun && row.evidence.frame.phase === 'hidden' && !row.evidence.paperlab.canvasVisible); return found.length ? found : null; }, 5000, 'pet-hidden-evidence-missing');
    const first = hidden[0];
    await until(() => report.rows.find(row => row.run === selectedRun && row.atMs >= first.atMs + 1000 && row.evidence.frame.phase === 'hidden'), 5000, 'pet-hidden-stability-missing');
    const rows = report.rows.filter(row => row.run === selectedRun && row.atMs >= first.atMs);
    check(rows.every(row => !row.evidence.paperlab.canvasVisible && row.evidence.paperlab.actualDrawCount === first.evidence.paperlab.actualDrawCount && row.evidence.paperlab.textureRasterizations === first.evidence.paperlab.textureRasterizations && row.evidence.rafCount === first.evidence.rafCount), 'pet-hidden-kept-drawing');
    return { actualDrawCount: first.evidence.paperlab.actualDrawCount, sampleMs: rows.at(-1).atMs - first.atMs, samples: rows.length };
  }
  try {
    await Promise.race([ready, wait(12000).then(() => { throw Error('pet-hidden-cold-ready-timeout'); })]);
    await until(() => report.rows.some(row => row.run === run && row.evidence.frame.phase === 'hidden'), timings.totalMs + 5000, 'pet-natural-did-not-finish');
    const natural = report.rows.filter(row => row.run === run), phases = new Set(natural.map(row => row.evidence.frame.phase));
    for (const phase of ['unfold', 'writing', 'hold', 'burning', 'hidden']) check(phases.has(phase), 'pet-missing-' + phase);
    const holds = natural.filter(row => row.evidence.frame.phase === 'hold');
    check(holds.length >= 3 && holds.every(row => row.evidence.frame.writing === 1 && row.evidence.frame.leaveAtMs - row.evidence.frame.holdStartMs === 5000), 'pet-incomplete-five-second-hold');
    check(holds.every(row => row.evidence.paperlab.actualDrawCount === holds[0].evidence.paperlab.actualDrawCount && row.evidence.paperlab.textureRasterizations === holds[0].evidence.paperlab.textureRasterizations), 'pet-hold-kept-drawing');
    const burns = natural.filter(row => row.evidence.frame.phase === 'burning');
    check(burns.length >= 2 && burns.at(-1).evidence.paperlab.actualDrawCount > burns[0].evidence.paperlab.actualDrawCount && burns.at(-1).evidence.paperlab.damageVersion > burns[0].evidence.paperlab.damageVersion && burns.at(-1).evidence.paperlab.presenceRemaining < burns[0].evidence.paperlab.presenceRemaining, 'pet-no-actual-gpu-burn');
    report.natural = { result: 'PASS', phases: [...phases], holdMs: 5000, hidden: await stableHidden(run) };
    run = 'pet-probe-b'; token++; currentMetadata = metadata('乙'); preparing = true; concealed = true; preparedAt = performance.now(); pet.hide(); ready = readyPromise(); broadcast();
    await Promise.race([ready, wait(12000).then(() => { throw Error('pet-replacement-ready-timeout'); })]);
    await until(() => report.rows.some(row => row.run === run && row.evidence.frame.phase === 'unfold' && row.evidence.paperlab.canvasVisible), 5000, 'pet-replacement-did-not-render');
    timeline.cancel(timeline.current.token); concealed = true; pet.hide(); broadcast();
    report.cancel = { result: 'PASS', hidden: await stableHidden(run) };
    finish('PASS');
  } catch (error) { finish('FAIL', error.message); }
}
// Electron's default-app importer need not assign this CJS file as require.main.
// The fixed child flag and Electron runtime are both required for this branch.
if (process.versions.electron && process.argv.includes('--fixture-child')) fixture().catch(() => { process.stderr.write('Pet fixture initialization failed.\n'); require('electron').app.exit(1); });
else if (require.main === module) { try { launch(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; } }
module.exports = { plan };
