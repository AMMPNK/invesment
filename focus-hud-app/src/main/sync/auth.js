/**
 * Email/password auth on top of Supabase.
 *
 * The refresh_token is stored in the macOS Keychain via `keytar`,
 * so we can silently restore the session next launch.
 * Falls back gracefully if keytar isn't available (rare).
 */

'use strict';

const SERVICE = 'focus-hud';
const ACCOUNT = 'supabase-session';

const { getClient, isConfigured, writeUserConfigTemplate } = require('./supabase-client');

let keytar = null;
try { keytar = require('keytar'); } catch (e) { /* optional */ }

class Auth {
  constructor(store) {
    this.store = store;
    this._user = null;
    this._session = null;
  }

  isConfigured() { return isConfigured(); }
  isLoggedIn() { return Boolean(this._session && this._user); }
  getUser() { return this._user; }
  getSession() { return this._session; }

  async _saveSession(session) {
    this._session = session;
    this._user = session ? session.user : null;
    if (session && session.refresh_token && keytar) {
      try { await keytar.setPassword(SERVICE, ACCOUNT, session.refresh_token); } catch (_) {}
    }
    if (!session && keytar) {
      try { await keytar.deletePassword(SERVICE, ACCOUNT); } catch (_) {}
    }
  }

  async tryRestoreSession() {
    if (!isConfigured()) return false;
    if (!keytar) return false;
    let token;
    try { token = await keytar.getPassword(SERVICE, ACCOUNT); } catch (_) { return false; }
    if (!token) return false;

    const supabase = getClient();
    if (!supabase) return false;
    try {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
      if (error || !data || !data.session) {
        console.warn('[auth] restore session failed', error && error.message);
        await this._saveSession(null);
        return false;
      }
      await this._saveSession(data.session);
      return true;
    } catch (e) {
      console.warn('[auth] restore session error', e);
      return false;
    }
  }

  async login(email, password) {
    if (!isConfigured()) {
      writeUserConfigTemplate();
      return { ok: false, error: '未配置 Supabase。请编辑 userData/supabase.json 后重启。' };
    }
    const supabase = getClient();
    if (!supabase) return { ok: false, error: 'Supabase 客户端不可用' };
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      await this._saveSession(data.session);
      return { ok: true, user: { id: data.user.id, email: data.user.email } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async signup(email, password) {
    if (!isConfigured()) {
      writeUserConfigTemplate();
      return { ok: false, error: '未配置 Supabase。请编辑 userData/supabase.json 后重启。' };
    }
    const supabase = getClient();
    if (!supabase) return { ok: false, error: 'Supabase 客户端不可用' };
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { ok: false, error: error.message };
      // Supabase 默认开启邮箱确认；如未确认则 session 为 null
      if (data.session) {
        await this._saveSession(data.session);
        return { ok: true, user: { id: data.user.id, email: data.user.email }, needsConfirm: false };
      }
      return {
        ok: true,
        needsConfirm: true,
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async logout() {
    const supabase = getClient();
    if (supabase) {
      try { await supabase.auth.signOut(); } catch (_) {}
    }
    await this._saveSession(null);
    return { ok: true };
  }

  /** 给同步引擎用：当前 access_token */
  getAccessToken() {
    return this._session ? this._session.access_token : null;
  }

  /** 当前用户 ID（行级安全策略需要） */
  getUserId() {
    return this._user ? this._user.id : null;
  }
}

module.exports = Auth;
