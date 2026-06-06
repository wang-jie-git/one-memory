# 梦境引擎 (Dream Engine) — 记忆熵减系统

**Phase**: 3.5 (介于智能进化与规模化之间)
**状态**: 架构设计
**最后更新**: 2026-06-06

---

## 1. 核心理念

记忆如同熵增的宇宙——写入越多，越混乱。梦境引擎是逆熵过程：

```
写入（熵增）                   梦境整理（熵减）
  memory-graph.write()          dream.consolidate()
  memory-vector.upsert()        dream.distill()
  AutoLinker.autoLink()         dream.patternWeave()

    ↓ 碎片化、冗余、噪声          ↓ 结构化、精炼、洞察
```

### 现实世界类比

| 阶段 | 人脑 | One Memory |
|------|------|-----------|
| 清醒 | 接收信息，写入海马体 | 写入 memory_nodes |
| 浅睡 | 海马体回放，筛选重要记忆 | 重要性重评估 + 去冗余 |
| 深睡 | 记忆从海马体→新皮层 | 聚合 + 提纯 + 抽象 |
| 梦境 | 跨记忆连接，发现新模式 | 跨语义关联 → 生成洞察 |
| 醒来 | 记忆更清晰，无用连接被修剪 | 图剪枝 + 索引重建 |

---

## 2. 架构设计

```
dream.consolidate()
    │
    ├── Phase 1: 评估 (Assessment)
    │   ├── scanAllMemories()          → 遍历所有活跃记忆
    │   ├── computeRedundancy()        → 检测重复/高度相似
    │   └── computeValue()             → 重要性 + 引用热度 + 时效性
    │
    ├── Phase 2: 蒸馏 (Distillation)
    │   ├── mergeDuplicates()          → 合并重复记忆
    │   ├── summarizeCluster()         → 为相关记忆簇生成摘要
    │   ├── extractInsights()          → 跨模式提取洞察
    │   └── createAbstractMemory()     → 将多条具体记忆合为一条抽象记忆
    │
    ├── Phase 3: 修剪 (Pruning)
    │   ├── archiveLowValue()          → 归档低价值记忆
    │   ├── deleteExpired()            → 删除 TTL 到期的
    │   └── pruneOrphanedEdges()       → 清理孤立的边
    │
    └── Phase 4: 梦境报告 (Dream Report)
        ├── whatWasRemoved()
        ├── whatWasMerged()
        ├── newInsights()
        └── healthScore()
```

---

## 3. 核心算法

### 3.1 冗余检测

```typescript
function findRedundantPairs(threshold = 0.92): Array<[nodeId, nodeId, score]> {
  // 1. 向量相似度 > 0.92
  // 2. 标签重叠 > 80%
  // 3. 时间间隔 < 7 天
  // → 判定为冗余，需要合并或删除其一
}
```

### 3.2 记忆蒸馏

```typescript
function distill(memories: MemoryNode[]): MemoryNode {
  // 输入:   [ "支付超时 fix v1", "支付超时 fix v2", "熔断器阈值调整" ]
  // 过程:   提取共同主题 + 时间线排序 + 去重细节
  // 输出:   "支付模块稳定性优化演进 (从 fix 到熔断器)"
  // 原记忆: 标记为 superseded_by → 新记忆
}
```

### 3.3 模式发现

```typescript
function discoverPatterns(): Insight[] {
  // 扫描所有 edges 的 relation 分布
  // 发现: "70% 的 'fixes' 关联都涉及 payment 模块"
  // → 生成洞察: "支付模块是 Bug 高发区，需要架构评审"
  // 写入为新的 memory_entry (node_type='insight')
}
```

---

## 4. 梦境循环调度

```typescript
// Cron 表达式
schedule: "0 3 * * *"      // 每天凌晨 3 点
// 或
trigger: "idle"              // 系统空闲半小时后触发
// 或
trigger: "manual"            // 手动触发: one-memory dream

// 完整梦境周期预期耗时（5000 条记忆）:
//   Phase 1: ~2s (全量扫描)
//   Phase 2: ~5s (聚合 + LLM 调用)
//   Phase 3: ~1s (删除 + 归档)
//   Phase 4: ~0.1s (报告生成)
//   总计: ~8s (不含 LLM 调用)
```

---

## 5. 梦境报告输出

```json
{
  "dreamId": "uuid",
  "timestamp": 1717660800000,
  "duration": 8123,
  "summary": {
    "before": { "nodes": 1240, "edges": 3800, "vectors": 1240 },
    "after": { "nodes": 980, "edges": 3500, "vectors": 980 }
  },
  "actions": {
    "merged": 45,
    "deleted": 120,
    "archived": 95,
    "insightsGenerated": 3
  },
  "insights": [
    {
      "title": "支付模块 Bug 高发",
      "confidence": 0.87,
      "relatedNodes": ["payment-fix-1", "payment-fix-2", ...]
    }
  ],
  "healthScore": 8.5
}
```

---

## 6. 与现有系统的集成

```
memory-graph/
  ├── database.ts          ← 现有
  ├── auto-linker.ts       ← 现有
  ├── importance-learner.ts ← 现有
  ├── decision-tracker.ts  ← 现有
  └── dream-engine.ts      ← 新增

memory-orchestrator/
  ├── index.ts             ← 现有 (hybrid query)
  ├── memory-system.ts     ← 现有 (统一入口)
  └── dream.ts             ← 新增 (梦境触发器)
```

---

## 7. 安全边界

- **LLM 调用可选**: 蒸馏和洞察生成可以用 LLM，也可以纯算法（向量相似度 + 标签聚类）
- **dry-run 模式**: 所有操作可预览，不实际修改数据
- **可恢复**: 梦境操作记录到 memory_edges（type='dream_action'），可回滚
- **频控**: 每天最多一次全量梦境，避免计算资源浪费
