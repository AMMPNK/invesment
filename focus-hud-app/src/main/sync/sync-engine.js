/**
 * Sync engine.
 *
 * Strategy: last-write-wins by `updated_at`.
 *  - On startup (after auth): pullAll() — replace local with cloud if cloud newer.
 *  - On any local change: markDirty() — debounced 3s push.
 *  - pushAll: upsert workspaces (one row per ws_key) and journals (one row per journal id).
 *
 * Local data shape (all keys stored in the renderer's localStorage,
 * which is mirrored to electron-store via the IPC adapter):
 *   - 'fhud_workspaces': { work: {...}, life: {...} }   (JSON string)
 *   - 'fhud_state': { ... }                             (JSON string, not synced — UI-only)
 *   - 'fhud_journals': [ {...}, ... ]                   (JSON string)
 *
 * NOTE: state is intentionally NOT synced — it's UI-only and per-device.
 */

'use strict';

const { getClient, isConfigured } = require('./supabase-client');

const PUSH_DEBOUNCE_MS = 3000;

class SyncEngine {
  /**
   * @param {object} opts
   * @param {object} opts.store    main process Store instance
   * @param {object} opts.auth     Auth instance
   * @param {(s: object) => void} opts.onStatus  status broadcast callback
   */
  constructor({ store, auth, onStatus }) {
    this.store = store;
    this.auth = auth;
    this.onStatus = onStatus || (() => {});
    this._pushTimer = null;
    this._inFlight = false;
    this._dirty = false;
    this._status = {
      configured: isConfigured(),
      online: false,
      lastPushedAt: null,
      lastPulledAt: null,
      lastError: null,
    };
  }

  getStatus() { return Object.assign({}, this._status, {
    loggedIn: this.auth && this.auth.isLoggedIn(),
    user: this.auth && this.auth.getUser(),
    configured: isConfigured(),
  }); }

  _broadcast() {
    this.onStatus(this.getStatus());
  }

  markDirty() {
    if (!this.auth || !this.auth.isLoggedIn()) return;
    if (!isConfigured()) return;
    this._dirty = true;
    if (this._pushTimer) clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.pushAll().catch((e) => console.warn('[sync] push failed', e));
    }, PUSH_DEBOUNCE_MS);
  }

  /**
   * Read the renderer-shaped JSON payload out of the local KV store.
   */
  _readLocal() {
    const kv = this.store.getAll();
    const safeParse = (raw, dflt) => {
      if (raw == null) return dflt;
      if (typeof raw !== 'string') return raw;
      try { return JSON.parse(raw); } catch (_) { return dflt; }
    };
    return {
      workspaces: safeParse(kv['fhud_workspaces'], null),
      journals: safeParse(kv['fhud_journals'], []),
    };
  }

  _writeLocal({ workspaces, journals }) {
    const kv = this.store.getAll();
    if (workspaces !== undefined && workspaces !== null) {
      kv['fhud_workspaces'] = typeof workspaces === 'string' ? workspaces : JSON.stringify(workspaces);
    }
    if (journals !== undefined && journals !== null) {
      kv['fhud_journals'] = typeof journals === 'string' ? journals : JSON.stringify(journals);
    }
    this.store.setAll(kv);
  }

  async pushAll() {
    if (this._inFlight) return { ok: false, reason: 'in-flight' };
    if (!this.auth || !this.auth.isLoggedIn()) return { ok: false, reason: 'not-logged-in' };
    if (!isConfigured()) return { ok: false, reason: 'not-configured' };
    const supabase = getClient();
    if (!supabase) return { ok: false, reason: 'no-client' };

    const userId = this.auth.getUserId();
    const local = this._readLocal();

    this._inFlight = true;
    this._status.online = true;
    this._broadcastStatus('syncing');
    try {
      const now = new Date().toISOString();
      const rows = [];
      if (local.workspaces && local.workspaces.work) {
        rows.push({ user_id: userId, ws_key: 'work', data: local.workspaces.work, updated_at: now });
      }
      if (local.workspaces && local.workspaces.life) {
        rows.push({ user_id: userId, ws_key: 'life', data: local.workspaces.life, updated_at: now });
      }
      if (rows.length) {
        const { error: wsErr } = await supabase
          .from('workspaces')
          .upsert(rows, { onConflict: 'user_id,ws_key' });
        if (wsErr) throw wsErr;
      }

      if (Array.isArray(local.journals) && local.journals.length) {
        const jRows = local.journals.map(j => ({
          id: j.id,
          user_id: userId,
          date: j.date,
          ws: j.ws,
          data: j,
          updated_at: now,
        }));
        const { error: jErr } = await supabase
          .from('journals')
          .upsert(jRows, { onConflict: 'id' });
        if (jErr) throw jErr;
      }

      this._status.lastPushedAt = Date.now();
      this._status.lastError = null;
      this._dirty = false;
      this._broadcastStatus('idle');
      return { ok: true };
    } catch (e) {
      console.warn('[sync] push error', e);
      this._status.lastError = String(e && e.message || e);
      this._broadcastStatus('error');
      return { ok: false, error: this._status.lastError };
    } finally {
      this._inFlight = false;
    }
  }

  async pullAll() {
    if (!this.auth || !this.auth.isLoggedIn()) return { ok: false, reason: 'not-logged-in' };
    if (!isConfigured()) return { ok: false, reason: 'not-configured' };
    const supabase = getClient();
    if (!supabase) return { ok: false, reason: 'no-client' };
    const userId = this.auth.getUserId();

    this._broadcastStatus('syncing');
    try {
      const [{ data: wsRows, error: wsErr }, { data: jRows, error: jErr }] = await Promise.all([
        supabase.from('workspaces').select('*').eq('user_id', userId),
        supabase.from('journals').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(180),
      ]);
      if (wsErr) throw wsErr;
      if (jErr) throw jErr;

      const local = this._readLocal();
      // 合并 workspaces：云端有就覆盖
      let workspaces = local.workspaces || { work: null, life: null };
      if (wsRows && wsRows.length) {
        for (const row of wsRows) {
          if (row.ws_key === 'work' || row.ws_key === 'life') {
            workspaces[row.ws_key] = row.data;
          }
        }
      }
      // 合并 journals：以 id 去重
      const journalsMap = new Map();
      (Array.isArray(local.journals) ? local.journals : []).forEach(j => journalsMap.set(j.id, j));
      (jRows || []).forEach(row => {
        const existing = journalsMap.get(row.id);
        if (!existing || (existing._updatedAt && row.updated_at && new Date(row.updated_at) > new Date(existing._updatedAt))) {
          journalsMap.set(row.id, row.data);
        } else if (!existing) {
          journalsMap.set(row.id, row.data);
        }
      });
      const journals = Array.from(journalsMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

      this._writeLocal({ workspaces, journals });
      this._status.lastPulledAt = Date.now();
      this._status.lastError = null;
      this._broadcastStatus('idle');

      // 通知渲染进程重新加载
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('sync:dataUpdated'));

      return { ok: true };
    } catch (e) {
      console.warn('[sync] pull error', e);
      this._status.lastError = String(e && e.message || e);
      this._broadcastStatus('error');
      return { ok: false, error: this._status.lastError };
    }
  }

  _broadcastStatus(phase) {
    const payload = Object.assign({}, this.getStatus(), { phase });
    this.onStatus(payload);
  }
}

module.exports = SyncEngine;
