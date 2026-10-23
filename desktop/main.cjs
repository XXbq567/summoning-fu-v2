'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, dialog, powerMonitor, session, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { HostClock, entranceBounds, EntranceScheduler, verifyEntranceUntil, startupIntent, sanitizeRenderEvidence, AdmissionEvidence, admissionMessage, entrancePathShape, entranceArgvShapes, parseEntranceArgument, sanitizeReasoningEvidence, previewCommandAllowed, sanitizePreviewEvidence, desktopSettingsSnapshot, PreviewReplayGate, entranceMotionPolicy } = require('./host-state.cjs');
const { readLastRecordedTarget } = require('./window-target.cjs');
const { EnvelopeBridge } = require('../adapter/envelope.cjs');
const { RolloutAdapter } = require('../adapter/rollout.cjs');
const { readEntranceFile, verifyEntranceTurn, applyVerifiedReasoning, SUPPORTED_CLI_VERSIONS } = require('../adapter/entrance-event.cjs');
const { readChatTitle } = require('../adapter/chat-title.cjs');
const { EntranceTimeline } = require('../renderer/entrance-timeline.js');
const EXPECTED_VERSION = SUPPORTED_CLI_VERSIONS.join(' / ');
let pet, reader, preview, tray, adapter, bridge, clock = new HostClock();
let previewEvidence = null, previewContext = null, previewEvidenceAt = 0, pendingPreview = false;
let previewReplayGate = new PreviewReplayGate();
const entrance = new EntranceTimeline(), scheduler = new EntranceScheduler();
let displayContext = null, pendingTimer = null, expiryTimer = null, expiryKey = '', queuedEntranceFiles = [];
let entranceCancellation = 0;
let petAnchor = null;
let settings = {}, settingsPath, coverage = {}, hidden = false, quitting = false, moving = false, timer;
let diagnostic = '未绑定会话。请选择本机 Codex 会话文件。';
let bound = null, bindingChanged = false;
let aliases = {};
let diagnosticsFile = null, diagnosticTick = 0;
const admissionEvidence = new AdmissionEvidence();
let intakeShape = null;
let secondInstanceArgvShape = null;
function recordAdmission(stage, event, receivedAt, reason = 'none') {
  if (!diagnosticsFile) return;
  admissionEvidence.record(stage, { reason, at: Date.now(), elapsedMs: performance.now() - receivedAt, sessionId: event?.sessionId, turnId: event?.turnId });
}
let captureDirectory = null, captureIndex = 0;
const captureTimers = [], captureStatus = {};
const rendererHealth = {};
const windowLifecycle = {}, readyWindows = new WeakSet();
let readerRequested = false;
let renderEvidence = null;
let visualStages = {};
const liveWindows = () => [pet, reader].filter(w => w && !w.isDestroyed());
const allowedSender = event => liveWindows().some(w => w.webContents === event.sender);
function readSettings() {
  try { const v = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); if (v && typeof v === 'object') settings = v; } catch {}
}
function saveSettings() {
  const actual = petAnchor;
  const value = desktopSettingsSnapshot({ settings, binding: bound, bindingChanged, position: actual });
  try { fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(settingsPath + '.tmp', settingsPath); } catch { diagnostic = '本机设置未能保存；当前显示仍可使用。'; }
}
function motionPolicy() {
  let systemPreference = renderEvidence?.systemReducedMotion ?? null;
  try { systemPreference = systemPreferences.getAnimationSettings().prefersReducedMotion; } catch {}
  return entranceMotionPolicy(systemPreference);
}
function snapshot() {
  const policy = motionPolicy();
  const now = performance.now(), task = clock.snapshot(now), frame = entrance.snapshot(now, policy.effectiveReducedMotion);
  const sameTurn = displayContext && task.sessionId === displayContext.sessionId && task.runId === displayContext.turnId;
  return { ...task, ...frame, runId: frame.id, sessionId: displayContext?.sessionId || null, turnId: displayContext?.turnId || null, source: displayContext?.source || 'unknown', activeMs: frame.elapsedMs,
    ...policy, diagnosticsEnabled: Boolean(diagnosticsFile), state: sameTurn ? task.state : 'unknown', hidden: hidden || !frame.visible, diagnostic,
    binding: displayContext ? { sessionId: displayContext.sessionId, fileName: sameTurn && bound ? path.basename(bound.file) : '入口事件（未绑定当前轮次日志）' } : null,
    adapterLabel: displayContext?.source === 'codex-user-prompt-submit' ? 'Codex 插件 UserPromptSubmit · 发送后约 5 秒 · 非切换监听' : '手动启动/绑定展示 · 不计为自动接入验收',
    expectedVersion: EXPECTED_VERSION, titleSource: displayContext?.title?.source || 'pending', pendingEntrance: Boolean(scheduler.pending), departureTarget: displayContext?.target?.source || 'unavailable-local-fold' };
}
function broadcast() {
  const value = snapshot();
  if (pet && !pet.isDestroyed() && (hidden || !value.visible) && pet.isVisible()) pet.hide();
  if (value.visible) {
    const key = `${value.token}:${value.hideAtMs}`;
    if (key !== expiryKey) { expiryKey = key; clearTimeout(expiryTimer); const token = value.token; expiryTimer = setTimeout(() => { if (entrance.current?.token === token) broadcast(); }, Math.max(1, value.hideAtMs - value.elapsedMs + 1)); }
  }
  for (const w of liveWindows()) if (!w.webContents.isLoading()) w.webContents.send('fu:snapshot', value);
  if (diagnosticsFile && performance.now() - diagnosticTick >= 1000) {
    diagnosticTick = performance.now();
    const evidence = { at: new Date().toISOString(), platform: process.platform, electron: process.versions.electron, sessionId: value.sessionId, runId: value.runId, state: value.state, activeMs: Math.round(value.activeMs), kind: value.kind, elapsedMs: Math.round(value.elapsedMs), token: value.token, phase: value.phase, visible: value.visible, hideAtMs: value.hideAtMs, titleSource: value.titleSource, source: displayContext?.source || 'unknown', turnId: displayContext?.turnId || null, sourceStartedAtMs: displayContext?.verificationStartedAtMs || null, sourceOffset: displayContext?.verificationOffset ?? null, pendingEntrance: value.pendingEntrance, departureTarget: value.departureTarget, metadataHash: crypto.createHash('sha256').update(JSON.stringify(value.metadata)).digest('hex'), rendererHealth, windowLifecycle, renderEvidence, captureStatus,
      windows: liveWindows().map((w, index) => ({ index, visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), bounds: w.getBounds() })), displays: screen.getAllDisplays().map(d => ({ id: d.id, scaleFactor: d.scaleFactor, workArea: d.workArea })) };
    evidence.admission = admissionEvidence.snapshot();
    evidence.reasoning = sanitizeReasoningEvidence(displayContext?.reasoningEvidence);
    evidence.systemReducedMotion = value.systemReducedMotion;
    evidence.effectiveReducedMotion = value.effectiveReducedMotion;
    evidence.visualStages = visualStages;
    evidence.preview = { open: Boolean(preview && !preview.isDestroyed()), visible: Boolean(preview && !preview.isDestroyed() && preview.isVisible()), source: previewContext?.source || null, evidence: previewEvidence };
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
    try { const captured = await w.webContents.capturePage(); const fileName = `${prefix}-${name}.png`; await fs.promises.writeFile(path.join(captureDirectory, fileName), captured.toPNG(), { flag: 'wx', mode: 0o600 }); captureStatus[name] = fileName; }
    catch { captureStatus[name] = 'capture-unavailable'; }
  }
}
async function captureVisualStage(evidence) {
  if (!diagnosticsFile || !captureDirectory || !pet || pet.isDestroyed() || !pet.isVisible() || evidence.documentHidden) return;
  const f = evidence.frame, phase = f.phase;
  if (!['paper', 'writing', 'hold', 'leaving'].includes(phase) || visualStages[phase]) return;
  if (phase === 'paper' && !(f.paperOpacity >= 0.2 && f.paperOpacity <= 0.8 && f.visibleGlyphs === 0)) return;
  if (phase === 'writing' && !(f.writing >= 0.25 && f.writing <= 0.75 && f.visibleGlyphs > 0 && f.visibleGlyphs < f.totalGlyphs)) return;
  if (phase === 'hold' && !(f.writing === 1 && f.visibleGlyphs === f.totalGlyphs)) return;
  if (phase === 'leaving' && !(f.opacity >= 0.3 && f.opacity <= 0.7)) return;
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
  if (moving || !pet || pet.isDestroyed()) return;
  moving = true;
  const cb = petAnchor || pet.getBounds(), area = screen.getDisplayMatching(cb).workArea;
  petAnchor = entranceBounds({ x: cb.x, y: cb.y }, area); pet.setBounds(petAnchor);
  moving = false;
}
function setVisible(value) { hidden = !value; if (!value) { scheduler.cancel(); clearTimeout(pendingTimer); entranceCancellation++; } if (value && entrance.snapshot(performance.now(), motionPolicy().effectiveReducedMotion).visible) { reposition(); pet.showInactive(); } else pet.hide(); broadcast(); }
function applyEntrance(context) {
  if (bound && bound.sessionId !== context.sessionId) { adapter?.stop(); adapter = null; bound = null; bindingChanged = true; clock = new HostClock(); }
  const title = context.title || { value: null, source: 'pending' };
  const metadata = { ...(context.metadata || {}), sources: { ...(context.metadata?.sources || context.provenance || {}) }, presentation: { mode: 'entrance', sessionId: context.sessionId, chatTitle: { value: title.value, source: title.source === 'codex-session-index' ? 'reported' : 'unknown' } } };
  // Prompt bodies are never presentation content, even for manual rollout binding.
  metadata.task = title.value; metadata.fullTask = title.value; metadata.fullTaskTruncated = false; metadata.sources.task = title.value ? 'reported' : 'unknown';
  displayContext = { ...context, title, metadata }; renderEvidence = null; visualStages = {};
  entrance.trigger(context.eventId, performance.now(), metadata); hidden = false;
  diagnostic = '外部伴随窗口：正常入口播放完整动效，纸先显现、字序写入，完整展示 10 秒后轻收符淡出。不修改 Windows 动画设置。';
  reposition(); pet.showInactive(); broadcast();
}
function showMotionPreview() {
  if (preview && !preview.isDestroyed()) { if (preview.isMinimized()) preview.restore(); preview.show(); preview.focus(); if (previewReplayGate.request()) preview.webContents.send('fu:preview-command', 'replay'); return; }
  const sample = { relay: '本地示例', company: '原创示例', model: '示例模型', harness: 'Codex', environment: '本机预览', reasoning: 'xhigh', sources: Object.fromEntries(['relay', 'company', 'model', 'harness', 'environment', 'reasoning', 'task'].map(field => [field, 'demo'])), presentation: { mode: 'entrance', sessionId: 'local-preview-example', chatTitle: { value: '本地示例 · 观纸落墨', source: 'manual' } } };
  previewContext = { source: displayContext?.metadata ? 'frozen-current' : 'example', metadata: JSON.parse(JSON.stringify(displayContext?.metadata || sample)) };
  previewEvidence = null; previewEvidenceAt = 0; previewReplayGate = new PreviewReplayGate();
  preview = secureWindow({ width: 1080, height: 880, minWidth: 780, minHeight: 650, title: '召唤符 · 完整动效预览', backgroundColor: '#171610' }, 'motion-preview.html');
  const opened = preview;
  opened.once('ready-to-show', () => { if (!opened.isDestroyed()) { opened.show(); opened.focus(); } });
  opened.on('closed', () => { if (preview === opened) preview = null; });
}
function previewQACommand(command) {
  if (!diagnosticsFile || !captureDirectory || !preview || preview.isDestroyed()) return;
  if (command === 'hide') preview.hide();
  else if (command === 'show') { preview.show(); preview.focus(); }
  else if (command === 'close') preview.close();
  else if (previewCommandAllowed(command)) preview.webContents.send('fu:preview-command', command);
}
async function acceptEntranceFile(file) {
  const cancellation = entranceCancellation, receivedAt = performance.now(), dueAt = receivedAt + 5000;
  recordAdmission('received', null, receivedAt);
  const isActive = () => !quitting && cancellation === entranceCancellation;
  let readReason = 'event-invalid';
  const dataRoot = app.getPath('userData');
  if (diagnosticsFile) intakeShape = { entry: entrancePathShape(file), root: entrancePathShape(dataRoot) };
  const event = await readEntranceFile(file, { dataRoot, onDiagnostic: value => { readReason = value?.reason; } });
  if (!isActive()) return;
  if (!event) { recordAdmission('read-rejected', null, receivedAt, readReason); diagnostic = admissionMessage(readReason); broadcast(); return; }
  if (scheduler.seen.has(event.eventId)) { recordAdmission('verify-rejected', event, receivedAt, 'duplicate'); return; }
  const initialVerification = await verifyEntranceUntil({ verify: () => verifyEntranceTurn(event), deadline: dueAt, now: () => performance.now(), isActive });
  if (!isActive()) { recordAdmission('verify-rejected', event, receivedAt, 'cancelled'); return; }
  if (!initialVerification.verified) { recordAdmission('verify-rejected', event, receivedAt, initialVerification.reason); diagnostic = admissionMessage(initialVerification.reason); broadcast(); return; }
  // Only root task_started source time orders independent sessions, never receipt/file completion time.
  if (!scheduler.acceptSource(event.eventId, initialVerification.startedAtMs)) { recordAdmission('verify-rejected', event, receivedAt, 'source-order'); diagnostic = admissionMessage('source-order'); broadcast(); return; }
  const token = scheduler.queue(event, receivedAt); if (token === null) return;
  recordAdmission('queued', event, receivedAt);
  clearTimeout(pendingTimer);
  if (entrance.current) entrance.cancel(entrance.current.token);
  diagnostic = '已收到发送事件，约 5 秒后显示召唤符。'; broadcast();
  pendingTimer = setTimeout(async () => {
    const selected = scheduler.take(token, performance.now()); if (!selected) return;
    try {
      const verified = await verifyEntranceUntil({ verify: () => verifyEntranceTurn(selected), deadline: dueAt + 750, now: () => performance.now(), isActive: () => isActive() && scheduler.isCurrent(token), waitForContext: true });
      if (!scheduler.isCurrent(token)) return;
      if (!verified.verified) { recordAdmission('verify-rejected', selected, receivedAt, verified.reason); diagnostic = admissionMessage(verified.reason); broadcast(); return; }
      if (!scheduler.acceptSource(selected.eventId, verified.startedAtMs)) { recordAdmission('verify-rejected', selected, receivedAt, 'source-order'); diagnostic = admissionMessage('source-order'); broadcast(); return; }
      const title = await readChatTitle(selected.sessionId);
      const target = await readLastRecordedTarget(screen.getAllDisplays().map(display => display.workArea));
      if (!scheduler.isCurrent(token)) return;
      const enriched = applyVerifiedReasoning(selected, verified);
      const reasoningEvidence = sanitizeReasoningEvidence({ value: enriched.metadata.reasoning, source: enriched.provenance.reasoning, contextOffset: verified.reasoning?.contextOffset });
      applyEntrance({ ...enriched, title, target, reasoningEvidence, source: 'codex-user-prompt-submit', verificationOffset: verified.offset, verificationStartedAtMs: verified.startedAtMs });
      recordAdmission('applied', selected, receivedAt);
    } catch { if (scheduler.isCurrent(token)) { recordAdmission('verify-rejected', selected, receivedAt, 'verification-failed'); diagnostic = admissionMessage('verification-failed'); broadcast(); } }
  }, Math.max(1, dueAt - performance.now() + 1));
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
    { label: '重播当前符（调试）', enabled: Boolean(displayContext), click: () => { if (displayContext) { scheduler.cancel(); clearTimeout(pendingTimer); applyEntrance({ ...displayContext, eventId: 'debug:' + crypto.randomUUID(), source: 'manual-debug' }); } } },
    { label: '锁定另一会话文件…', click: chooseBinding },
    { label: '移至当前屏幕右下角', click: () => { const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; petAnchor = entranceBounds(null, a); pet.setBounds(petAnchor); saveSettings(); } },
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
  const target = await readLastRecordedTarget(screen.getAllDisplays().map(display => display.workArea));
  if (adapter !== selected || scheduler.pending) return;
  applyEntrance({ sessionId, turnId: clock.session.runId, eventId: 'manual:' + crypto.randomUUID(), title, target, metadata: clock.session.metadata || {}, source: 'manual-binding' });
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
// A fixed product cache is shared with the plugin; no arbitrary CLI data root is trusted.
app.setPath('userData', path.join(app.getPath('appData'), 'summoning-fu-handoff'));
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) app.quit();
else {
  app.setName('Summoning Fu');
  app.on('second-instance', (_event, args) => { if (diagnosticsFile) secondInstanceArgvShape = entranceArgvShapes(args); if (args.includes('--quit')) { app.quit(); return; } const parsed = parseArgs(args); if (parsed.entranceError) { rejectEntranceArguments(); return; } const entry = parsed.entranceFile; if (entry) { if (!pet || !reader) queuedEntranceFiles.push(entry); else void acceptEntranceFile(entry); return; } if (!pet || !reader) { if (parsed.motionPreview) pendingPreview = true; return; } if (parsed.motionPreview) showMotionPreview(); else if (parsed.previewQA) previewQACommand(parsed.previewQA); else if (args.includes('--hide')) setVisible(false); else if (args.includes('--read')) showReader(); else if (args.includes('--capture')) void captureWindows(); else showReader(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearInterval(timer); clearTimeout(pendingTimer); clearTimeout(expiryTimer); scheduler.cancel(); captureTimers.forEach(clearTimeout); adapter?.stop(); saveSettings(); tray?.destroy(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
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
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, reposition);
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 2; y < 30; y++) for (let x = 9; x < 23; x++) { const i = (y * 32 + x) * 4; const ink = (y > 5 && y < 25 && x > 14 && x < 18) || (y === 7 && x > 11 && x < 21); pixels[i] = ink ? 30 : 139; pixels[i + 1] = ink ? 42 : 215; pixels[i + 2] = ink ? 157 : 244; pixels[i + 3] = 255; }
    const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 });
    tray = new Tray(icon); tray.setToolTip('召唤符 · Codex 插件伴随窗口'); tray.on('click', showReader); tray.on('right-click', contextMenu);
    ipcMain.handle('fu:initial', event => { if (!allowedSender(event)) return null; return { snapshot: snapshot(), coverage }; });
    ipcMain.handle('fu:preview-initial', event => { if (!preview || preview.isDestroyed() || event.sender !== preview.webContents) return null; return { ...previewContext, coverage }; });
    ipcMain.on('fu:preview-evidence', (event, value) => { if (!preview || preview.isDestroyed() || event.sender !== preview.webContents || performance.now() - previewEvidenceAt < 80) return; const checked = sanitizePreviewEvidence(value); if (checked) { previewEvidence = checked; previewEvidenceAt = performance.now(); if (!previewReplayGate.ready && previewReplayGate.readyNow()) preview.webContents.send('fu:preview-command', 'replay'); } });
    ipcMain.on('fu:render-evidence', (event, value) => { if (!pet || event.sender !== pet.webContents) return; const checked = sanitizeRenderEvidence(value); if (checked && checked.runId === entrance.current?.id) { renderEvidence = checked; void captureVisualStage(checked); } });
    ipcMain.on('fu:action', (event, action) => { if (!allowedSender(event)) return;
      if (action === 'read') showReader(); else if (action === 'motion-preview') showMotionPreview(); else if (action === 'hide') setVisible(false); else if (action === 'show') setVisible(true); else if (action === 'choose') chooseBinding(); else if (action === 'menu') contextMenu(); else if (action === 'quit') app.quit(); else if (action === 'acknowledge' && clock.session.state === 'completed') { setVisible(false); readerRequested = false; reader.hide(); }
    });
    powerMonitor.on('suspend', () => { entranceCancellation++; clock.suspend(performance.now()); adapter?.suspend(); scheduler.cancel(); clearTimeout(pendingTimer); if (entrance.current) entrance.cancel(entrance.current.token); diagnostic = '系统睡眠：当前展示已收起，等待新发送事件。'; broadcast(); });
    powerMonitor.on('resume', () => { clock.suspend(performance.now()); adapter?.resume(); diagnostic = '睡眠恢复：等待新的可信会话事件。'; broadcast(); });
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
    if (args.entranceError) rejectEntranceArguments();
    if (args.entranceFile) await acceptEntranceFile(args.entranceFile);
    for (const file of queuedEntranceFiles) await acceptEntranceFile(file); queuedEntranceFiles = [];
    if (captureDirectory) for (const delay of [1000, 31000, 61000, 91000]) captureTimers.push(setTimeout(() => { void captureWindows(); }, delay));
  }).catch(() => { dialog.showErrorBox('召唤符无法启动', '本地桌面组件未就绪。请检查安装包完整性，或运行 npm test 后重新打包。'); app.quit(); });
}
