'use strict';
// This local preview never loads the product main, sessions, hooks or send observer.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { materialCommand } = require('./roll-preview.js');
const root = path.resolve(__dirname, '..');
const actions = new Set(['replay', 'pause', 'resume', 'stop', 'speed-1', 'speed-0.5', 'texture-bands', 'texture-talisman', 'flat', 'start', 'half', 'closing', 'rolled', 'fixture-a', 'fixture-b', 'seek', 'capture', 'hide', 'show', 'quit', 'material-inspect', 'material-natural']);
function validateCommand(value) {
  if (!value || value.type !== 'roll-preview:command' || !actions.has(value.action)) return null;
  const requestId = typeof value.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId) ? value.requestId : null;
  if (!requestId) return null;
  if (value.action === 'material-inspect') {
    const { type, requestId: _requestId, ...fields } = value;
    const command = materialCommand(fields); return command ? { requestId, ...command } : null;
  }
  if (value.action === 'material-natural' && Object.keys(value).some(key => !['type', 'requestId', 'action'].includes(key))) return null;
  if (value.action === 'seek' && (!Number.isFinite(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > 850)) return null;
  return { requestId, action: value.action, ...(value.action === 'seek' ? { elapsedMs: value.elapsedMs } : {}) };
}
function withinQA(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  const target = path.resolve(value), relative = path.relative(path.join(root, 'qa'), target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? target : null;
}
function safeEvidence(value) {
  const clean = (input, depth = 0) => {
    if (depth > 8) return null;
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'string') return input.slice(0, 1024);
    if (Array.isArray(input)) return input.slice(0, 200).map(x => clean(x, depth + 1));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).slice(0, 100).filter(([key]) => /^[a-zA-Z0-9_-]{1,80}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, data]) => [key, clean(data, depth + 1)]));
    return null;
  };
  if (!value || typeof value !== 'object') return null;
  const result = clean(value); return Buffer.byteLength(JSON.stringify(result)) <= 65536 ? result : null;
}
function syntheticMetadata() {
  return { relay: '万象有序', company: '示例印', model: '示例模型', task: '检查卷纸方向与纸面连续性', harness: '本地预览', environment: '固定镜头', reasoning: 'high',
    sources: { relay: 'demo', company: 'demo', model: 'demo', task: 'demo', harness: 'demo', environment: 'demo', reasoning: 'demo' },
    presentation: { mode: 'entrance', sessionId: 'roll-preview-local-example', chatTitle: { value: '检查卷纸方向', source: 'demo' } } };
}
function registerNativeLifecycle(win) {
  // With backgroundThrottling disabled Chromium may retain document.visibility
  // as "visible" after a native hide. Native window events own cancellation.
  for (const event of ['hide', 'minimize']) win.on(event, () => {
    if (!win.isDestroyed()) win.webContents.send('roll-preview:command', { action: 'window-hidden' });
  });
}
async function start(args = process.argv.slice(2)) {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  const option = key => { const index = args.indexOf(key); return index < 0 ? null : args[index + 1]; };
  const qaOnly = args.includes('--qa-roll-preview');
  const output = qaOnly ? withinQA(option('--qa-output')) : null;
  if (qaOnly && (!output || !process.send)) throw Error('isolated-qa-output-and-parent-required');
  const suppliedProfile = args.find(value => value.startsWith('--user-data-dir='))?.slice(16);
  const profile = suppliedProfile ? withinQA(suppliedProfile) : path.join(root, 'qa', 'roll-local', 'profile-' + crypto.randomBytes(8).toString('hex'));
  if (!profile) throw Error('isolated-project-qa-profile-required');
  app.setPath('userData', profile);
  await app.whenReady();
  const bounds = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({ width: Math.min(1280, bounds.width), height: Math.min(1000, bounds.height), minWidth: 840, minHeight: 620,
    show: false, title: '召唤符 · 卷纸检查', backgroundColor: '#181916', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'roll-preview-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
  registerNativeLifecycle(win);
  let evidence = null, captureId = 0;
  const send = value => { if (qaOnly && process.connected) process.send(value); };
  const environment = { platform: process.platform, electron: process.versions.electron, chrome: process.versions.chrome, screen: screen.getAllDisplays().map(display => ({ bounds: display.bounds, scaleFactor: display.scaleFactor })), profile: 'isolated-project-qa-only' };
  const publish = () => { if (!win.isDestroyed() && evidence) send({ type: 'roll-preview:evidence', state: evidence, at: new Date().toISOString(), window: { visible: win.isVisible(), focused: win.isFocused(), bounds: win.getBounds() }, environment }); };
  const owns = event => !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  ipcMain.handle('roll-preview:initial', event => owns(event) ? { qaOnly, metadata: syntheticMetadata() } : null);
  ipcMain.on('roll-preview:evidence', (event, value) => { if (owns(event)) { const clean = safeEvidence(value); if (clean) { evidence = clean; publish(); } } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let permitted = false;
    try { if (details.url.startsWith('file:')) { const relative = path.relative(root, fileURLToPath(details.url)); permitted = !relative.startsWith('..') && !path.isAbsolute(relative); } else permitted = /^(data|blob):/.test(details.url); } catch {}
    callback({ cancel: !permitted });
  });
  async function capture() {
    fs.mkdirSync(path.join(output, 'captures'), { recursive: true, mode: 0o700 });
    const name = String(++captureId).padStart(3, '0') + '-' + (evidence?.textureMode || 'unknown') + '-' + (evidence?.phase || 'unknown');
    const file = path.join(output, 'captures', name + '.png');
    const image = await win.webContents.capturePage(); fs.writeFileSync(file, image.toPNG(), { mode: 0o600 });
    let canvasFile = null, nonZeroAlphaPixels = null, canvasPixels = 0, bitmapFile = null, width = 0, height = 0;
    const g = evidence?.geometry;
    if (g && [g.x, g.y, g.width, g.height].every(Number.isFinite) && g.width > 0 && g.height > 0) {
      // The stage has a painted background. Window capture alpha cannot establish
      // whether a transparent GPU canvas itself was cleared; report that limit.
      const area = { x: Math.max(0, Math.floor(g.x)), y: Math.max(0, Math.floor(g.y)), width: Math.ceil(g.width), height: Math.ceil(g.height) };
      const canvas = await win.webContents.capturePage(area); canvasFile = path.join(output, 'captures', name + '-stage.png');
      fs.writeFileSync(canvasFile, canvas.toPNG(), { mode: 0o600 });
      ({ width, height } = canvas.getSize()); canvasPixels = width * height;
      const bitmap = canvas.toBitmap();
      if (bitmap.length !== canvasPixels * 4 || bitmap.length > 32 * 1024 * 1024) throw Error('stage-bitmap-size-mismatch');
      bitmapFile = path.join(output, 'captures', name + '-stage.bgra'); fs.writeFileSync(bitmapFile, bitmap, { mode: 0o600 });
    }
    return { file, canvasFile, bitmapFile, width, height, channelOrder: 'BGRA', nonZeroAlphaPixels, canvasPixels, alphaClassification: 'PAINTED_STAGE_CAPTURE_NOT_GPU_ALPHA_PROOF' };
  }
  process.on('message', async raw => {
    if (!qaOnly || win.isDestroyed()) return;
    const command = validateCommand(raw); if (!command) return;
    try {
      let extra = {};
      if (command.action === 'capture') extra.capture = await capture();
      else if (command.action === 'hide') win.hide();
      else if (command.action === 'show') win.showInactive();
      else if (command.action === 'quit') { send({ type: 'roll-preview:ack', requestId: command.requestId, ok: true }); app.quit(); return; }
      else { const { requestId: _requestId, ...payload } = command; win.webContents.send('roll-preview:command', payload); }
      send({ type: 'roll-preview:ack', requestId: command.requestId, ok: true, ...extra }); publish();
    } catch { send({ type: 'roll-preview:ack', requestId: command.requestId, ok: false, error: 'fixed-preview-command-failed' }); }
  });
  if (qaOnly) process.on('disconnect', () => app.quit());
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => app.quit());
  await win.loadFile(path.join(__dirname, 'roll-preview.html'));
  app.on('window-all-closed', () => app.quit());
}
function shouldStartEntry({ electron, argv, isMain }) {
  return !!electron && (isMain || argv.includes('--qa-roll-preview') || argv.includes('--roll-preview-only'));
}
// Electron's default-app loader does not reliably assign require.main. Only
// this entry's explicit local modes may launch it when that identity is absent.
if (shouldStartEntry({ electron: process.versions.electron, argv: process.argv, isMain: require.main === module })) start().catch(error => { process.stderr.write('Roll preview: ' + error.message + '\n'); process.exitCode = 1; require('electron').app.quit(); });
module.exports = { start, validateCommand, withinQA, safeEvidence, syntheticMetadata, shouldStartEntry, registerNativeLifecycle };
