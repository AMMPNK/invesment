/**
 * Persistent local storage backed by electron-store.
 *
 * Provides a key/value API used by the renderer's localStorage adapter.
 * All renderer reads pre-load the entire snapshot once at init,
 * then every write goes async to disk.
 */

'use strict';

const path = require('path');

class Store {
  constructor() {
    this.electronStore = null;
  }

  async init() {
    // electron-store v8 is CJS, but newer 9.x is ESM only.
    // We pin to v8 in package.json to keep require() working.
    let StoreCtor;
    try {
      StoreCtor = require('electron-store');
      // newer versions export as default
      if (StoreCtor.default) StoreCtor = StoreCtor.default;
    } catch (e) {
      console.error('[store] electron-store not installed', e);
      throw e;
    }
    this.electronStore = new StoreCtor({
      name: 'focus-hud-data',
      defaults: {
        kv: {}, // 渲染进程的所有 localStorage 键值都放这里
        meta: {
          createdAt: Date.now(),
          version: 1,
        },
      },
    });
  }

  /** 获取所有 KV，用于渲染进程启动时初始化内存缓存 */
  getAll() {
    return this.electronStore.get('kv') || {};
  }

  get(key) {
    const kv = this.getAll();
    return Object.prototype.hasOwnProperty.call(kv, key) ? kv[key] : null;
  }

  set(key, value) {
    const kv = this.getAll();
    kv[key] = value;
    this.electronStore.set('kv', kv);
  }

  delete(key) {
    const kv = this.getAll();
    delete kv[key];
    this.electronStore.set('kv', kv);
  }

  clear() {
    this.electronStore.set('kv', {});
  }

  /** 同步引擎用：直接读写整段 */
  setAll(kv) {
    this.electronStore.set('kv', kv || {});
  }

  /** 元数据 */
  getMeta(k, dflt = null) {
    const m = this.electronStore.get('meta') || {};
    return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : dflt;
  }

  setMeta(k, v) {
    const m = this.electronStore.get('meta') || {};
    m[k] = v;
    this.electronStore.set('meta', m);
  }

  /** 用于 dev 调试：返回数据库文件路径 */
  path() {
    return this.electronStore.path;
  }
}

module.exports = { Store };
