# One Memory — 商业化架构决策记录

> 记录影响产品形态的关键架构取舍，防止未来走回头路。

---

## 决策 001: Obsidian 双写同步（可选项）

**日期**: 2026-06-06  
**发起人**: Founder  
**类型**: 商业化功能设计

### 问题

记忆系统同时服务于 AI（通过 MCP tool）和人（通过 Obsidian Markdown），
两种读者对信息的密度、格式、结构需求完全不同。
强行双写增加了系统复杂度，而创始人本人从未阅读过 Obsidian 中同步的记忆。

### 决策

**Obsidian 双写同步改为可选项，默认关闭。**

```
MemorySystem.init({
  obsidianVaultPath?: string  // 可选，留空则不初始化 ObsidianWriter
})
```

- 开启时：MemorySystem 写入 DB 的同时，通过 ObsidianWriter 渲染人类可读的 Markdown
- 关闭时：不走任何文件 IO，纯 DB 操作
- 渲染格式为「人类友好」：完整叙事、Markdown 格式、frontmatter 元数据

### 架构映射

```
关闭（默认、创始人选择）:
  write() → codegraph.db (结构化)
          → × Obsidian

开启（可选）:
  write() → codegraph.db (结构化)
          → Obsidian Vault (人类可读 Markdown)
```

### 商业化考量

| 用户画像 | Obsidian 需求 | 定价影响 |
|---------|-------------|---------|
| 独立开发者 | 低，信任 AI 读取 | 基础版默认关闭 |
| 企业/团队 | 中，需要审计和人工翻阅 | 专业版可开启 |
| 知识工作者 | 高，Obsidian 是工作流核心 | 旗舰版强绑 |

### 影响范围

- `MemorySystemConfig` → `obsidianVaultPath?: string`（可选）
- `MemorySystem.init()` → 只在有路径时初始化 ObsidianWriter
- `MemoryWatchdog` → 只在有 ObsidianWriter 时检查该组件
- `README.md` → 标注为可选功能
- 创始人本人：关闭，不产生任何 Obsidian 文件 I/O

---

## 决策 002: 双视图渲染（AI 精简 / 人类完整）

**日期**: 2026-06-06  
**发起人**: Founder  
**状态**: 确认设计方向，待实现

### 问题

同一份记忆，AI 和人类的读取模式完全不同：

- AI：要结构化、低 Token、精准
- 人：要叙事、有上下文、可浏览

### 决策

同一份结构化数据，提供两层视图渲染：

```
codegraph.db  →  MCP 返回: { id, title, summary, score }     (AI 读取, ~5 tokens)
              →  REST 返回: 完整 Markdown 或 JSON             (前端展示)
              →  Obsidian:  格式化 Markdown (用户可选开启)    (人类翻阅)
```

- MCP 默认短格式，支持 `detail=true` 参数展开
- REST API 按需返回完整体
- Obsidian 渲染仅在用户开启时生效

### 实现要点

- summary 字段设计为「一句话摘要」，适合 AI 上下文窗口
- body 字段保存完整内容，适合人阅读
- MCP 默认只返回 `{id, title, summary, importance, tags, score}`
