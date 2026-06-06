# One Memory (记忆中枢)

**Hybrid Graph-Vector Memory Engine for AI Workforce OS**

> 记忆不是存储，是理解的能力。

---

## 为什么需要 One Memory？

市面上的 AI 记忆系统要么是**向量黑盒**（Mem0/Zep）——塞进去一堆文本，吐出来 top-K 片段，没有结构推理能力；
要么是**纯文本堆叠**（LangChain Memory）——会话级、易丢失、无代码感知。

One Memory 的路线：**图做骨架，向量做血肉，代码符号做纽带，梦境做熵减。**

```
写入（熵增）                      梦境（熵减）
  memory-graph.write()            dream.consolidate()
  memory-vector.upsert()               │
       ↓                              ├─ 冗余合并 → 去重
  碎片化、冗余、噪声                    ├─ 主题聚类 → 提炼 insight
       ↓                              ├─ 低值修剪 → 归档/删除
  查询 → 向量粗召回 → 图遍历精排序       └─ 健康评分 → 报告
        模糊搜索        结构推理
```

让 AI 既**记得住**（大规模持久化），又**理解关系**（函数调用链、bug 因果链、决策关联链），
还会**自我整理**（梦境周期自动熵减）。

## 核心优势

| 能力 | One Memory | Mem0/Zep | LangChain Memory |
|------|-----------|---------|------------------|
| 语义模糊搜索 | ✅ 向量层 | ✅ | ❌ |
| 代码符号关联 | ✅ 原生 | ❌ | ❌ |
| 因果链推理 | ✅ 图遍历 | ❌ | ❌ |
| 跨会话持久 | ✅ | ✅ | ❌ |
| 规模扩展 | ✅ IVF 15x + 冷热分层 | ✅ 需付费 | ❌ |
| 本地优先 | ✅ | ❌ | ✅ |
| **记忆熵减（梦境）** | ✅ 冗余合并+聚类+修剪 | ❌ | ❌ |

## 项目状态

**Phase 0–4 + Phase 3.5 全部完成 ✅**

```
Phase 0: 架构定义          100% ████████████
Phase 1: 核心引擎 MVP      100% ████████████
Phase 2: 集成与韧性        100% ████████████
Phase 3: 智能进化          100% ████████████
Phase 3.5: 梦境引擎        100% ████████████  ← 新增
Phase 4: 规模化            100% ████████████
```

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
│   ├── 04-dual-write.md         # 双写一致性
│   └── 05-dream-engine.md       # 梦境引擎设计
├── packages/
│   ├── memory-graph/            # CodeGraph 记忆引擎集成
│   │   ├── auto-linker.ts       # 自动代码符号关联
│   │   ├── importance-learner.ts # 重要性学习与衰减
│   │   ├── decision-tracker.ts  # 决策追踪与回溯
│   │   └── obsidian-writer.ts   # Obsidian 双写同步
│   ├── memory-vector/           # 语义向量引擎适配
│   │   ├── ivf-index.ts         # IVF 索引（15x 加速）
│   │   ├── embedder.ts          # Embedding 模型接口
│   │   └── vector-store.ts      # SQLite 向量存储
│   ├── memory-orchestrator/     # 混合查询编排器 + 梦境引擎
│   │   ├── index.ts             # HybridQueryEngine
│   │   ├── memory-system.ts     # MemorySystem 统一入口
│   │   └── dream.ts             # 梦境引擎（熵减）
│   └── memory-cli/              # CLI 管理工具
└── examples/
    └── query-flows.md           # 查询流示例
```

## 关键指标

| 指标 | 值 | 目标 |
|------|-----|------|
| 混合查询 P50 | 6.6ms | < 200ms |
| 混合查询 P99 | 14.6ms | < 1s |
| 写入吞吐 | 556 条/秒 | > 100 条/秒 |
| 向量搜索（IVF） | 0.396ms（15x 加速） | > 10x |
| 图遍历 P50 | 0.3ms | < 5ms |
| 梦境健康评分 | 0–10 分 | > 7 |
| 测试覆盖 | 19 套 | 全通过 |

## 快速开始

```typescript
import { MemorySystem } from "@one/memory-orchestrator";

// 初始化
const ms = await MemorySystem.init({
  codegraphDir: "/path/to/.codegraph",
  embedder: "local",
});

// 写入记忆（图 + 向量 + Obsidian 同步）
await ms.write({
  title: "支付超时修复",
  summary: "将支付超时从 30s 调整到 60s",
  importance: 7,
  tags: ["payment", "bugfix"],
});

// 混合查询
const { results } = await ms.query("支付超时问题");
console.log(results[0].title); // 支付超时修复

// 梦境整理（熵减）
const report = await ms.dream();
console.log(`冗余合并: ${report.actions.merged.length}`);
console.log(`insight 提炼: ${report.actions.insights.length}`);
console.log(`健康评分: ${report.healthScore}/10`);

// 预览模式（不修改数据）
const preview = await ms.dream(true);
console.log(preview.actions); // 为空，仅预览

// 关闭
await ms.shutdown();
```

## 梦境引擎（熵减）

One Memory 的独特能力——模拟人脑睡眠时的记忆巩固过程：

| 阶段 | 人脑 | 系统操作 | 效果 |
|------|------|---------|------|
| 清醒 | 接收信息 | 写入 memory_nodes | 熵增 |
| 浅睡 | 海马体回放 | 冗余检测 + 合并 | 去重 |
| 深睡 | 记忆固结 | 标签聚类 → insight | 提炼精华 |
| 修剪 | 无用连接消亡 | 低值归档 + TTL 删除 | 释放空间 |
| 醒来 | 记忆更清晰 | 健康评分 + 报告 | 可量化改善 |

## 许可

MIT © Wang Jie / One Systems
