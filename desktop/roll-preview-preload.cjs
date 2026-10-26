'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const channel = 'roll-preview:';
const listeners = new Set();
ipcRenderer.on(channel + 'command', (_event, command) => { for (const callback of listeners) callback(command); });
contextBridge.exposeInMainWorld('rollPreview', Object.freeze({
  initial: () => ipcRenderer.invoke(channel + 'initial'),
  subscribe(callback) { if (typeof callback !== 'function') return; listeners.add(callback); },
  report(state) { if (!state || typeof state !== 'object') return; ipcRenderer.send(channel + 'evidence', state); }
}));
