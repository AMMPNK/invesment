/**
 * System tray with show/hide and quit.
 * Uses a built-in PNG icon (or fallback to template emoji).
 */

'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;

function buildTrayIcon() {
  // 优先使用 resources/tray-icon.png；否则用 emoji 通过 nativeImage 创建
  const candidates = [
    path.join(__dirname, '..', '..', 'resources', 'tray-icon.png'),
    path.join(__dirname, '..', '..', 'resources', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (process.platform === 'darwin') {
        const resized = img.resize({ width: 18, height: 18 });
        resized.setTemplateImage(true);
        return resized;
      }
      return img;
    }
  }
  // 兜底：空白 16×16，避免崩溃
  return nativeImage.createEmpty();
}

function createTray(onToggle, onQuit) {
  if (tray) return tray;
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Focus HUD');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏',
      click: () => onToggle && onToggle(),
    },
    { type: 'separator' },
    {
      label: '关于 Focus HUD',
      click: () => {
        const { dialog } = require('electron');
        dialog.showMessageBox({
          type: 'info',
          title: 'Focus HUD',
          message: 'Focus HUD',
          detail: '版本 ' + app.getVersion() + '\n\n注意力外显器 — 让你的专注被看见。',
          buttons: ['确定'],
        });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        global.__fhud_quitting = true;
        if (onQuit) onQuit();
        else app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => onToggle && onToggle());
  return tray;
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
