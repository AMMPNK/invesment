/**
 * Preload script — runs in renderer with Node access, exposes a curated API
 * via contextBridge to the (sandboxed) renderer.
 *
 * Crucially, we expose `storage.getAllSync` BEFORE the renderer's app.js
 * runs, so the localStorage adapter can hydrate synchronously.
 *
 * Note: Electron preload scripts cannot use `require('electron-store')` directly
 * because that needs the userData path. Instead we just relay to main via IPC.
 *
 * The `getAllSync` is implemented via ipcRenderer.sendSync — slow but only
 * called once at boot.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ---------- storage ----------
const storage = {
  // Synchronous bootstrap fetch. Called once at startup by adapter.js.
  // Uses the (deprecated but still-supported) sendSync to block until main responds.
  getAllSync() {
    try {
      return ipcRenderer.sendSync('storage:getAllSync') || {};
    } catch (e) {
      console.warn('[preload] getAllSync failed', e);
      return {};
    }
  },
  getAll: () => ipcRenderer.invoke('storage:getAll'),
  get: (key) => ipcRenderer.invoke('storage:get', key),
  set: (key, value) => ipcRenderer.invoke('storage:set', key, value),
  delete: (key) => ipcRenderer.invoke('storage:delete', key),
  clear: () => ipcRenderer.invoke('storage:clear'),
};

// ---------- auth ----------
const auth = {
  configured: () => ipcRenderer.invoke('auth:configured'),
  status: () => ipcRenderer.invoke('auth:status'),
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  signup: (email, password) => ipcRenderer.invoke('auth:signup', { email, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
};

// ---------- sync ----------
const sync = {
  markDirty: () => ipcRenderer.invoke('sync:markDirty'),
  pullNow: () => ipcRenderer.invoke('sync:pullNow'),
  pushNow: () => ipcRenderer.invoke('sync:pushNow'),
  status: () => ipcRenderer.invoke('sync:status'),
  onStatus: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on('sync:status', listener);
    return () => ipcRenderer.removeListener('sync:status', listener);
  },
  onDataUpdated: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('sync:dataUpdated', listener);
    return () => ipcRenderer.removeListener('sync:dataUpdated', listener);
  },
};

// ---------- window ----------
const win = {
  hide: () => ipcRenderer.invoke('window:hide'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  openExternal: (url) => ipcRenderer.invoke('window:openExternal', url),
};

const appInfo = {
  version: () => ipcRenderer.invoke('app:version'),
  storePath: () => ipcRenderer.invoke('app:storePath'),
};

contextBridge.exposeInMainWorld('electronAPI', {
  storage, auth, sync, window: win, app: appInfo,
});
