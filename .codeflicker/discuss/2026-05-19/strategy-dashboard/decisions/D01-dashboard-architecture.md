# 仪表盘架构与部署方案

**决策时间**：#R1
**状态**：✅ 已确认
**关联大纲**：[返回大纲](../outline.md)

---

## 背景

### 问题/需求
之前9轮讨论中累积了大量投资分析框架（杜邦分析、三问法、宏观五力、PE-DCA规则、AI供应链映射），这些信息分散在对话中，用户需要一个统一的仪表盘来：

1. 每日自动更新关键数据（PE、宏观、持仓）
2. 以可视化形式展示所有分析框架
3. 提供PE-DCA执行建议
4. 外部可访问，不限本地

### 约束条件
- 零成本（个人投资，不产生额外支出）
- 可外部访问（不限于本地PC）
- 每日自动更新（无需手动操作）
- 数据准确（来源可靠）

---

## 目标

构建一个每日自动更新的外部策略站点，整合所有投资分析框架，提供可视化的执行建议。

---

## 方案对比

| 方案 | 描述 | 优势 | 劣势 | 决策 |
|------|------|------|------|------|
| A. GitHub Pages + Actions | 静态HTML托管 + 定时任务更新数据 | 免费、全自动、公开可用 | 日级更新（非实时） | ✅ |
| B. Vercel/Netlify | Serverless部署 | 可配置Serverless函数 | Python支持有限 | ❌ |
| C. 自建VPS | 云服务器运行 | 完全控制、可分钟级更新 | 成本$5-10/月、需运维 | ❌ |

---

## 最终决策

### 选定方案
**方案A：GitHub Pages + GitHub Actions**

### 架构

```
GitHub Actions (每日UTC 1:00/北京9:00)
  │
  ├── pip install yfinance
  ├── python data_fetcher.py
  │     └── 输出 dashboard/data.json
  └── git-auto-commit → push data.json
        │
        ▼
GitHub Pages (自动重新部署)
  │
  └── https://[username].github.io/study-career/dashboard/
        │
        ├── index.html (仪表盘)
        └── data.json (每日更新数据)
```

### 决策理由
1. **零成本**：公开仓库完全免费，无月费
2. **全自动**：配置一次后永久运行，无需维护
3. **Git版本化**：所有数据有历史记录，可回溯
4. **外部可访问**：任何设备浏览器打开即可
5. **数据源可靠**：yfinance直接拉取Yahoo Finance数据

### 预期效果
- 每日9:00前数据更新完成
- 用户打开URL即可看到最新PE、宏观、持仓数据
- PE-DCA信号自动计算

---

## 被否决的方案

### 方案B：Vercel/Netlify
- **否决原因**：Python脚本在Serverless环境中运行受限，免费版有函数执行时间限制
- **重新考虑条件**：如果用户愿意将数据获取改写为JavaScript/Node.js

### 方案C：自建VPS
- **否决原因**：增加每月固定支出（$5-10）和运维成本，对当前使用量而言过度
- **重新考虑条件**：如果需要分钟级更新或更多自定义后端功能

---

## 相关链接

- [GitHub Actions Workflow](../../../../.github/workflows/update-data.yml)
- [仪表盘 HTML](../../../../dashboard/index.html)
- [数据获取脚本](../../../../dashboard/data_fetcher.py)