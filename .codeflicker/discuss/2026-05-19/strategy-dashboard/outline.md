# 讨论：策略仪表盘构建

> 状态：决策已确认 | 轮次：R1 | 日期：2026-05-19

## ✅ 已确认

- **仪表盘架构：Python数据获取 + 静态HTML展示** → [D01](./decisions/D01-dashboard-architecture.md) (#R1)
- **仪表盘内容涵盖**：
  - PE-DCA执行信号（顶层）
  - 组合快照（纳指/沪深300 PE+价格）
  - 宏观五力（利率/流动性/汇率/地缘/财政）
  - 核心持仓监控（9只核心标的）
  - 美联储监视器（沃什上任/缩表/PCE）
  - AI供应链映射（上中下游权重）
  - 投资框架与决策记录（三问法/杜邦分析/核心判断）
- **部署方式：GitHub Pages + GitHub Actions** → [D01](./decisions/D01-dashboard-architecture.md) (#R1)
- **更新频率：每日北京时间9:00自动更新（周一到周五）**
- **视觉风格：简洁专业，白底深色字，卡片式布局**

## 📁 归档

| 问题 | 结论 | 详情 |
|------|------|------|
| 仪表盘存放位置 | 项目根目录/dashboard/ | — |
| 数据更新方式 | Python脚本(yfinance) + GitHub Actions定时任务 | — |
| 数据文件格式 | JSON（data.json） | — |
| 访问方式 | GitHub Pages（public URL） | — |
| 公开/私有 | 公开仓库 | — |