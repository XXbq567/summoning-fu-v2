'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, dialog, powerMonitor, session, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { HostClock, entranceBounds, independentPetLayout, EntranceScheduler, verifyEntranceUntil, startupIntent, sanitizeRenderEvidence, AdmissionEvidence, admissionMessage, entrancePathShape, entranceArgvShapes, parseEntranceArgument, sanitizeReasoningEvidence, previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate, entranceMotionPolicy } = require('./host-state.cjs');
const { SendAdmissionGate, sendOverlayLayout, workAnchorAssociation, sendDiagnostic, sendDiagnosticInvalidates, sanitizeObserverDiagnostic, previewQaProfile, samePreviewQaProfile } = require('./host-state.cjs');
const { DeliveryTargetBridge, rebaseDeliveryLayout } = require('./host-state.cjs');
const { relayNativeWindowHidden, samePausedPreviewIdentity } = require('./host-state.cjs');
const { prepareLocalSealLayout } = require('./host-state.cjs');
const { resolveProvider } = require('../renderer/provider-identity.js');
const { SendObserver } = require('./send-observer.cjs');
const { EnvelopeBridge } = require('../adapter/envelope.cjs');
const { RolloutAdapter } = require('../adapter/rollout.cjs');
const { readEntranceFile, verifyEntranceTurn, applyVerifiedReasoning, SUPPORTED_CLI_VERSIONS } = require('../adapter/entrance-event.cjs');
const { readChatTitle } = require('../adapter/chat-title.cjs');
const { verificationAnchor } = require('../adapter/paginated-state.cjs');
const { observedInvalidationScope } = require('./entrance-contract.cjs');
const { ownNativeBounds, nativeBoundsMatch } = require('./native-window-geometry.cjs');
const { EntranceTimeline, timings: entranceTimings } = require('../renderer/entrance-timeline.js');
const EXPECTED_VERSION = SUPPORTED_CLI_VERSIONS.join(' / ');
let pet, reader, preview, tray, adapter, bridge, clock = new HostClock();
let previewEvidence = null, previewContext = null, previewEvidenceAt = 0, pendingPreview = false;
let previewReplayGate = new PreviewReplayGate();
const entrance = new EntranceTimeline(), scheduler = new EntranceScheduler();
// Only a future qualified Node host adapter may feed this bridge. There is no
// renderer IPC for declaring a supported Pet target; current normal runs have none.
const deliveryTargets = new DeliveryTargetBridge();
let displayContext = null, pendingTimer = null, expiryTimer = null, expiryKey = '', queuedEntranceFiles = [];
let entranceCancellation = 0;
let pendingPresentation = null, presentationGeneration = 0;
let petAnchor = null;
let petNativeBounds = null;
let settings = {}, settingsPath, coverage = {}, hidden = false, quitting = false, moving = false, timer;
let diagnostic = '未绑定会话。请选择本机 Codex 会话文件。';
let bound = null, bindingChanged = false;
let aliases = {};
let diagnosticsFile = null, diagnosticTick = 0;
const admissionEvidence = new AdmissionEvidence();
let admissionWrite = Promise.resolve();
let intakeShape = null;
let secondInstanceArgvShape = null;
function recordAdmission(stage, event, receivedAt, reason = 'none') {
  admissionEvidence.record(stage, { reason, at: Date.now(), elapsedMs: performance.now() - receivedAt });
  if (runtimeProfile.enabled) return;
  const value = hookAdmissionSnapshot(), file = path.join(app.getPath('userData'), 'entrance-status.json');
  admissionWrite = admissionWrite.then(async () => {
    const stat = await fs.promises.lstat(file).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) return;
    await fs.promises.writeFile(file, JSON.stringify(value) + '\n', { mode: 0o600 });
  }).catch(() => {});
}
function hookAdmissionSnapshot() {
  const { stage, reason, at, counters } = admissionEvidence.snapshot();
  return { stage, reason, at, counters };
}
let captureDirectory = null, captureIndex = 0;
let previewInput = { classification: 'OWN_PREVIEW_SEND_INPUT_EVENT', status: 'NOT_TESTED' };
const captureTimers = [], captureStatus = {};
const rendererHealth = {};
const windowLifecycle = {}, readyWindows = new WeakSet();
let readerRequested = false;
let renderEvidence = null;
let visualStages = {};
let sendObserver = null, observerSuspended = false, observerStatus = 'observing', observerDiagnostic = null;
const sendGate = new SendAdmissionGate();
const liveWindows = () => [pet, reader].filter(w => w && !w.isDestroyed());
const allowedSender = event => liveWindows().some(w => w.webContents === event.sender);
function readSettings() {
  try { const v = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); if (v && typeof v === 'object') settings = v; } catch {}
}
function saveSettings() {
  if (runtimeProfile.enabled) return;
  const actual = petAnchor;
  const value = desktopSettingsSnapshot({ settings, binding: bound, bindingChanged, position: actual });
  try { fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(settingsPath + '.tmp', settingsPath); } catch { diagnostic = '本机设置未能保存；当前显示仍可使用。'; }
}
function motionPolicy() {
  let systemPreference = renderEvidence?.systemReducedMotion ?? null;
  try { systemPreference = systemPreferences.getAnimationSettings().prefersReducedMotion; } catch {}
  return entranceMotionPolicy(systemPreference);
}
function presentationGeometry(now) {
  const context = displayContext, current = entrance.current;
  if (context?.localSeal) return { geometry: context.layout.geometry, localSeal: context.localSeal, deliveryPlan: current?.cancelled && !pendingPresentation ? null : context.deliveryPlan, allowLocalSeal: true, allowPreviewTarget: false, nowMs: now };
  let target = deliveryTargets.targetAt(now);
  if (context && current && !pendingPresentation && !current.cancelled && !current.expired) {
    const elapsed = now - current.startedAt;
    if (context.deliveryPlan && !target) cancelPresentation('target-changed');
    else if (elapsed >= entranceTimings.leaveAtMs && !context.deliveryResolved) {
      context.deliveryResolved = true;
      if (target && deliveryTargets.freezePlan(context.layout?.geometry, now)) {
        const previous = context.layout, area = screen.getDisplayMatching(previous.bounds).workArea;
        const layout = rebaseDeliveryLayout(previous, target, { nowMs: now, workArea: area });
        if (layout) {
          context.deliveryOffset = { x: previous.bounds.x - layout.bounds.x, y: previous.bounds.y - layout.bounds.y };
          context.layout = layout; context.deliveryPlan = layout.deliveryPlan; context.deliveryReason = 'none'; if (!reposition()) cancelPresentation('geometry-changed');
        } else cancelPresentation('geometry-changed');
      } else context.deliveryReason = deliveryTargets.reason || 'target-unavailable';
    }
  }
  if (!context?.deliveryPlan || current?.cancelled) target = null;
  else if (target) target = { ...target, rect: { ...target.rect, x: target.rect.x + context.deliveryOffset.x, y: target.rect.y + context.deliveryOffset.y } };
  return { geometry: context?.layout?.geometry || null, deliveryTarget: target, deliveryPlan: current?.cancelled ? null : context?.deliveryPlan || null, allowPreviewTarget: false, nowMs: now };
}
function snapshot() {
  const policy = motionPolicy();
  const now = performance.now(), task = clock.snapshot(now), presentation = presentationGeometry(now), rawFrame = entrance.snapshot(now, policy.effectiveReducedMotion, presentation);
  if (displayContext && entrance.current && !pendingPresentation && !rawFrame.visible && displayContext.terminalElapsed === undefined) displayContext.terminalElapsed = Math.min(rawFrame.elapsedMs, rawFrame.hideAtMs);
  const frame = displayContext?.terminalElapsed === undefined ? rawFrame : { ...rawFrame, elapsedMs: displayContext.terminalElapsed };
  const sameTurn = displayContext?.sessionId && displayContext?.turnId && task.sessionId === displayContext.sessionId && task.runId === displayContext.turnId;
  return { ...task, ...frame, runId: frame.id, sessionId: displayContext?.sessionId || null, turnId: displayContext?.turnId || null, source: displayContext?.source || 'unknown', activeMs: frame.elapsedMs,
    ...(pendingPresentation ? { runId: pendingPresentation.eventId, elapsedMs: 0, activeMs: 0, visible: false, phase: 'hidden' } : {}),
    presentationPreparing: Boolean(pendingPresentation), presentationToken: displayContext?.presentationToken ?? null, presentationMode: displayContext?.presentationMode || 'unknown',
    ...policy, ...presentation, presentationNowMs: now, metadata: displayContext?.metadata || frame.metadata, confirmation: displayContext?.confirmation || 'unknown', observerStatus, observerDiagnostic,
    observerMessage: sendDiagnostic(observerStatus, observerDiagnostic), hookAdmission: hookAdmissionSnapshot(),
    deliveryReason: displayContext?.deliveryReason || 'target-unavailable',
    diagnosticsEnabled: Boolean(diagnosticsFile), state: sameTurn ? task.state : 'unknown', hidden: hidden || !frame.visible, diagnostic,
    binding: displayContext ? { sessionId: displayContext.sessionId, fileName: sameTurn && bound ? path.basename(bound.file) : '入口事件（未绑定当前轮次日志）' } : null,
    adapterLabel: displayContext?.source === 'chatgpt-uia' ? 'Chat 发送控件观察 · 不代表服务端确认或模型工作状态' : displayContext?.source === 'codex-user-prompt-submit' ? '已核验 Codex hook · 独立伴随层，不推断当前焦点聊天或发送按钮位置' : '手动绑定/本地预览 · 不计为自动接入验收',
    expectedVersion: EXPECTED_VERSION, titleSource: displayContext?.title?.source || 'pending', pendingEntrance: Boolean(scheduler.pending), departureTarget: presentation.deliveryTarget?.source || 'unavailable' };
}
function broadcast() {
  const value = snapshot();
  if (pet && !pet.isDestroyed() && (hidden || !value.visible) && pet.isVisible()) pet.hide();
  if (value.visible) {
    const key = `${value.token}:${value.hideAtMs}`;
    if (key !== expiryKey) { expiryKey = key; clearTimeout(expiryTimer); const token = value.token; expiryTimer = setTimeout(() => { if (entrance.current?.token === token) broadcast(); }, Math.max(1, value.hideAtMs - value.elapsedMs + 1)); }
  }
  for (const w of liveWindows()) if (!w.webContents.isLoading()) w.webContents.send('fu:snapshot', value);
  const diagnosticIntervalMs = runtimeProfile.enabled && !runtimeProfile.interactive ? 30 : 1000;
  if (diagnosticsFile && performance.now() - diagnosticTick >= diagnosticIntervalMs) {
    diagnosticTick = performance.now();
    const evidence = { at: new Date().toISOString(), platform: process.platform, electron: process.versions.electron, sessionId: value.sessionId, runId: value.runId, state: value.state, activeMs: Math.round(value.activeMs), kind: value.kind, elapsedMs: Math.round(value.elapsedMs), token: value.token, phase: value.phase, visible: value.visible, hideAtMs: value.hideAtMs, titleSource: value.titleSource, source: displayContext?.source || 'unknown', turnId: displayContext?.turnId || null, sourceStartedAtMs: displayContext?.verificationStartedAtMs || null, sourceOffset: displayContext?.verificationOffset ?? null, pendingEntrance: value.pendingEntrance, departureTarget: value.departureTarget, deliveryReason: value.deliveryReason, metadataHash: crypto.createHash('sha256').update(JSON.stringify(value.metadata)).digest('hex'), rendererHealth, windowLifecycle, renderEvidence, captureStatus,
      windows: liveWindows().map((w, index) => ({ index, visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), bounds: w.getBounds() })), displays: screen.getAllDisplays().map(d => ({ id: d.id, scaleFactor: d.scaleFactor, workArea: d.workArea })) };
    evidence.admission = admissionEvidence.snapshot();
    evidence.reasoning = sanitizeReasoningEvidence(displayContext?.reasoningEvidence);
    evidence.systemReducedMotion = value.systemReducedMotion;
    evidence.effectiveReducedMotion = value.effectiveReducedMotion;
    evidence.observerStatus = observerStatus; evidence.confirmation = value.confirmation;
    evidence.visualStages = visualStages;
    evidence.preview = { open: Boolean(preview && !preview.isDestroyed()), visible: Boolean(preview && !preview.isDestroyed() && preview.isVisible()), source: previewContext?.source || null, evidence: previewEvidence, input: previewInput };
    evidence.isolation = { generation: scheduler.generation, sourceWatermark: Number.isFinite(scheduler.sourceWatermark) ? scheduler.sourceWatermark : null, sourceEvent: scheduler.sourceEvent };
    evidence.intakeShape = intakeShape;
    evidence.secondInstanceArgvShape = secondInstanceArgvShape;
    fs.appendFile(diagnosticsFile, JSON.stringify(evidence) + '\n', { mode: 0o600 }, () => {});
  }
}
async function captureWindows() {
  if (!captureDirectory) return;
  const prefix = new Date().toISOString().replace(/[:.]/g, '-') + '-' + (++captureIndex);
  for (const [name, w] of [['pet', pet], ['reader', reader], ['preview', preview]]) {
    if (!w || w.isDestroyed() || !w.isVisible()) { captureStatus[name] = 'skipped-hidden'; continue; }
    try {
      const before = name === 'preview' ? previewEvidence : null;
      if (name === 'preview') {
        if (!samePausedPreviewIdentity(before, before)) { captureStatus[name] = 'capture-requires-paused-preview'; continue; }
        const settled = await w.webContents.executeJavaScript("new Promise(resolve => { let done = false; const timer = setTimeout(() => { done = true; resolve(false); }, 800); requestAnimationFrame(() => requestAnimationFrame(() => { if (!done) { done = true; clearTimeout(timer); resolve(true); } })); })");
        if (!settled || !samePausedPreviewIdentity(before, previewEvidence)) { captureStatus[name] = 'capture-paint-or-generation-changed'; continue; }
      }
      const captured = await w.webContents.capturePage();
      if (name === 'preview' && !samePausedPreviewIdentity(before, previewEvidence)) { captureStatus[name] = 'capture-generation-changed'; continue; }
      const fileName = `${prefix}-${name}.png`; await fs.promises.writeFile(path.join(captureDirectory, fileName), captured.toPNG(), { flag: 'wx', mode: 0o600 }); captureStatus[name] = fileName;
    }
    catch { captureStatus[name] = 'capture-unavailable'; }
  }
}
async function captureVisualStage(evidence) {
  if (!diagnosticsFile || !captureDirectory || !pet || pet.isDestroyed() || !pet.isVisible() || evidence.documentHidden) return;
  const f = evidence.frame, phase = f.phase;
  if (!['unfold', 'writing', 'hold', 'burning'].includes(phase) || visualStages[phase]) return;
  if (phase === 'unfold' && f.visibleGlyphs !== 0) return;
  if (phase === 'writing' && !(f.writing >= 0.25 && f.writing <= 0.75 && f.visibleGlyphs > 0 && f.visibleGlyphs < f.totalGlyphs)) return;
  if (phase === 'hold' && !(f.writing === 1 && f.visibleGlyphs === f.totalGlyphs)) return;
  if (phase === 'burning' && !(f.burn >= 0.3 && f.burn <= 0.7)) return;
  const stages = visualStages, entry = { before: evidence, capture: null, after: null, status: 'pending' };
  stages[phase] = entry;
  try {
    const captured = await pet.webContents.capturePage();
    entry.after = renderEvidence;
    if (stages !== visualStages || entry.after?.runId !== evidence.runId || entry.after?.frame.phase !== phase) { entry.status = 'phase-changed'; return; }
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${++captureIndex}-${phase}-pet.png`;
    await fs.promises.writeFile(path.join(captureDirectory, name), captured.toPNG(), { flag: 'wx', mode: 0o600 });
    entry.capture = name; entry.status = 'captured';
  } catch { entry.status = 'capture-unavailable'; }
}
function secureWindow(options, filename) {
  const w = new BrowserWindow({ ...options, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: false } });
  if (filename === 'pet.html') relayNativeWindowHidden(w, 'pet');
  else if (filename === 'motion-preview.html') relayNativeWindowHidden(w, 'preview');
  windowLifecycle[filename] = { ready: false, events: {} };
  for (const name of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore', 'close']) w.on(name, () => { const entry = windowLifecycle[filename]; entry.events[name] = (entry.events[name] || 0) + 1; entry.lastEvent = name; });
  w.once('ready-to-show', () => { readyWindows.add(w); windowLifecycle[filename].ready = true; if (w === reader && readerRequested) showReader(); });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', event => event.preventDefault());
  w.webContents.on('will-attach-webview', event => event.preventDefault());
  w.webContents.on('did-finish-load', () => { rendererHealth[filename] = 'loaded'; });
  w.webContents.on('did-fail-load', (_event, code) => { rendererHealth[filename] = `load-error:${code}`; });
  w.webContents.on('render-process-gone', (_event, details) => { rendererHealth[filename] = `process-gone:${details.reason}`; });
  w.webContents.on('console-message', (_event, details) => { if (details.level === 'error') rendererHealth[filename] = 'renderer-console-error'; });
  w.loadFile(path.join(__dirname, filename));
  return w;
}
function reposition() {
  if (moving || !pet || pet.isDestroyed()) return false;
  let requested = displayContext?.layout?.bounds;
  if (!requested) {
    const cb = petAnchor || pet.getBounds(), area = screen.getDisplayMatching(cb).workArea;
    petAnchor = entranceBounds({ x: cb.x, y: cb.y }, area); requested = petAnchor;
  }
  moving = true;
  petNativeBounds = null;
  try {
    pet.setBounds(requested);
    const actual = pet.getBounds();
    let roundTrip = null;
    try { roundTrip = screen.screenToDipRect(null, screen.dipToScreenRect(null, requested)); } catch {}
    petNativeBounds = ownNativeBounds(requested, actual, roundTrip);
    windowLifecycle['pet.html'].nativeGeometry = petNativeBounds || { mode: 'rejected' };
    return !!petNativeBounds;
  } catch { return false; }
  finally { moving = false; }
}
function cancelPresentation(reason = 'geometry-changed') {
  scheduler.cancel(); clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++; entranceCancellation++;
  deliveryTargets.invalidate(reason);
  if (displayContext) { displayContext.deliveryReason = reason; displayContext.deliveryPlan = null; displayContext.deliveryResolved = true; }
  if (entrance.current) entrance.cancel(entrance.current.token);
}
function cancelObservedPresentation(reason) {
  observerStatus = reason;
  const owned = observedInvalidationScope(displayContext, pendingPresentation, entrance.current);
  sendGate.invalidate();
  if (owned.pending) { clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++; }
  if (owned.current) entrance.cancel(entrance.current.token);
  if (owned.pending || owned.current) diagnostic = sendDiagnostic(reason, observerDiagnostic);
  broadcast();
}
function setVisible(value) { hidden = !value; if (!value) { scheduler.cancel(); clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++; entranceCancellation++; sendGate.invalidate(); if (entrance.current) entrance.cancel(entrance.current.token); } if (value && entrance.snapshot(performance.now(), motionPolicy().effectiveReducedMotion).visible) { if (reposition()) pet.showInactive(); else { cancelPresentation('geometry-changed'); pet.hide(); } } else pet.hide(); broadcast(); }
function acceptUiObservation(observation) {
  if (quitting || observerSuspended) return;
  const admission = sendGate.accept(observation, performance.now());
  if (observation?.kind === 'unavailable') observerDiagnostic = sanitizeObserverDiagnostic(admission.diagnostic);
  if (!admission.accepted) {
    if (['duplicate', 'retired-observer'].includes(admission.reason)) return;
    if (admission.invalidated || observation.kind === 'send-invoked') cancelObservedPresentation(admission.reason);
    else { observerStatus = admission.reason; diagnostic = sendDiagnostic(admission.reason); broadcast(); }
    return;
  }
  let layout;
  try {
    const anchor = screen.screenToDipRect(null, observation.anchor), viewport = screen.screenToDipRect(null, observation.viewport);
    const display = screen.getDisplayMatching(viewport);
    layout = sendOverlayLayout(anchor, viewport, display.workArea);
  } catch {}
  if (!layout) { cancelObservedPresentation('geometry-invalid'); return; }
  if (!sendGate.isCurrent(admission.token)) return;
  // Metadata comes from a fresh unknown-valued object, never from the previous Work context.
  scheduler.cancel(); clearTimeout(pendingTimer); entranceCancellation++;
  observerStatus = 'send-invoked';
  applyEntrance({ ...admission, layout, presentationMode: 'observed-chat', title: { value: null, source: 'pending' } });
}
function independentHookLayout() {
  const saved = petAnchor || pet.getBounds(), area = screen.getDisplayMatching(saved).workArea;
  const layout = independentPetLayout(saved, area);
  if (layout) { const target = layout.geometry.targetRect; petAnchor = { x: layout.bounds.x + target.x, y: layout.bounds.y + target.y, width: target.width, height: target.height }; }
  return layout;
}
function applyEntrance(context) {
  clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++;
  deliveryTargets.beginGeneration();
  if (bound && bound.sessionId !== context.sessionId) { adapter?.stop(); adapter = null; bound = null; bindingChanged = true; clock = new HostClock(); }
  const title = context.title || { value: null, source: 'pending' };
  const metadata = { ...(context.metadata || {}), sources: { ...(context.metadata?.sources || context.provenance || {}) }, presentation: { mode: 'entrance', sessionId: context.sessionId, chatTitle: { value: title.value, source: ['codex-session-index', 'codex-paginated-name'].includes(title.source) ? 'reported' : 'unknown' } } };
  // Prompt bodies are never presentation content, even for manual rollout binding.
  metadata.task = title.value; metadata.fullTask = title.value; metadata.fullTaskTruncated = false; metadata.sources.task = title.value ? 'reported' : 'unknown';
  const provider = resolveProvider(metadata, { allowDemo: false });
  let localLayout = null;
  if (context.layout) {
    try { localLayout = prepareLocalSealLayout(context.layout, { runId: context.eventId, generation: presentationGeneration, layoutVersion: 0, provider, workArea: screen.getDisplayMatching(context.layout.bounds).workArea }); } catch {}
  }
  if (localLayout) { const paper = localLayout.geometry.targetRect; petAnchor = { x: localLayout.bounds.x + paper.x, y: localLayout.bounds.y + paper.y, width: paper.width, height: paper.height }; }
  displayContext = { ...context, title, metadata, provider, layout: localLayout, localSeal: localLayout?.localSeal || null, presentationToken: presentationGeneration, deliveryReason: localLayout ? 'local-generated-seal' : 'geometry-unavailable', deliveryResolved: true, deliveryPlan: localLayout?.deliveryPlan || null }; renderEvidence = null; visualStages = {};
  if (entrance.current) entrance.cancel(entrance.current.token);
  if (!localLayout) {
    if (entrance.current) entrance.cancel(entrance.current.token);
    diagnostic = '本机可用区域不足以容纳纸面与临时印记；本轮没有从猜测位置播放。';
    pet.hide(); broadcast(); return;
  }
  pendingPresentation = displayContext; hidden = true; pet.hide();
  if (!reposition()) { cancelPresentation('geometry-changed'); broadcast(); return; }
  diagnostic = '正在准备本机 Paperlab 纸张与字体；准备完成后开始本次完整动效。';
  const prepared = pendingPresentation;
  pendingTimer = setTimeout(() => { if (pendingPresentation !== prepared) return; pendingPresentation = null; presentationGeneration++; diagnostic = 'Paperlab 纸张未能在本机准备完成，请打开预览查看渲染状态。'; broadcast(); }, 12000);
  broadcast();
}
async function rendererReady(event, value) {
  if (!pet || event.sender !== pet.webContents || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || !['runId', 'token', 'status'].every(key => Object.hasOwn(value, key)) || typeof value.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.runId) || !Number.isSafeInteger(value.token) || value.token < 1 || !['ready', 'error'].includes(value.status)) return;
  const prepared = pendingPresentation;
  const current = () => !quitting && !observerSuspended && pendingPresentation === prepared && prepared?.eventId === value.runId && prepared.presentationToken === value.token;
  if (!current()) return;
  if (value.status === 'error') { clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++; diagnostic = 'Paperlab 本机渲染准备失败；本次没有播放，未改变任务状态。'; broadcast(); return; }
  if (prepared.verifiedEvent) {
    const verification = await verifyEntranceTurn(prepared.verifiedEvent);
    if (!current()) return;
    if (!samePreparedVerification(prepared, verification)) {
      clearTimeout(pendingTimer); pendingPresentation = null; presentationGeneration++; diagnostic = admissionMessage(verification.reason || 'source-changed'); broadcast(); return;
    }
  }
  if (!current()) return;
  clearTimeout(pendingTimer); pendingPresentation = null;
  if (!reposition()) { cancelPresentation('geometry-changed'); broadcast(); return; }
  entrance.trigger(prepared.eventId, performance.now(), prepared.metadata); hidden = false;
  diagnostic = '本轮符面与临时印记已在本机冻结；全文停留 2 秒后卷入自有印记。印记不属于官方 Pet，也不表示任务完成或服务端确认。';
  if (prepared.verifiedEvent) recordAdmission('applied', prepared.verifiedEvent, prepared.receivedAt);
  pet.showInactive(); broadcast();
}
function showMotionPreview() {
  if (preview && !preview.isDestroyed()) { if (preview.isMinimized()) preview.restore(); if (runtimeProfile.enabled && !runtimeProfile.interactive) preview.showInactive(); else { preview.show(); preview.focus(); } if (previewReplayGate.request()) preview.webContents.send('fu:preview-command', 'replay'); return; }
  const sample = { relay: '本地示例', company: '原创示例', model: '示例模型', harness: 'Codex', environment: '本机预览', reasoning: 'xhigh', sources: Object.fromEntries(['relay', 'company', 'model', 'harness', 'environment', 'reasoning', 'task'].map(field => [field, 'demo'])), presentation: { mode: 'entrance', sessionId: 'local-preview-example', chatTitle: { value: '本地示例 · 观纸落墨', source: 'manual' } } };
  previewContext = { source: displayContext?.metadata ? 'frozen-current' : 'example', metadata: JSON.parse(JSON.stringify(displayContext?.metadata || sample)) };
  previewEvidence = null; previewEvidenceAt = 0; previewReplayGate = new PreviewReplayGate();
  const interactive = !runtimeProfile.enabled || runtimeProfile.interactive === true;
  preview = secureWindow({ width: 1080, height: 880, minWidth: 780, minHeight: 650, focusable: interactive, resizable: interactive, maximizable: interactive, minimizable: interactive, fullscreenable: interactive, title: '召唤符 · Paperlab 完整动效', backgroundColor: '#171610' }, 'motion-preview.html');
  const opened = preview;
  opened.once('ready-to-show', () => { if (!opened.isDestroyed()) { if (runtimeProfile.enabled && !runtimeProfile.interactive) opened.showInactive(); else { opened.show(); opened.focus(); } } });
  opened.on('closed', () => { if (preview === opened) preview = null; });
}
function previewQACommand(command) {
  if (!diagnosticsFile || !captureDirectory || !preview || preview.isDestroyed()) return;
  if (command === 'hide') preview.hide();
  else if (command === 'show') { if (runtimeProfile.enabled && !runtimeProfile.interactive) preview.showInactive(); else { preview.show(); preview.focus(); } }
  else if (command === 'close') preview.close();
  else if (command === 'target-drag') void dragPreviewTarget();
  else if (previewCommandAllowed(command)) preview.webContents.send('fu:preview-command', command);
}
async function dragPreviewTarget() {
  const w = preview;
  if (!runtimeProfile.enabled || !w || w.isDestroyed() || !w.isVisible()) return;
  previewInput = { classification: 'OWN_PREVIEW_SEND_INPUT_EVENT', status: 'attempted' };
  let down = false;
  try {
    // Read this program's labelled example only. No official application,
    // operating-system cursor position or remembered Pet coordinate is used.
    const target = await w.webContents.executeJavaScript("(() => { const e = document.querySelector('#preview-target'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; })()");
    if (!target || !['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'].every(key => Number.isFinite(target[key]) && Math.abs(target[key]) <= 32768) || target.width <= 0 || target.height <= 0) throw Error('example-target-unavailable');
    const from = { x: Math.round(target.x + target.width / 2), y: Math.round(target.y + target.height / 2) };
    const dx = from.x > target.viewportWidth / 2 ? -64 : 64;
    w.webContents.send('fu:preview-command', 'qa-target-drag-arm');
    await new Promise(resolve => setTimeout(resolve, 20));
    w.webContents.sendInputEvent({ type: 'mouseMove', ...from });
    w.webContents.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 }); down = true;
    for (let i = 1; i <= 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (w.isDestroyed()) throw Error('example-window-closed');
      w.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + dx * i / 4), y: from.y - i * 3, button: 'left', modifiers: ['leftButtonDown'] });
    }
    w.webContents.sendInputEvent({ type: 'mouseUp', x: from.x + dx, y: from.y - 12, button: 'left', clickCount: 1 }); down = false;
    previewInput = { classification: 'OWN_PREVIEW_SEND_INPUT_EVENT', status: 'sent', dx, dy: -12 };
  } catch { previewInput = { classification: 'OWN_PREVIEW_SEND_INPUT_EVENT', status: 'unavailable' }; }
  finally { if (down && !w.isDestroyed()) w.webContents.sendInputEvent({ type: 'mouseUp', x: 1, y: 1, button: 'left', clickCount: 1 }); }
}
function registerPreviewIPC() {
  ipcMain.handle('fu:preview-initial', event => { if (!preview || preview.isDestroyed() || event.sender !== preview.webContents) return null; return { ...previewContext, coverage, qaOnly: runtimeProfile.enabled && !runtimeProfile.interactive }; });
  ipcMain.on('fu:preview-evidence', (event, value) => {
    const diagnosticOnly = runtimeProfile.enabled && !runtimeProfile.interactive;
    if (!preview || preview.isDestroyed() || event.sender !== preview.webContents || performance.now() - previewEvidenceAt < (diagnosticOnly ? 30 : 80)) return;
    const checked = sanitizePreviewEvidence(value);
    if (checked) {
      previewEvidence = checked; previewEvidenceAt = performance.now();
      if (!previewReplayGate.ready && previewReplayGate.readyNow()) preview.webContents.send('fu:preview-command', 'replay');
      if (diagnosticOnly) broadcast();
    }
  });
}
function samePreparedVerification(prepared, verification) {
  const anchor = verificationAnchor(verification);
  return !!anchor && verification.verified === true && verification.sessionId === prepared.sessionId
    && verification.turnId === prepared.turnId && verification.startedAtMs === prepared.verificationStartedAtMs
    && anchor === prepared.verificationAnchor;
}
async function titleForVerifiedEntrance(event, verification) {
  if (verification?.verified !== true) return { value: null, source: 'pending' };
  if (verification.sourceKind === 'codex-paginated-metadata') {
    const title = verification.title;
    return title?.source === 'codex-paginated-name' && typeof title.value === 'string' && title.value.length <= 480 && Array.from(title.value).length <= 240
      ? { value: title.value, source: title.source } : { value: null, source: 'pending' };
  }
  return readChatTitle(event.sessionId);
}
async function acceptEntranceFile(file) {
  const cancellation = entranceCancellation, receivedAt = performance.now(), deadline = receivedAt + 5000;
  recordAdmission('received', null, receivedAt);
  const isActive = () => !quitting && cancellation === entranceCancellation;
  let readReason = 'event-invalid';
  const dataRoot = app.getPath('userData');
  if (diagnosticsFile) intakeShape = { entry: entrancePathShape(file), root: entrancePathShape(dataRoot) };
  const event = await readEntranceFile(file, { dataRoot, onDiagnostic: value => { readReason = value?.reason; } });
  if (!isActive()) return;
  if (!event) { recordAdmission('read-rejected', null, receivedAt, readReason); diagnostic = admissionMessage(readReason); broadcast(); return; }
  if (scheduler.seen.has(event.eventId)) { recordAdmission('verify-rejected', event, receivedAt, 'duplicate'); return; }
  const initialVerification = await verifyEntranceUntil({ verify: () => verifyEntranceTurn(event), deadline, now: () => performance.now(), isActive });
  if (!isActive()) { recordAdmission('verify-rejected', event, receivedAt, 'cancelled'); return; }
  if (!initialVerification.verified) { recordAdmission('verify-rejected', event, receivedAt, initialVerification.reason); diagnostic = admissionMessage(initialVerification.reason); broadcast(); return; }
  const initialAnchor = verificationAnchor(initialVerification);
  if (!initialAnchor) { recordAdmission('verify-rejected', event, receivedAt, 'invalid-source'); diagnostic = admissionMessage('invalid-source'); broadcast(); return; }
  // Only root task_started source time orders independent sessions, never receipt/file completion time.
  if (!scheduler.acceptSource(event.eventId, initialVerification.startedAtMs)) { recordAdmission('verify-rejected', event, receivedAt, 'source-order'); diagnostic = admissionMessage('source-order'); broadcast(); return; }
  const token = scheduler.queue(event, performance.now());
  if (token === null) return;
  const candidateCurrent = () => isActive() && scheduler.isCurrent(token);
  const verification = initialVerification.contextMissing ? await verifyEntranceUntil({ verify: () => verifyEntranceTurn(event), deadline: performance.now() + 750, now: () => performance.now(), isActive: candidateCurrent, waitForContext: true }) : initialVerification;
  if (!candidateCurrent()) return;
  if (!verification.verified) { recordAdmission('verify-rejected', event, receivedAt, verification.reason); return; }
  if (!samePreparedVerification({ sessionId: event.sessionId, turnId: event.turnId, verificationStartedAtMs: initialVerification.startedAtMs, verificationAnchor: initialAnchor }, verification)) {
    recordAdmission('verify-rejected', event, receivedAt, 'source-changed'); diagnostic = admissionMessage('source-changed'); broadcast(); return;
  }
  const title = await titleForVerifiedEntrance(event, verification);
  if (!candidateCurrent() || !scheduler.take(token, performance.now())) return;
  const verified = applyVerifiedReasoning(event, verification);
  recordAdmission('queued', event, receivedAt);
  applyEntrance({ ...verified, source: 'codex-user-prompt-submit', confirmation: 'verified-root-turn', title, layout: independentHookLayout(), presentationMode: 'independent-hook', verifiedEvent: event, verificationStartedAtMs: verification.startedAtMs, verificationAnchor: initialAnchor, verificationOffset: verification.offset ?? null, reasoningEvidence: verification.reasoning, receivedAt });
}
function showReader() {
  readerRequested = true;
  if (!reader || reader.isDestroyed() || !readyWindows.has(reader)) return;
  if (reader.isMinimized()) reader.restore();
  reader.show(); reader.focus(); broadcast();
}
function contextMenu() {
  Menu.buildFromTemplate([
    { label: '展开读符', click: showReader },
    { label: '预览完整动效', click: showMotionPreview },
    { label: '隐藏当前符', click: () => setVisible(false) },
    { label: '在独立示例窗口重播', click: showMotionPreview },
    { label: '锁定另一会话文件…', click: chooseBinding },
    { type: 'separator' }, { label: '退出召唤符', click: () => app.quit() }
  ]).popup();
}
async function bind(file, sessionId) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(sessionId)) throw new Error('invalid binding');
  adapter?.stop(); clock = new HostClock(); bridge = new EnvelopeBridge({ sessionId });
  bound = { file, sessionId }; bindingChanged = true; diagnostic = '正在读取已锁定会话；等待可核验状态。';
  const selected = new RolloutAdapter({ file, sessionId, supportedVersions: SUPPORTED_CLI_VERSIONS, aliases,
    onEnvelope: envelope => { if (adapter !== selected) return; const events = bridge.convert(envelope); if (clock.accept(events, performance.now())) diagnostic = envelope.state === 'unknown' ? '状态未取得，火已暂停。等待新的可信事件。' : ''; broadcast(); },
    onDiagnostic: value => { if (adapter !== selected) return; diagnostic = typeof value?.message === 'string' ? value.message.slice(0, 300) : '适配器状态不可用。'; broadcast(); }
  });
  adapter = selected;
  await selected.start();
  const title = await readChatTitle(sessionId);
  if (adapter !== selected || scheduler.pending) return;
  applyEntrance({ sessionId, turnId: clock.session.runId, eventId: 'manual:' + crypto.randomUUID(), title, metadata: clock.session.metadata || {}, source: 'manual-binding' });
  saveSettings(); broadcast();
}
async function chooseBinding() {
  const selected = await dialog.showOpenDialog(reader, { title: '锁定 Codex rollout 会话（只读）', defaultPath: path.join(os.homedir(), '.codex', 'sessions'), filters: [{ name: 'Codex 会话', extensions: ['jsonl'] }], properties: ['openFile'] });
  if (selected.canceled || !selected.filePaths[0]) return;
  const file = selected.filePaths[0];
  try {
    const fd = fs.openSync(file, 'r'); let text;
    try { const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, b.length, 0); text = b.toString('utf8', 0, n); } finally { fs.closeSync(fd); }
    const first = JSON.parse(text.split('\n')[0]);
    if (first.type !== 'session_meta' || typeof first.payload?.id !== 'string') throw new Error('missing session metadata');
    await bind(file, first.payload.id); setVisible(true);
  } catch { diagnostic = '此文件无法绑定：需要受支持版本的 Codex rollout，且首行含 session_meta。'; broadcast(); }
}
function parseArgs(args = process.argv) { const get = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; }; const entry = parseEntranceArgument(args); const qa = args.filter(arg => typeof arg === 'string' && arg.startsWith('--preview-qa=')); return { file: get('--session-file'), sessionId: get('--session-id'), entranceFile: entry.value, entranceError: entry.error, diagnosticsFile: get('--diagnostics-file'), captureDir: get('--capture-dir'), read: args.includes('--read'), motionPreview: args.includes('--motion-preview'), previewQA: qa.length === 1 ? qa[0].slice('--preview-qa='.length) : null }; }
function rejectEntranceArguments() {
  const now = performance.now(); recordAdmission('received', null, now); recordAdmission('read-rejected', null, now, 'event-arguments-invalid');
  diagnostic = admissionMessage('event-arguments-invalid'); if (pet && reader) broadcast();
}
// Normal operation shares only the fixed product cache with the plugin.
// Explicit preview QA uses a distinct, validated profile before taking its lock.
const runtimeProfile = previewQaProfile(process.argv);
if (runtimeProfile.valid) app.setPath('userData', runtimeProfile.enabled ? runtimeProfile.userData : path.join(app.getPath('appData'), 'summoning-fu-handoff'));
if (!runtimeProfile.valid || !app.requestSingleInstanceLock() || process.argv.includes('--quit')) app.quit();
else {
  app.setName('Summoning Fu');
  app.on('second-instance', (_event, args) => {
    if (runtimeProfile.enabled) {
      if (!samePreviewQaProfile(process.argv, args)) return;
      if (diagnosticsFile) secondInstanceArgvShape = entranceArgvShapes(args);
      const parsed = parseArgs(args);
      if (args.includes('--quit')) app.quit();
      else if (parsed.previewQA) previewQACommand(parsed.previewQA);
      else if (args.includes('--capture')) void captureWindows();
      else if (parsed.motionPreview) showMotionPreview();
      return;
    }
    if (previewQaProfile(args).enabled) return;
    if (diagnosticsFile) secondInstanceArgvShape = entranceArgvShapes(args); if (args.includes('--quit')) { app.quit(); return; } const parsed = parseArgs(args); if (parsed.entranceError) { rejectEntranceArguments(); return; } const entry = parsed.entranceFile; if (entry) { if (!pet || !reader) queuedEntranceFiles.push(entry); else void acceptEntranceFile(entry); return; } if (!pet || !reader) { if (parsed.motionPreview) pendingPreview = true; return; } if (parsed.motionPreview) showMotionPreview(); else if (parsed.previewQA) previewQACommand(parsed.previewQA); else if (args.includes('--hide')) setVisible(false); else if (args.includes('--read')) showReader(); else if (args.includes('--capture')) void captureWindows(); else showReader();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; pendingPresentation = null; presentationGeneration++; sendObserver?.stop(); clearInterval(timer); clearTimeout(pendingTimer); clearTimeout(expiryTimer); scheduler.cancel(); captureTimers.forEach(clearTimeout); adapter?.stop(); saveSettings(); tray?.destroy(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (runtimeProfile.enabled) {
      try { coverage = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/fonts/coverage.json'), 'utf8')); } catch {}
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') && !details.url.startsWith('devtools:') }));
      const args = parseArgs();
      if (args.diagnosticsFile && path.isAbsolute(args.diagnosticsFile)) diagnosticsFile = args.diagnosticsFile;
      if (args.captureDir && path.isAbsolute(args.captureDir)) { try { await fs.promises.mkdir(args.captureDir, { recursive: true }); captureDirectory = args.captureDir; } catch {} }
      observerStatus = 'preview-only'; diagnostic = '独立示例预览：未启动发送观察器，也未读取或绑定会话。';
      registerPreviewIPC(); timer = setInterval(broadcast, runtimeProfile.interactive ? 250 : 100); showMotionPreview(); return;
    }
    settingsPath = path.join(app.getPath('userData'), 'summoning-fu-settings.json'); readSettings();
    try {
      const aliasPath = app.isPackaged ? path.join(path.dirname(process.execPath), 'display-aliases.json') : path.join(__dirname, '../config/display-aliases.json');
      if (fs.statSync(aliasPath).size <= 65536) { const value = JSON.parse(fs.readFileSync(aliasPath, 'utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) aliases = value; }
    } catch {}
    try { coverage = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/fonts/coverage.json'), 'utf8')); } catch {}
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') && !details.url.startsWith('devtools:') }));
    const area = screen.getPrimaryDisplay().workArea;
    const initial = entranceBounds(settings.petPosition, area);
    petAnchor = initial;
    pet = secureWindow({ ...initial, frame: false, thickFrame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000' }, 'pet.html');
    pet.setIgnoreMouseEvents(true, { forward: true });
    reader = secureWindow({ width: 960, height: 760, minWidth: 620, minHeight: 480, title: '召唤符 · 展开读符', backgroundColor: '#171610' }, 'reader.html');
    reader.on('close', event => { if (!quitting) { event.preventDefault(); readerRequested = false; reader.hide(); } });
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, () => { cancelPresentation('geometry-changed'); broadcast(); });
    for (const name of ['move', 'resize']) pet.on(name, () => {
      if (quitting || moving || !displayContext?.layout || !entrance.current || entrance.current.cancelled || entrance.current.expired) return;
      let unchanged = false;
      try { unchanged = !!pet && !pet.isDestroyed() && nativeBoundsMatch(petNativeBounds, displayContext.layout.bounds, pet.getBounds()); } catch {}
      if (!unchanged) {
        petNativeBounds = null; cancelPresentation('geometry-changed');
        try { broadcast(); } catch {}
      }
    });
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 2; y < 30; y++) for (let x = 9; x < 23; x++) { const i = (y * 32 + x) * 4; const ink = (y > 5 && y < 25 && x > 14 && x < 18) || (y === 7 && x > 11 && x < 21); pixels[i] = ink ? 30 : 139; pixels[i + 1] = ink ? 42 : 215; pixels[i + 2] = ink ? 157 : 244; pixels[i + 3] = 255; }
    const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 });
    tray = new Tray(icon); tray.setToolTip('召唤符 · Codex 插件伴随窗口'); tray.on('click', showReader); tray.on('right-click', contextMenu);
    ipcMain.handle('fu:initial', event => { if (!allowedSender(event)) return null; return { snapshot: snapshot(), coverage }; });
    ipcMain.on('fu:renderer-ready', (event, value) => { void rendererReady(event, value); });
    ipcMain.on('fu:renderer-invalidated', (event, value) => {
      if (event.sender !== pet.webContents || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || !['runId', 'token', 'reason'].every(key => Object.hasOwn(value, key))) return;
      if (value.runId !== entrance.current?.id || value.token !== displayContext?.presentationToken || !['target-changed', 'document-hidden', 'geometry-changed', 'pagehide', 'render-failed'].includes(value.reason)) return;
      cancelPresentation(value.reason); broadcast();
    });
    registerPreviewIPC();
    ipcMain.on('fu:render-evidence', (event, value) => { if (!pet || event.sender !== pet.webContents) return; const checked = sanitizeRenderEvidence(value); if (checked && checked.runId === entrance.current?.id) { renderEvidence = checked; void captureVisualStage(checked); } });
    ipcMain.on('fu:action', (event, action) => { if (!allowedSender(event)) return;
      if (action === 'read') showReader(); else if (action === 'motion-preview') showMotionPreview(); else if (action === 'hide') setVisible(false); else if (action === 'show') setVisible(true); else if (action === 'choose') chooseBinding(); else if (action === 'menu') contextMenu(); else if (action === 'quit') app.quit(); else if (action === 'acknowledge' && clock.session.state === 'completed') { setVisible(false); readerRequested = false; reader.hide(); }
    });
    powerMonitor.on('suspend', () => { observerSuspended = true; pendingPresentation = null; presentationGeneration++; sendObserver?.stop(); sendGate.invalidate(); entranceCancellation++; clock.suspend(performance.now()); adapter?.suspend(); scheduler.cancel(); clearTimeout(pendingTimer); if (entrance.current) entrance.cancel(entrance.current.token); diagnostic = '系统睡眠：当前展示已收起，等待新发送事件。'; broadcast(); });
    powerMonitor.on('resume', () => { observerSuspended = false; clock.suspend(performance.now()); adapter?.resume(); sendObserver?.start(); diagnostic = '睡眠恢复：等待新的可信发送控件事件。'; broadcast(); });
    await Promise.all(liveWindows().map(w => new Promise(resolve => { if (!w.webContents.isLoading()) resolve(); else w.webContents.once('did-finish-load', resolve); })));
    timer = setInterval(broadcast, 250);
    const args = parseArgs(); if (args.diagnosticsFile && path.isAbsolute(args.diagnosticsFile)) diagnosticsFile = args.diagnosticsFile;
    if (args.captureDir && path.isAbsolute(args.captureDir)) { try { await fs.promises.mkdir(args.captureDir, { recursive: true }); captureDirectory = args.captureDir; } catch {} }
    const binding = args.entranceFile || args.entranceError || args.motionPreview ? null : args.file ? args : settings.binding;
    const intent = startupIntent(process.argv, Boolean(binding?.file && binding.sessionId));
    setVisible(!intent.hidden);
    if (binding?.file && binding.sessionId) { try { await bind(binding.file, binding.sessionId); } catch { diagnostic = '绑定失败，请在展开读符中重新选择会话文件。'; broadcast(); } }
    if (intent.hidden) setVisible(false);
    if (intent.read && !args.entranceFile && !args.entranceError && !args.motionPreview) showReader();
    if (args.motionPreview || pendingPreview) { pendingPreview = false; showMotionPreview(); }
    if (!args.motionPreview) {
      sendObserver = new SendObserver({ presentationTotalMs: entranceTimings.totalMs, onObservation: acceptUiObservation, onDiagnostic: value => {
        if (quitting || observerSuspended) return;
        observerDiagnostic = sanitizeObserverDiagnostic(value?.diagnostic);
        if (sendDiagnosticInvalidates(value?.reason)) cancelObservedPresentation(value?.reason);
        else { observerStatus = value.reason; if (displayContext?.presentationMode !== 'independent-hook') diagnostic = sendDiagnostic(value.reason, observerDiagnostic); broadcast(); }
      } });
      sendObserver.start();
    }
    if (args.entranceError) rejectEntranceArguments();
    if (args.entranceFile) await acceptEntranceFile(args.entranceFile);
    for (const file of queuedEntranceFiles) await acceptEntranceFile(file); queuedEntranceFiles = [];
    if (captureDirectory) for (const delay of [1000, 31000, 61000, 91000]) captureTimers.push(setTimeout(() => { void captureWindows(); }, delay));
  }).catch(() => { dialog.showErrorBox('召唤符无法启动', '本地桌面组件未就绪。请检查安装包完整性，或运行 npm test 后重新打包。'); app.quit(); });
}
