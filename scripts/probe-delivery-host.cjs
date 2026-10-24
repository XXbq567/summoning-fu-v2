'use strict';
// Own native transparent-window fixture only. No product main, hook, UIA,
// session files, installed instance, or official Pet is read or controlled.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const { EntranceTimeline, frameAt, timings } = require('../renderer/entrance-timeline.js');
const { sanitizeRenderEvidence, independentPetLayout, rebaseDeliveryLayout } = require('../desktop/host-state.cjs');
const { assertPaperlabArtifacts } = require('./paperlab-artifacts.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, reason) => { if (!value) throw Error(reason); };
function plan() {
  const nonce = crypto.randomBytes(8).toString('hex');
  const output = path.join(root, 'qa/delivery-host', new Date().toISOString().replace(/[:.]/g, '-') + '-' + nonce);
  const profile = path.join(output, 'summoning-fu-delivery-host-probe-' + nonce);
  return { output, profile, args: [__filename, '--delivery-fixture-child', '--user-data-dir=' + profile],
    initiallyHidden: true, renderer: 'desktop/pet.html+preload.cjs+pet.js', realPetTarget: 'NOT_TESTED', totalDeadlineMs: 100000 };
}
function analyseHidden(rows) {
  check(rows.length >= 2 && rows.at(-1).atMs - rows[0].atMs >= 900, 'hidden-stability-missing');
  const first = rows[0].evidence, p = first.paperlab;
  check(Number.isSafeInteger(p.actualClearCount), 'hidden-clear-evidence-missing');
  check(rows.every(({ evidence: e }) => e.frame.phase === 'hidden' && !e.paperlab.canvasVisible && e.frame.paperOpacity === 0 && e.frame.opacity === 0), 'hidden-not-clear');
  check(rows.every(({ evidence: e }) => e.paperlab.actualDrawCount === p.actualDrawCount && e.paperlab.actualClearCount === p.actualClearCount && e.paperlab.textureRasterizations === p.textureRasterizations && e.rafCount === first.rafCount), 'hidden-kept-drawing');
  return { result: 'PASS', sampleMs: rows.at(-1).atMs - rows[0].atMs, samples: rows.length, actualDrawCount: p.actualDrawCount, actualClearCount: p.actualClearCount };
}
function analyseNatural(rows, { hasTarget }) {
  check(rows.length > 0, 'native-evidence-missing');
  const phases = new Set(rows.map(r => r.evidence.frame.phase));
  for (const phase of ['unfold', 'writing', 'hold', ...(hasTarget ? ['folding', 'flying', 'intake'] : []), 'hidden']) check(phases.has(phase), 'missing-' + phase);
  check(rows.every(({ evidence: e }) => e.paperlab.materialReady && e.paperlab.error === null && e.paperlab.engine === 'paperlab' && e.paperlab.libraryVersion === '0.8.1'), 'native-material-not-ready');
  check(rows.every(({ evidence: e }) => e.frame.burn === 0 && e.paperlab.burn === 0 && e.paperlab.flameCount === 0), 'unexpected-fire');
  const first = rows[0].evidence.paperlab;
  check(rows.every(({ evidence: e }) => e.paperlab.metadataHash === first.metadataHash && e.paperlab.textureHash === first.textureHash && e.paperlab.textureRasterizations === first.textureRasterizations), 'native-metadata-changed');
  const holds = rows.filter(r => r.evidence.frame.phase === 'hold');
  // Normal pet intentionally retains a single rendered hold frame. Its activeMs
  // is frozen, so duration coverage uses the independent monotonic receive clock.
  check(holds.length >= 3 && holds.at(-1).atMs - holds[0].atMs >= 1500 && holds.every(({ evidence: e }) => e.frame.leaveAtMs - e.frame.holdStartMs === 2000 && e.frame.holdStartMs === 4150 && e.frame.writing === 1 && e.frame.visibleGlyphs === e.frame.totalGlyphs && e.frame.totalGlyphs > 0 && !e.paperlab.canvasVisible), 'incomplete-two-second-hold');
  check(holds.every(({ evidence: e }) => e.paperlab.actualDrawCount === holds[0].evidence.paperlab.actualDrawCount && e.paperlab.actualClearCount === holds[0].evidence.paperlab.actualClearCount && e.rafCount === holds[0].evidence.rafCount), 'hold-kept-drawing');
  if (hasTarget) {
    for (const phase of ['folding', 'flying', 'intake']) {
      const active = rows.filter(r => r.evidence.frame.phase === phase);
      check(active.length >= 2 && active.every(r => r.evidence.paperlab.canvasVisible && r.evidence.paperlab.deliveryTargetValid) && active.at(-1).evidence.paperlab.actualDrawCount > active[0].evidence.paperlab.actualDrawCount, 'native-no-actual-' + phase);
    }
    check(rows.some(r => r.evidence.frame.phase === 'intake' && r.evidence.paperlab.deliveryClipped), 'native-intake-not-clipped');
  } else {
    check(!['folding', 'flying', 'intake'].some(p => phases.has(p)), 'no-target-delivered');
    check(rows.filter(r => r.evidence.frame.phase === 'hidden').every(r => r.evidence.frame.hideAtMs === 6150), 'no-target-expiry-wrong');
  }
  const hidden = rows.filter(r => r.evidence.frame.phase === 'hidden');
  if (hasTarget) {
    const active = rows.filter(r => ['folding', 'flying', 'intake'].includes(r.evidence.frame.phase));
    check(hidden[0].evidence.paperlab.actualClearCount > active.at(-1).evidence.paperlab.actualClearCount, 'native-final-clear-missing');
  }
  return { result: 'PASS', classification: hasTarget ? 'SIMULATED_OWN_TARGET' : 'NO_TARGET_NATIVE_CLEAR', phases: [...phases], holdContractMs: 2000,
    observedHoldWallMs: holds.at(-1).atMs - holds[0].atMs, metadataHash: first.metadataHash,
    textureHash: first.textureHash, hidden: analyseHidden(hidden), visualQuality: 'NOT_TESTED_COUNTERS_ARE_NOT_PIXELS' };
}
function failureRecord(prior, reason) {
  const firstReason = prior.firstReason || (prior.result === 'FAIL' && prior.reason) || reason;
  return { ...prior, result: 'FAIL', reason: firstReason, firstReason, parentFailure: reason, finishedAt: new Date().toISOString() };
}
function launch() {
  const planned = plan();
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(planned)); return; }
  check(process.platform === 'win32', 'windows-native-probe-required');
  assertPaperlabArtifacts(root);
  fs.mkdirSync(planned.output, { recursive: true });
  const reportFile = path.join(planned.output, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify({ classification: 'OWN_NATIVE_DELIVERY_NOT_OFFICIAL_PET', result: 'RUNNING', stage: 'parent-launch', profile: planned.profile }) + '\n', { mode: 0o600 });
  let fatalReason = null;
  function failure(reason) {
    fatalReason ||= reason; process.exitCode = 1;
    let prior = {}; try { prior = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch {}
    fs.writeFileSync(reportFile, JSON.stringify(failureRecord(prior, fatalReason), null, 2) + '\n', { mode: 0o600 });
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), planned.args, { cwd: root, env, shell: false, windowsHide: false, stdio: 'inherit' });
  const watchdog = setTimeout(() => { failure('native-child-deadline'); child.kill(); }, planned.totalDeadlineMs);
  child.on('error', () => { clearTimeout(watchdog); failure('native-child-launch-failed'); });
  child.on('exit', (code, signal) => { clearTimeout(watchdog); if (fatalReason) failure(fatalReason); else if (code !== 0 || signal) failure('native-child-exited'); else {
    let report; try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch {}
    if (report?.result !== 'PASS') failure('native-child-no-pass-report');
  } });
}
async function fixture() {
  const { app, BrowserWindow, ipcMain, Menu, session, screen } = require('electron');
  const args = process.argv.filter(v => v.startsWith('--user-data-dir='));
  check(args.length === 1, 'probe-profile-required');
  const profile = args[0].slice('--user-data-dir='.length), output = path.dirname(profile);
  const relative = path.relative(path.join(root, 'qa/delivery-host'), profile);
  check(path.isAbsolute(profile) && relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^summoning-fu-delivery-host-probe-[a-f0-9]{16}$/.test(path.basename(profile)), 'probe-profile-invalid');
  fs.mkdirSync(output, { recursive: true });
  const report = { classification: 'OWN_NATIVE_DELIVERY_NOT_OFFICIAL_PET', result: 'RUNNING', profile, renderer: 'desktop/pet.html+preload.cjs+pet.js', timing: timings,
    startedAt: new Date().toISOString(), readiness: [], rows: [], natural: [], captures: [], invalidations: [],
    realPetTarget: 'NOT_TESTED', realSendHook: 'NOT_TESTED', mixedDpi: 'NOT_TESTED', pixelClearing: 'NOT_TESTED_PENDING_IMAGE_REVIEW',
    snapshotClones: { count: 0, allDistinct: true, planSignaturesStable: true, interpretation: 'IPC_CLONE_BEHAVIOR_NOT_OBJECT_POINTER_TELEMETRY' } };
  let pet, timer, watchdog, finishing = false, preparing = true, concealed = true, broadcastPaused = false, run = 'native-delivery-no-target', token = 1;
  let resolveReady, rejectReady, ready, preparedAt, startedAt = 0, geometry, deliveryTarget = null, deliveryPlan = null, currentMetadata, lastSent = null, planSignature = '';
  const timeline = new EntranceTimeline();
  const coverage = JSON.parse(fs.readFileSync(path.join(root, 'assets/fonts/coverage.json'), 'utf8'));
  const metadata = label => ({ model: '本机示例模型', harness: '本机示例', environment: '隔离透明窗口', reasoning: 'xhigh',
    sources: { model: 'demo', harness: 'demo', environment: 'demo', reasoning: 'demo', task: 'demo' },
    presentation: { mode: 'entrance', sessionId: 'own-delivery-' + label, chatTitle: { value: '本机示例 · ' + label, source: 'manual' } } });
  currentMetadata = metadata('甲');
  function progress(stage) {
    report.stage = stage;
    fs.appendFileSync(path.join(output, 'progress.jsonl'), JSON.stringify({ stage, atMs: performance.now(), run, token, visible: Boolean(pet && !pet.isDestroyed() && pet.isVisible()) }) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  function finish(result, reason) {
    if (finishing) return;
    finishing = true; clearInterval(timer); clearTimeout(watchdog);
    report.result = result; report.reason = reason || null; report.finishedAt = new Date().toISOString(); progress('finished');
    console.log(JSON.stringify({ result, reason: report.reason, report: path.join(output, 'report.json') }));
    if (pet && !pet.isDestroyed()) pet.destroy(); app.exit(result === 'PASS' ? 0 : 1);
  }
  function snapshot() {
    const nowMs = performance.now();
    const options = { geometry, deliveryTarget, deliveryPlan, nowMs, allowPreviewTarget: false };
    const frame = preparing ? frameAt(0, false, options) : timeline.snapshot(nowMs, false, options);
    return { ...frame, ...(preparing ? { elapsedMs: 0, visible: false, phase: 'hidden' } : {}), runId: run, presentationToken: token,
      presentationPreparing: preparing, presentationMode: 'independent-hook', presentationNowMs: nowMs, metadata: currentMetadata, geometry, deliveryTarget, deliveryPlan,
      hidden: preparing || concealed || !frame.visible, state: 'unknown', diagnosticsEnabled: true };
  }
  function broadcast() {
    if (!pet || pet.isDestroyed() || broadcastPaused) return;
    const original = snapshot(), value = structuredClone(original);
    report.snapshotClones.count++;
    report.snapshotClones.allDistinct &&= value !== original && (!value.deliveryPlan || value.deliveryPlan !== original.deliveryPlan) && value !== lastSent;
    if (value.deliveryPlan) report.snapshotClones.planSignaturesStable &&= JSON.stringify(value.deliveryPlan) === planSignature;
    lastSent = value;
    if (value.hidden && pet.isVisible()) pet.hide();
    pet.webContents.send('fu:snapshot', value);
  }
  const readyPromise = () => new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  async function until(read, timeout, reason) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline && !finishing) { const found = read(); if (found) return found; await wait(30); }
    throw Error(reason);
  }
  async function stableHidden(selectedRun) {
    const first = await until(() => report.rows.find(r => r.run === selectedRun && r.atMs >= startedAt && r.evidence.frame.phase === 'hidden'), 5000, 'native-hidden-missing');
    await until(() => report.rows.find(r => r.run === selectedRun && r.atMs >= first.atMs + 1000 && r.evidence.frame.phase === 'hidden'), 5000, 'native-hidden-stability-missing');
    return analyseHidden(report.rows.filter(r => r.run === selectedRun && r.atMs >= first.atMs));
  }
  progress('child-entry'); app.setPath('userData', profile);
  check(app.requestSingleInstanceLock(), 'probe-profile-already-running'); app.on('window-all-closed', () => {});
  watchdog = setTimeout(() => finish('FAIL', 'native-app-ready-timeout'), 15000);
  await app.whenReady(); clearTimeout(watchdog); Menu.setApplicationMenu(null); progress('app-ready');
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data|blob|devtools):/.test(details.url) }));
  ipcMain.handle('fu:initial', event => event.sender === pet?.webContents ? { snapshot: snapshot(), coverage } : null);
  ipcMain.on('fu:renderer-ready', (event, value) => {
    if (event.sender !== pet?.webContents || !preparing || !value || Object.keys(value).length !== 3 || value.runId !== run || value.token !== token || !['ready','error'].includes(value.status)) return;
    if (value.status === 'error') { rejectReady?.(Error('native-material-ready-failed')); return; }
    if (pet.isVisible()) { finish('FAIL', 'native-visible-before-ready'); return; }
    preparing = false; concealed = false; startedAt = performance.now(); timeline.trigger(run, startedAt, currentMetadata);
    report.readiness.push({ run, token, whileHidden: true, durationMs: startedAt - preparedAt, startElapsedMs: snapshot().elapsedMs });
    pet.showInactive(); broadcast(); progress('renderer-ready-hidden'); resolveReady?.();
  });
  ipcMain.on('fu:render-evidence', (event, value) => {
    if (event.sender !== pet?.webContents) return;
    const evidence = sanitizeRenderEvidence(value);
    if (!evidence || evidence.runId !== run || !evidence.paperlab) return;
    if (evidence.paperlab.error) { finish('FAIL', 'paperlab-' + evidence.paperlab.error); return; }
    const prior = report.rows.at(-1), row = { atMs: performance.now(), run, token, windowVisible: pet.isVisible(), evidence };
    report.rows.push(row);
    fs.appendFileSync(path.join(output, 'runtime.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
    if (!prior || prior.run !== run || prior.evidence.frame.phase !== evidence.frame.phase) progress('render-' + evidence.frame.phase);
  });
  ipcMain.on('fu:renderer-invalidated', (event, value) => {
    if (event.sender !== pet?.webContents || value?.runId !== run || value?.token !== token || !['target-changed','document-hidden','geometry-changed','pagehide'].includes(value.reason)) return;
    report.invalidations.push({ run, token, reason: value.reason, atMs: performance.now() });
  });
  ipcMain.on('fu:action', () => {});
  const area = screen.getPrimaryDisplay().workArea, template = independentPetLayout(null, area);
  check(template, 'native-work-area-unavailable');
  const scale = Math.min(.65, (area.height - 120) / template.bounds.height, (area.width - 320) / template.bounds.width);
  check(scale > .1, 'native-fixture-work-area-too-small');
  const scaleRect = r => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });
  const base = { bounds: { x: area.x + 40, y: area.y + 40, width: Math.ceil(template.bounds.width * scale), height: Math.ceil(template.bounds.height * scale) },
    geometry: { originRect: scaleRect(template.geometry.originRect), targetRect: scaleRect(template.geometry.targetRect) } };
  geometry = base.geometry; report.baseLayout = base; preparedAt = performance.now(); ready = readyPromise();
  pet = new BrowserWindow({ ...base.bounds, show: false, frame: false, thickFrame: false, transparent: true, resizable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: false } });
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pet.webContents.on('will-navigate', event => event.preventDefault()); pet.webContents.on('will-attach-webview', event => event.preventDefault());
  pet.webContents.on('render-process-gone', () => finish('FAIL', 'native-render-process-gone'));
  pet.webContents.on('did-fail-load', () => finish('FAIL', 'native-load-failed'));
  watchdog = setTimeout(() => finish('FAIL', 'native-probe-deadline'), 90000);
  timer = setInterval(broadcast, 100);
  async function awaitReady(reason) { await Promise.race([ready, wait(15000).then(() => { throw Error(reason); })]); }
  async function nextRun(id, label, target) {
    concealed = true; preparing = true; pet.hide(); run = id; token++; currentMetadata = metadata(label);
    preparedAt = performance.now(); ready = readyPromise();
    let layout = base;
    if (target) {
      const nowMs = performance.now();
      const value = { targetId: 'simulated-own-native-target', revision: 1, rect: { x: base.bounds.width + 55, y: base.bounds.height - 100, width: 64, height: 64 },
        coordinateSpace: 'overlay-local-dip', source: 'supported-host-adapter', valid: true, visible: true, observedAtMonotonicMs: nowMs, expiresAtMonotonicMs: nowMs + 30000 };
      layout = rebaseDeliveryLayout(base, value, { nowMs, workArea: area }); check(layout, 'native-simulated-layout-unavailable');
    }
    geometry = layout.geometry; deliveryTarget = layout.deliveryTarget || null; deliveryPlan = layout.deliveryPlan || null;
    planSignature = deliveryPlan ? JSON.stringify(deliveryPlan) : '';
    pet.setBounds(layout.bounds); broadcast(); await awaitReady('native-replacement-ready-timeout');
    report.layouts ||= {}; report.layouts[run] = { ...layout, targetClassification: target ? 'SIMULATED_OWN_TARGET' : 'NO_TARGET' };
  }
  async function natural(hasTarget) {
    const selected = run, begin = startedAt;
    await until(() => report.rows.some(r => r.run === selected && r.atMs >= begin && r.evidence.frame.phase === 'hidden'), 14000, 'native-natural-did-not-finish');
    await stableHidden(selected);
    const rows = report.rows.filter(r => r.run === selected && r.atMs >= begin);
    check(!report.invalidations.some(v => v.run === selected), 'native-unexpected-invalidation');
    report.natural.push({ run: selected, ...analyseNatural(rows, { hasTarget }), readbackDuringNatural: false }); progress('natural-sealed');
  }
  async function capture(stage) {
    const image = await Promise.race([pet.webContents.capturePage(), wait(3000).then(() => { throw Error('native-capture-deadline'); })]);
    check(!image.isEmpty(), 'native-capture-empty');
    const file = path.join(output, stage + '.png'), png = image.toPNG();
    fs.writeFileSync(file, png, { mode: 0o600 });
    const bitmap = image.toBitmap(); let nonzeroAlphaPixels = 0;
    for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i]) nonzeroAlphaPixels++;
    report.captures.push({ stage, file, sha256: crypto.createHash('sha256').update(png).digest('hex'), nonzeroAlphaPixels,
      classification: 'SEPARATE_OWN_WINDOW_IMAGE_NOT_NATURAL_ACCEPTANCE', evidence: report.rows.at(-1)?.evidence });
    return nonzeroAlphaPixels;
  }
  try {
    await pet.loadFile(path.join(root, 'desktop/pet.html')); await awaitReady('native-hidden-cold-ready-timeout');
    await natural(false);
    await nextRun('native-delivery-simulated', '乙', true); await natural(true);
    check(report.snapshotClones.allDistinct && report.snapshotClones.planSignaturesStable, 'native-snapshot-clone-contract');
    // Natural results are sealed before any GPU readback is requested.
    await nextRun('native-delivery-images', '丙', true);
    await until(() => report.rows.find(r => r.run === run && r.evidence.frame.phase === 'hold'), 8000, 'native-image-hold-missing');
    check(await capture('hold') > 0, 'native-hold-image-empty-alpha');
    await until(() => report.rows.find(r => r.run === run && r.evidence.frame.phase === 'folding'), 4000, 'native-image-fold-missing');
    check(await capture('folding-live') > 0, 'native-fold-image-empty-alpha');
    await until(() => report.rows.some(r => r.run === run && r.evidence.frame.phase === 'hidden'), 6000, 'native-image-end-missing');
    await stableHidden(run);
    // Re-show only this already-cancelled own window so capturePage observes the
    // cleared compositor. Its unchanged generation cannot resume an old symbol.
    broadcastPaused = true; pet.showInactive(); await wait(150);
    const alpha = await capture('hidden'); check(alpha === 0, 'native-hidden-pixels-remain'); pet.hide(); broadcastPaused = false;
    report.pixelClearing = 'PASS_OWN_WINDOW_ZERO_ALPHA';
    await nextRun('native-delivery-cancel', '丁', true);
    await until(() => report.rows.find(r => r.run === run && r.evidence.frame.phase === 'flying'), 10000, 'native-cancel-flight-missing');
    timeline.cancel(timeline.current.token); concealed = true; pet.hide(); broadcast();
    const hidden = await stableHidden(run);
    // Re-send the same cancelled generation with a visible request. pet.js must
    // retain cancelledKey, independently of the already-cancelled host timeline.
    const late = structuredClone(snapshot()); Object.assign(late, { elapsedMs: 7000, visible: true, hidden: false });
    broadcastPaused = true; pet.showInactive(); const lateAt = performance.now();
    pet.webContents.send('fu:snapshot', late); await wait(1200);
    const lateRows = report.rows.filter(r => r.run === run && r.atMs >= lateAt);
    check(lateRows.length > 0 && lateRows.every(r => r.evidence.frame.phase === 'hidden' && !r.evidence.paperlab.canvasVisible && r.evidence.paperlab.actualDrawCount === hidden.actualDrawCount), 'native-cancel-resurrected');
    pet.hide(); broadcastPaused = false;
    report.cancel = { result: 'PASS', hidden, sameGenerationLateVisibleRequest: 'NO_RESURRECTION_SAMPLED' };
    const oldHash = report.natural[1].metadataHash;
    await nextRun('native-delivery-replacement', '戊', false);
    const replacement = await until(() => report.rows.find(r => r.run === run && r.atMs >= startedAt && r.evidence.frame.phase !== 'hidden'), 5000, 'native-replacement-not-rendered');
    check(replacement.evidence.frame.writing === 0 && replacement.evidence.frame.visibleGlyphs === 0 && replacement.evidence.paperlab.metadataHash !== oldHash, 'native-replacement-not-fresh-blank');
    timeline.cancel(timeline.current.token); concealed = true; pet.hide(); broadcast();
    report.replacement = { result: 'PASS', firstPhase: replacement.evidence.frame.phase, firstWriting: 0, firstVisibleGlyphs: 0,
      singleFrameFlash: 'NOT_TESTED_SAMPLED_EVIDENCE', hidden: await stableHidden(run) };
    finish('PASS');
  } catch (error) { finish('FAIL', error.message); }
}
// Electron default-app loading does not reliably set require.main to this file.
if (process.versions.electron && process.argv.includes('--delivery-fixture-child')) fixture().catch(() => {
  process.stderr.write('Native delivery fixture initialization failed.\n'); require('electron').app.exit(1);
});
else if (require.main === module) { try { launch(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; } }
module.exports = { plan, analyseNatural, analyseHidden, failureRecord };
