'use strict';
// The only bridge between a page in the window and the app. Pages get these six functions and nothing else:
// no Node, no file access. The main process checks who is calling before it acts.
const { contextBridge, ipcRenderer } = require('electron');

// Settings changed (from this page or the app itself): tell the page to read them again.
ipcRenderer.on('ld:changed', () => window.dispatchEvent(new Event('laneduel-settings')));

contextBridge.exposeInMainWorld('laneDuelApp', {
  getSettings: () => ipcRenderer.invoke('ld:get'),
  setSettings: partial => ipcRenderer.invoke('ld:set', partial),
  restartApp: () => ipcRenderer.invoke('ld:restart'),
  setFullscreen: mode => ipcRenderer.invoke('ld:fullscreen', mode),
  openExternal: url => ipcRenderer.invoke('ld:external', String(url)),
  backToStart: () => ipcRenderer.invoke('ld:back'),
});
