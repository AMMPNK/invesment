/**
 * Supabase client wrapper.
 *
 * Reads SUPABASE_URL & SUPABASE_ANON_KEY from one of:
 *   1. process.env (CI / dev)
 *   2. <userData>/supabase.json (runtime config the user can edit)
 *   3. baked-in default (you can hard-code yours below for personal use)
 *
 * The user can configure their own backend via the supabase.json file
 * located at the path printed in DevTools by `electronAPI.app.storePath()`.
 */

'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let _client = null;
let _config = null;

/** 读取配置：env > userData/supabase.json > 默认（空） */
function loadConfig() {
  if (_config) return _config;
  const fromEnv = {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  };
  if (fromEnv.url && fromEnv.anonKey) {
    _config = fromEnv;
    return _config;
  }
  try {
    const cfgPath = path.join(app.getPath('userData'), 'supabase.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.url && parsed.anonKey) {
        _config = { url: parsed.url, anonKey: parsed.anonKey };
        return _config;
      }
    }
  } catch (e) {
    console.warn('[supabase] config load failed', e);
  }
  _config = { url: '', anonKey: '' };
  return _config;
}

function isConfigured() {
  const c = loadConfig();
  return Boolean(c.url && c.anonKey);
}

function getClient() {
  if (_client) return _client;
  const cfg = loadConfig();
  if (!cfg.url || !cfg.anonKey) return null;
  // 延迟引入避免无网时报错
  const { createClient } = require('@supabase/supabase-js');
  _client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: false, // 我们手动用 keytar 保存 refresh token
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

function resetClient() {
  _client = null;
  _config = null;
}

/** 写入用户配置文件（仅供调试 / 文档） */
function writeUserConfigTemplate() {
  const cfgPath = path.join(app.getPath('userData'), 'supabase.json');
  if (fs.existsSync(cfgPath)) return cfgPath;
  const tpl = {
    _comment: '在此填入你自己的 Supabase 项目 URL 和 anon key，重启后生效。',
    url: '',
    anonKey: '',
  };
  fs.writeFileSync(cfgPath, JSON.stringify(tpl, null, 2), 'utf8');
  return cfgPath;
}

module.exports = { getClient, isConfigured, loadConfig, resetClient, writeUserConfigTemplate };
