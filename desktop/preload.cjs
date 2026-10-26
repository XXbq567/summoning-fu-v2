'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['read', 'hide', 'show', 'choose', 'menu', 'acknowledge', 'quit', 'motion-preview']);
contextBridge.exposeInMainWorld('fuHost', Object.freeze({
  initial: () => ipcRenderer.invoke('fu:initial'),
  action: action => { if (actions.has(action)) ipcRenderer.send('fu:action', action); },
  reportRender: value => ipcRenderer.send('fu:render-evidence', value),
  reportReady: value => ipcRenderer.send('fu:renderer-ready', value),
  reportInvalidation: value => {
    if (value && ['target-changed', 'document-hidden', 'geometry-changed', 'pagehide', 'render-failed'].includes(value.reason)) ipcRenderer.send('fu:renderer-invalidated', value);
  },
  subscribeNativeHidden: listener => {
    if (typeof listener !== 'function') return;
    const handler = () => listener(); ipcRenderer.on('fu:window-hidden', handler);
    return () => ipcRenderer.removeListener('fu:window-hidden', handler);
  },
  subscribe: listener => {
    if (typeof listener !== 'function') return;
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('fu:snapshot', handler);
    return () => ipcRenderer.removeListener('fu:snapshot', handler);
  }
}));
contextBridge.exposeInMainWorld('fuPreview', Object.freeze({
  initial: () => ipcRenderer.invoke('fu:preview-initial'),
  report: value => ipcRenderer.send('fu:preview-evidence', value),
  subscribe: listener => {
    if (typeof listener !== 'function') return;
    const allowed = new Set(['replay', 'pause', 'resume', 'stop', 'point', 'travel', 'unfold', 'paper', 'writing', 'seal', 'hold', 'folding', 'rolling-start', 'rolling', 'rolled', 'rotating', 'flying', 'staging', 'intake', 'intake-tip', 'intake-tail', 'target-near', 'target-far', 'target-left', 'target-right', 'target-move', 'target-hide', 'target-expire', 'window-hidden', 'qa-target-drag-arm', 'speed-0.25', 'speed-0.5', 'speed-1', 'fixture-a', 'fixture-b', 'fixture-race', 'seal-brand', 'seal-generic', 'seal-receipt', 'seal-exit', 'bg-dark', 'bg-light', 'layout-compact', 'layout-wide', 'geometry-resize']);
    const handler = (_event, value) => { if (allowed.has(value)) listener(value); };
    ipcRenderer.on('fu:preview-command', handler);
    return () => ipcRenderer.removeListener('fu:preview-command', handler);
  }
}));
