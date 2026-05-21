# AI画图流水线：从吼出来到落地稿

**来源**：姜自友《以前画图靠手，现在画图靠吼》| KStack 14332  
**标签**：AI×工作效率、工具链  
**置信度**：高（一线实践）

---

## 核心洞见

画图的本质不是审美，而是**信息密度的精确控制**。

- 密度过高（PPT放时序图）→ 受众消化不了
- 密度过低（评审用概念图）→ 同事无法落地

**一个核心问题**：这张图是给谁看的？

---

## 判断框架

| 场景 | 受众 | 信息密度 | 画法原则 | 工具 |
|------|------|---------|---------|------|
| PPT/汇报 | 老板、业务方、3秒耐心的人 | 低 | 藏细节、重视觉、大色块、图标化 | Nanobanana Pro、SVG动效 |
| 技术评审 | 架构师、开发、三个月后的自己 | 高 | 展细节、守规矩、标准化流程图 | Mermaid、Draw.io |

> 大多数人画图失败，是因为"把PPT图当评审图画"或"把评审图当PPT画"

---

## 四步流水线

### Step 1: 找灵感
- **代码→图**：扔给AI读代码（Cursor/KwaiPilot）
- **文档→图**：复制段落让AI总结流程（Docs AI助手）
- **找参考**：ProcessOn模版库搜关键词
- **数据支撑**：AI做Deep Research

### Step 2: AI初稿
- **流程图**：Claude + Mermaid（唯一真神）
- **架构图**：Claude + SVG/HTML（所见即所得，不满意直接吼）
- **氛围图**：Nanobanana Pro（中文支持好，科技感拉满）

### Step 3: 人工微调
- **手绘风**：Mermaid → Excalidraw（用Mermaid to Excalidraw粘贴）
- **严谨风**：SVG/HTML → Draw.io XML（粘贴到Draw.io网页版编辑）
- **图标增强**：Iconfont/Flaticon复制SVG代码，粘贴到画布

### Step 4: 导出
- Excalidraw导出选Transparent去背景
- 带动效HTML用Chrome Capture录制GIF
- Draw.io常规导出PNG/SVG

---

## 实战技巧

### 让AI写SVG，不满意直接吼
```
"用SVG画个微服务架构图，有网关、BFF层、服务层，极简科技风"
→ 预览
→ "把BFF层换成深色"
→ "OK，转成Draw.io XML给我"
```

### 图标大挪移
1. Iconfont/Flaticon搜图标
2. 复制SVG代码
3. 粘贴到Draw.io/Excalidraw
4. 瞬间提升架构图档次

---

## 与我的关系

这套流水线可以直接用在：
- 快手女娲汇报PPT配图
- 研一课程作业报告
- 知识库wiki架构图

**我需要记住的**：
- 画图前先问：给谁看？信息密度要高还是低？
- Claude系列模型画图效果最好
- Mermaid适合流程图，SVG适合架构图，Nanobanana适合氛围图
