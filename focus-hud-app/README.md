# Focus HUD

注意力外显器桌面版 — macOS Electron 应用，常驻右下角，本地优先 + Supabase 云同步。

## ✨ 功能

- 💼/🏠 **双工作区**：工作 / 生活分开管理，但共享同一个时间轴
- 📋 **三类任务**：计划 / 临时 / 每日固定
- ⏯ **挂起恢复**：被打断时一键挂起，附带"现场"上下文
- 📅 **弹性日历**：拖拽到任意时段，跨小时块支持
- 🌅 **收尾仪式**：每晚或当日完成后触发，自动归档当日时间轴 + 反思
- 📖 **日记存档**：心情、统计、可回溯
- 🤖 **AI 提示**：模糊任务自动改写、专注偏离智能提醒
- ☁️ **云同步**：基于 Supabase，多设备实时同步（last-write-wins）
- 🔥 **常驻右下角**：透明 + 始终置顶 + 系统托盘 + 全局快捷键

---

## 🚀 开发与运行

### 前置依赖

```bash
node >= 18
npm >= 9
```

### 安装

```bash
cd focus-hud-app
npm install
```

> 如果 npm 缓存目录有权限问题，可加 `--cache /tmp/npm-cache`。

### 开发模式（带 DevTools）

```bash
npm run dev
```

### 普通启动

```bash
npm start
```

### 打包 macOS .dmg

```bash
npm run build:mac
# 产物位于 dist/Focus HUD-1.0.0-arm64.dmg
```

---

## ☁️ 配置 Supabase 云同步（可选）

如果只想本地用，跳过这一节。如需多设备同步：

### 1. 创建 Supabase 项目

1. 注册 [supabase.com](https://supabase.com)（免费层 500MB DB + 5GB 流量/月）
2. 新建项目，记下 **Project URL** 和 **anon public key**

### 2. 建表 + RLS

打开 Supabase Dashboard → SQL Editor，粘贴并执行：

```bash
focus-hud-app/supabase/schema.sql
```

### 3. 在客户端写入配置

应用首次启动后，编辑下面这个文件并填入 `url` 和 `anonKey`：

```
~/Library/Application Support/Focus HUD/supabase.json
```

格式：

```json
{
  "url": "https://your-project.supabase.co",
  "anonKey": "eyJhbGciOi..."
}
```

> 这个文件**不会**被同步到云端，每台设备需要分别配置。也可以通过环境变量 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 覆盖。

### 4. 重启应用 → 点状态条登录

应用右上角的小圆圈即同步状态条：
- 灰色：本地模式 / 未登录
- 黄色：同步中
- 绿色：已同步
- 红色：同步失败（点击查看）

注册成功后云端 push 自动触发；其他设备登录同账号会先 pull 一次再合并。

---

## 🔑 全局快捷键

- **⌘⇧Space**：显示 / 隐藏 HUD

---

## 🗂 项目结构

```
focus-hud-app/
├── package.json
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.js              # 入口
│   │   ├── window.js             # 窗口管理（透明 / 置顶）
│   │   ├── tray.js               # 系统托盘
│   │   ├── store.js              # 本地持久化（electron-store）
│   │   ├── ipc.js                # IPC 注册
│   │   └── sync/                 # Supabase 同步
│   │       ├── supabase-client.js
│   │       ├── auth.js
│   │       └── sync-engine.js
│   ├── preload/preload.js        # contextBridge 桥
│   ├── renderer/                 # 渲染进程（即原 HTML 原型）
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js                # 9 大模块全部逻辑
│   │   ├── adapter.js            # localStorage → IPC 适配层
│   │   └── sync-ui.js            # 同步状态条 + 登录 modal
│   └── shared/schema.js
├── supabase/schema.sql
└── resources/                    # 图标
```

---

## ⚠️ 已知限制（v1.0）

- **未公证**：首次打开时 macOS 会提示"无法验证开发者"，右键 → 打开即可绕过
- **仅 macOS**：Windows/Linux 打包尚未测试
- **AI 提示是 mock**：未接入真 LLM
- **冲突处理**：last-write-wins，多端同时改同一字段时较新者胜
- **数据迁移**：暂无内置导出，可直接复制 `~/Library/Application Support/Focus HUD/focus-hud-data.json`

---

## 📁 数据存储路径

- macOS：`~/Library/Application Support/Focus HUD/focus-hud-data.json`
- Supabase：`workspaces` + `journals` 两张表，按 `user_id` 隔离

---

## 📝 License

MIT
