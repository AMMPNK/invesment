/**
 * Main BrowserWindow factory.
 *
 * The window is transparent, frameless, always on top, and docks
 * to the bottom-right of the primary display by default.
 *
 * Key design decisions:
 * - transparent + no frame: lets the HUD CSS handle all visuals
 * - alwaysOnTop 'screen-saver' level: beats most other apps including IDEs
 * - vibrancy DISABLED by default: vibrancy + transparent can render fully
 *   invisible on some macOS builds; re-enable once confirmed stable
 * - show:false + ready-to-show + focus(): guarantees the window is visible
 */

'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const HUD_WIDTH  = 380;
const HUD_HEIGHT = 760;
const HUD_MARGIN = 16;

let mainWindow = null;

function getMainWindow() { return mainWindow; }

function createMainWindow({ isDev = false } = {}) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const { x: workX, y: workY } = display.workArea;

  const winX = workX + width  - HUD_WIDTH  - HUD_MARGIN;
  const winY = workY + height - HUD_HEIGHT - HUD_MARGIN;

  mainWindow = new BrowserWindow({
    width:  HUD_WIDTH,
    height: HUD_HEIGHT,
    x: winX,
    y: winY,
    minWidth:  300,
    minHeight: 480,
    frame:       false,
    transparent: true,
    // Don't set backgroundColor when transparent=true; it conflicts
    hasShadow:   false,
    alwaysOnTop: true,
    resizable:   true,
    movable:     true,
    skipTaskbar: false,
    show:        false,
    titleBarStyle: 'hidden',
    // vibrancy intentionally OFF — causes invisible renders on some macOS versions.
    // The CSS glass effect (rgba background + backdrop-filter) handles aesthetics.
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      webSecurity:      true,
      spellcheck:       false,
    },
  });

  // Use 'screen-saver' to float above full-screen apps and most IDEs.
  // 'floating' (NSFloatingWindowLevel) is below 'screen-saver' but sufficient
  // for normal usage; 'screen-saver' is the highest level available.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Show on all macOS Spaces / Mission Control desktops
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  if (isDev) {
    // Open DevTools detached so they don't mess up HUD size
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Prevent window close (red X / Cmd+W) — hide to tray instead.
  // The app only truly quits when __fhud_quitting is set via tray menu.
  mainWindow.on('close', (e) => {
    if (!global.__fhud_quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow };
