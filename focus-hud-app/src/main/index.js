/**
 * Main entry point for Focus HUD Electron app.
 *
 * Responsibilities:
 *  - Bootstrap Electron app lifecycle.
 *  - Create main BrowserWindow (transparent, always-on-top, bottom-right).
 *  - Register tray, global shortcut, IPC.
 *  - Wire up sync engine.
 */

'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');

const { createMainWindow, getMainWindow } = require('./window');
const { createTray, destroyTray } = require('./tray');
const { Store } = require('./store');
const { registerIpc } = require('./ipc');
const SyncEngine = require('./sync/sync-engine');
const Auth = require('./sync/auth');

const isDev = process.argv.includes('--fhud-dev') || process.env.FHUD_DEV === '1';

// 单实例锁：避免重复打开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// macOS 透明窗口需要禁用硬件加速 (某些场景)
// 用户报告时再启用，目前不开
// app.disableHardwareAcceleration();

// 状态容器：在 ipc.js 中使用
const ctx = {
  store: null,
  auth: null,
  sync: null,
  isQuitting: false,
};

app.whenReady().then(async () => {
  ctx.store = new Store();
  await ctx.store.init();

  // 写入 supabase.json 模板（首次启动时，让用户知道在哪里配置）
  const { writeUserConfigTemplate } = require('./sync/supabase-client');
  try { writeUserConfigTemplate(); } catch (_) {}

  ctx.auth = new Auth(ctx.store);
  ctx.sync = new SyncEngine({
    store: ctx.store,
    auth: ctx.auth,
    onStatus: (status) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('sync:status', status);
      }
    },
  });

  registerIpc(ctx);

  const win = createMainWindow({ isDev });
  createTray(() => {
    const w = getMainWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isVisible()) w.hide();
    else { w.show(); w.focus(); }
  }, () => {
    ctx.isQuitting = true;
    app.quit();
  });

  // 全局快捷键
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    const w = getMainWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isVisible() && w.isFocused()) w.hide();
    else { w.show(); w.focus(); }
  });

  // 启动后尝试 pull
  await ctx.auth.tryRestoreSession().catch(() => {});
  if (ctx.auth.isLoggedIn()) {
    ctx.sync.pullAll().catch((e) => console.warn('[main] initial pull failed', e));
  }

  // macOS dock 行为
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ isDev });
    } else {
      const w = getMainWindow();
      if (w) { w.show(); w.focus(); }
    }
  });
});

app.on('window-all-closed', () => {
  // macOS 上保留进程在 dock；但因为我们想常驻托盘，这里不退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  ctx.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyTray();
});
