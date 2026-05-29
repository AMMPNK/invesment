/**
 * sync-ui.js — wires the sync status bar + auth modal to electronAPI.
 * Loaded after app.js so it doesn't touch the prototype's globals.
 */

(function () {
  'use strict';

  if (!window.electronAPI) return;

  const api = window.electronAPI;
  const $ = (id) => document.getElementById(id);

  const bar = $('sync-bar');
  const text = $('sync-text');
  const modal = $('modal-auth');

  // ---------------- 状态条 ----------------
  function applyStatus(s) {
    if (!s) return;
    bar.classList.remove('online', 'syncing', 'error');
    if (!s.configured) {
      text.textContent = '本地模式';
      return;
    }
    if (!s.loggedIn) {
      text.textContent = '未登录';
      return;
    }
    if (s.phase === 'syncing') {
      bar.classList.add('syncing');
      text.textContent = '同步中…';
      return;
    }
    if (s.phase === 'error' || s.lastError) {
      bar.classList.add('error');
      text.textContent = '同步失败';
      return;
    }
    bar.classList.add('online');
    const t = s.lastPushedAt || s.lastPulledAt;
    text.textContent = '已同步' + (t ? ' · ' + relTime(t) : '');
  }
  function relTime(ts) {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    return Math.floor(sec / 3600) + 'h';
  }

  api.sync.status().then(applyStatus).catch(() => {});
  api.sync.onStatus(applyStatus);
  setInterval(() => api.sync.status().then(applyStatus).catch(() => {}), 30000);

  // 点击状态条：登录 / 登出 / 立即同步
  bar.addEventListener('click', async () => {
    const s = await api.sync.status();
    if (!s.configured) {
      const path = await api.app.storePath();
      alert('未配置 Supabase 后端。\n请在 ' + path.replace(/[^/\\]+$/, '') + 'supabase.json 填写 url 和 anonKey 后重启。');
      return;
    }
    if (!s.loggedIn) {
      openAuthModal();
      return;
    }
    // 已登录 → 弹简易菜单：立即同步 / 登出
    if (confirm('已登录为 ' + (s.user && s.user.email || '') + '\n\n点确定立即同步，取消则登出。')) {
      api.sync.pushNow();
      api.sync.pullNow();
    } else {
      await api.auth.logout();
      const fresh = await api.sync.status();
      applyStatus(fresh);
    }
  });

  // ---------------- 登录 modal ----------------
  let isSignup = false;

  function openAuthModal() {
    $('auth-msg').textContent = '';
    $('auth-msg').classList.remove('ok');
    setMode(false);
    modal.style.display = 'flex';
    setTimeout(() => $('auth-email').focus(), 50);
  }
  function closeAuthModal() {
    modal.style.display = 'none';
  }
  function setMode(signup) {
    isSignup = signup;
    $('auth-title').textContent = signup ? '注册' : '登录';
    $('auth-sub').textContent = signup ? '注册一个账号以同步多设备数据' : '使用邮箱密码登录';
    $('auth-submit').textContent = signup ? '注册' : '登录';
    $('auth-toggle').textContent = signup ? '已有账号？点这里登录' : '还没有账号？点这里注册';
  }

  $('auth-cancel').addEventListener('click', closeAuthModal);
  $('auth-skip').addEventListener('click', closeAuthModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAuthModal();
  });
  $('auth-toggle').addEventListener('click', () => setMode(!isSignup));

  $('auth-submit').addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const msg = $('auth-msg');
    msg.classList.remove('ok');
    if (!email || !password) {
      msg.textContent = '请填写邮箱和密码';
      return;
    }
    if (password.length < 6) {
      msg.textContent = '密码至少 6 位';
      return;
    }
    msg.textContent = isSignup ? '注册中…' : '登录中…';
    try {
      const r = isSignup
        ? await api.auth.signup(email, password)
        : await api.auth.login(email, password);
      if (!r.ok) {
        msg.textContent = r.error || '失败';
        return;
      }
      if (r.needsConfirm) {
        msg.classList.add('ok');
        msg.textContent = '注册成功，请到邮箱确认后再登录';
        setTimeout(closeAuthModal, 1800);
        return;
      }
      msg.classList.add('ok');
      msg.textContent = '登录成功，正在拉取云端数据…';
      // 拉取后会触发渲染进程刷新（adapter onDataUpdated → reload）
      await api.sync.pullNow();
      const fresh = await api.sync.status();
      applyStatus(fresh);
      closeAuthModal();
    } catch (e) {
      msg.textContent = String(e && e.message || e);
    }
  });

  // 回车提交
  ['auth-email', 'auth-password'].forEach(id => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('auth-submit').click();
    });
  });
})();
