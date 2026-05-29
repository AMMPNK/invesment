/**
 * IPC handlers for renderer ↔ main bridge.
 *
 * Exposed via preload.js as window.electronAPI:
 *   - storage.getAll / get / set / delete / clear
 *   - auth.login / signup / logout / status
 *   - sync.markDirty / pullNow / status
 *   - window.minimize / hide / openExternal
 */

'use strict';

const { ipcMain, BrowserWindow, shell, app } = require('electron');

function registerIpc(ctx) {
  // ---------- storage ----------
  // 同步版本：preload 用 sendSync 启动时一次性注水
  ipcMain.on('storage:getAllSync', (event) => {
    event.returnValue = ctx.store.getAll();
  });
  ipcMain.handle('storage:getAll', () => ctx.store.getAll());
  ipcMain.handle('storage:get', (_e, key) => ctx.store.get(key));
  ipcMain.handle('storage:set', (_e, key, value) => {
    ctx.store.set(key, value);
    if (ctx.sync) ctx.sync.markDirty();
    return true;
  });
  ipcMain.handle('storage:delete', (_e, key) => { ctx.store.delete(key); return true; });
  ipcMain.handle('storage:clear', () => { ctx.store.clear(); return true; });

  // ---------- auth ----------
  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    return await ctx.auth.login(email, password);
  });
  ipcMain.handle('auth:signup', async (_e, { email, password }) => {
    return await ctx.auth.signup(email, password);
  });
  ipcMain.handle('auth:logout', async () => {
    return await ctx.auth.logout();
  });
  ipcMain.handle('auth:status', () => ({
    loggedIn: ctx.auth.isLoggedIn(),
    user: ctx.auth.getUser(),
  }));
  ipcMain.handle('auth:configured', () => ctx.auth.isConfigured());

  // ---------- sync ----------
  ipcMain.handle('sync:markDirty', () => { ctx.sync.markDirty(); return true; });
  ipcMain.handle('sync:pullNow', () => ctx.sync.pullAll());
  ipcMain.handle('sync:pushNow', () => ctx.sync.pushAll());
  ipcMain.handle('sync:status', () => ctx.sync.getStatus());

  // ---------- window ----------
  ipcMain.handle('window:hide', () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.hide();
  });
  ipcMain.handle('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.minimize();
  });
  ipcMain.handle('window:openExternal', (_e, url) => shell.openExternal(url));

  // ---------- meta ----------
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:storePath', () => ctx.store.path());
}

module.exports = { registerIpc };
