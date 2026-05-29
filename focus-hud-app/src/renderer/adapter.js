/**
 * adapter.js — runs in renderer BEFORE app.js.
 *
 * Strategy (revised for Electron contextIsolation):
 *
 * Problem: In Electron with contextIsolation=true, window.localStorage is
 * a native object that Chromium marks as non-configurable, so
 * Object.defineProperty cannot replace it.
 *
 * Solution: Keep using the native localStorage for synchronous reads/writes
 * (which work fine within the renderer), but ALSO mirror every write to the
 * main process via IPC (electronAPI.storage.set). This gives us:
 *   - Synchronous reads (native localStorage)
 *   - Persistent disk storage (electron-store via IPC)
 *   - Cloud sync trigger (markDirty in main process)
 *
 * On startup: pull all KV from electron-store and pre-populate localStorage
 * so data survives app restarts (Chromium clears localStorage between
 * different dev instances, but in production this is stable).
 *
 * Falls back gracefully if electronAPI is not available.
 */

(function () {
  'use strict';

  if (!window.electronAPI || !window.electronAPI.storage) {
    console.warn('[adapter] electronAPI not available, using native localStorage only');
    return;
  }

  const api = window.electronAPI.storage;

  // ── 1. Startup hydration (SYNCHRONOUS — must complete before app.js runs) ──
  // Pull all KV from electron-store and populate localStorage so data
  // persisted in a previous session is available.
  let storeData = {};
  try {
    storeData = api.getAllSync() || {};
  } catch (e) {
    console.warn('[adapter] getAllSync failed', e);
  }

  const SYNC_KEYS = ['fhud_workspaces', 'fhud_state', 'fhud_journals'];

  // Only hydrate keys that are not already in localStorage
  // (first launch: none; subsequent: all should be in both)
  let hydratedCount = 0;
  for (const key of Object.keys(storeData)) {
    const storeVal = storeData[key];
    if (storeVal == null) continue;
    const v = typeof storeVal === 'string' ? storeVal : JSON.stringify(storeVal);
    // Prefer store over native localStorage (store is more authoritative —
    // it survives Chromium's localStorage cache clears)
    if (SYNC_KEYS.includes(key)) {
      try {
        window.localStorage.setItem(key, v);
        hydratedCount++;
      } catch (e) {
        console.warn('[adapter] hydrate failed for', key, e);
      }
    }
  }
  console.log('[adapter] hydrated', hydratedCount, 'keys from electron-store');

  // ── 2. Mirror writes to electron-store ────────────────────────────────────
  // We patch the prototype methods on Storage to intercept writes.
  // This works because Chromium does allow patching Storage.prototype.
  const origSetItem    = Storage.prototype.setItem;
  const origRemoveItem = Storage.prototype.removeItem;
  const origClear      = Storage.prototype.clear;

  Storage.prototype.setItem = function (key, value) {
    origSetItem.call(this, key, value);
    // Only mirror the focus-hud keys to avoid mirroring Chromium internals
    if (this === window.localStorage && SYNC_KEYS.includes(key)) {
      api.set(key, value).catch(e => console.warn('[adapter] set failed', key, e));
    }
  };

  Storage.prototype.removeItem = function (key) {
    origRemoveItem.call(this, key);
    if (this === window.localStorage && SYNC_KEYS.includes(key)) {
      api.delete(key).catch(e => console.warn('[adapter] delete failed', key, e));
    }
  };

  Storage.prototype.clear = function () {
    origClear.call(this);
    if (this === window.localStorage) {
      api.clear().catch(e => console.warn('[adapter] clear failed', e));
    }
  };

  // ── 3. Sync: reload on cloud pull ─────────────────────────────────────────
  if (window.electronAPI.sync && window.electronAPI.sync.onDataUpdated) {
    window.electronAPI.sync.onDataUpdated(async () => {
      console.log('[adapter] cloud pull complete, rehydrating...');
      try {
        const fresh = await api.getAll() || {};
        for (const key of SYNC_KEYS) {
          const v = fresh[key];
          if (v != null) {
            origSetItem.call(window.localStorage, key,
              typeof v === 'string' ? v : JSON.stringify(v));
          }
        }
        // Reload page to apply new data
        location.reload();
      } catch (e) {
        console.warn('[adapter] rehydration failed', e);
      }
    });
  }

  console.log('[adapter] Storage.prototype patched — writes will mirror to electron-store');
})();
