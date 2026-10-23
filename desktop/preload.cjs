'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['read', 'hide', 'show', 'choose', 'menu', 'acknowledge', 'quit', 'motion-preview']);
contextBridge.exposeInMainWorld('fuHost', Object.freeze({
  initial: () => ipcRenderer.invoke('fu:initial'),
  action: action => { if (actions.has(action)) ipcRenderer.send('fu:action', action); },
  reportRender: value => ipcRenderer.send('fu:render-evidence', value),
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
    const allowed = new Set(['replay', 'pause', 'resume', 'stop', 'paper', 'writing', 'seal', 'hold', 'leaving']);
    const handler = (_event, value) => { if (allowed.has(value)) listener(value); };
    ipcRenderer.on('fu:preview-command', handler);
    return () => ipcRenderer.removeListener('fu:preview-command', handler);
  }
}));
