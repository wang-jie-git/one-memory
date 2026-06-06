# One Memory (记忆中枢)

**Hybrid Graph-Vector Memory Engine for AI Workforce OS**

> 记忆不是存储，是理解的能力。

---

## 为什么需要 One Memory？

市面上的 AI 记忆系统要么是**向量黑盒**（Mem0/Zep）——塞进去一堆文本，吐出来 top-K 片段，没有结构推理能力；
要么是**纯文本堆叠**（LangChain Memory）——会话级、易丢失、无代码感知。

One Memory 的路线：**图做骨架，向量做血肉，代码符号做纽带。**

```
查询 → 语义向量粗召回(TOP 20) → CodeGraph 图遍历精排序 → TOP 5 输出
        模糊搜索                    结构推理                     最终
```

让 AI 既**记得住**（大规模持久化），又**理解关系**（函数调用链、bug 因果链、决策关联链）。

## 核心优势

| 能力 | One Memory | Mem0/Zep | LangChain Memory |
|------|-----------|---------|------------------|
| 语义模糊搜索 | ✅ 向量层 | ✅ | ❌ |
| 代码符号关联 | ✅ 原生 | ❌ | ❌ |
| 因果链推理 | ✅ 图遍历 | ❌ | ❌ |
| 跨会话持久 | ✅ | ✅ | ❌ |
| 规模扩展 | ✅ 图剪枝 | ✅ 需付费 | ❌ |
| 本地优先 | ✅ | ❌ | ✅ |

## 项目状态

**Phase 0 — 架构定义** ← 我们现在在这里

## 仓库结构

```
one-memory/
├── README.md                    # ← 你在这里
├── ARCHITECTURE.md              # 核心架构文档（必读）
├── CLAUDE.md                    # 开发规范
├── ROADMAP.md                   # 路线图
├── specs/                       # 详细技术规范
│   ├── 01-hybrid-query.md       # 混合查询流程
│   ├── 02-graph-schema.md       # CodeGraph 记忆节点 Schema
│   ├── 03-vector-interface.md   # 语义向量接口
│   └── 04-dual-write.md         # 双写一致性
├── packages/
│   ├── memory-graph/            # CodeGraph 记忆引擎集成
│   ├── memory-vector/           # 语义向量引擎适配
│   ├── memory-orchestrator/     # 混合查询编排器
│   └── memory-cli/              # CLI 管理工具
└── examples/
    └── query-flows.md           # 查询流示例
```

## 许可

MIT © Wang Jie / One Systems
