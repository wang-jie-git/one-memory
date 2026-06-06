# One Memory 架构文档

**版本**: v0.1 (Phase 0)
**最后更新**: 2026-06-06
**作者**: One-Prime (0号元创世联合创始人)

---

## 1. 问题域

### 1.1 核心矛盾

AI Agent 的记忆系统面临一个三元悖论：

```
可扩展性 ← → 关联密度
    ↓           ↓
    语义模糊检索
```

- **纯向量系统**（Mem0/Zep）：语义检索强，但不知道"这段记忆和哪段代码、哪个 bug、哪个决策相关"
- **纯图系统**（Neo4j/knowledge graph）：关联推理强，但模糊搜索弱，写入开销高
- **纯文本堆叠**（LangChain）：简单但不可扩展，缺乏持久性

### 1.2 One 场景的特殊性

One 不是通用聊天机器人，而是 **AI 团队操作系统**。这意味着：

1. **记忆必须关联代码** — "支付模块的 bug 修复记录"必须能直接映射到 `PaymentService.process()`
2. **记忆有时序因果** — "为什么熔断器阈值为 5？"需要回溯到那次生产事故
3. **记忆有层级结构** — 公司级决策 > 项目级决策 > 技术实现细节
4. **记忆规模会爆炸** — 长期运行后，会话日志 + 决策记录 + bug 追踪可能达到亿级节点

---

## 2. 混合架构

### 2.1 顶层设计

```
┌─────────────────────────────────────────────────────┐
│                  memory-orchestrator                  │
│                   (统一查询入口)                        │
└──────────┬──────────────────────────────┬────────────┘
           │                              │
    ┌──────▼──────┐              ┌───────▼───────┐
    │ memory-graph │◄────────────►│ memory-vector │
    │ (图引擎)      │  双索引同步    │ (向量引擎)     │
    │              │              │               │
    │ CodeGraph +  │              │ Embedding API │
    │ Memory Nodes │              │ 向量存储       │
    └──────┬───────┘              └───────┬───────┘
           │                              │
    ┌──────▼───────┐              ┌───────▼───────┐
    │ Obsidian     │              │               │
    │ Vault        │              │  向量 DB       │
    │ (人类可读)    │              │ (Chroma/SQLite)│
    └──────────────┘              └───────────────┘
```

### 2.2 数据流

#### 写入路径

```
Agent 产生记忆
    │
    ├──→ memory-graph.writer()
    │       ├──→ CodeGraph: 创建/更新 MemoryEntry 节点
    │       │       ├──→ 关联相关代码符号（函数、类、文件）
    │       │       ├──→ 关联时序前置节点（之前的决策/bug）
    │       │       └──→ 标记重要性权重
    │       └──→ Obsidian: 同步写入 Markdown（人类可读）
    │
    └──→ memory-vector.embedder()
            ├──→ 文本向量化（embedding model）
            └──→ 向量库写入（含 metadata: node_id, type, timestamp）
```

#### 查询路径

```
用户/Agent 查询 "上次支付超时怎么修的"
    │
    ├──→ memory-vector.retriever()
    │       └──→ 语义相似度 TOP 20 粗召回
    │               └──→ 返回 candidate nodes + 相关性分数
    │
    ├──→ memory-graph.reader()
    │       ├──→ 对 candidates 进行图遍历精排序：
    │       │       ├──→ 代码关联度（是否指向 payment 模块）
    │       │       ├──→ 时序因果链（是否是被标记的修复）
    │       │       ├──→ 引用热度（多少后续记忆引用了它）
    │       │       └──→ 时效性衰减（旧记忆权重下降）
    │       └──→ 返回 TOP 5 重排序结果
    │
    └──→ memory-orchestrator.reranker()
            └──→ 融合向量分数 + 图遍历分数 → 最终输出
```

### 2.3 打分融合算法

```
final_score = α * vector_similarity + β * graph_relevance + γ * recency_decay

其中:
  α = 0.4  （语义相似度权重）
  β = 0.4  （图关联度权重）  
  γ = 0.2  （时效性权重）

graph_relevance = f(code_linkage, causal_chain, reference_heat)
  code_linkage  = 命中相关代码符号数 / 总符号数
  causal_chain  = 目标节点与查询主题的图距离（越近越高）
  reference_heat = 入边数 / 最大入边数（PageRank 简化版）
```

---

## 3. CodeGraph 记忆节点 Schema

### 3.1 新增节点类型

```typescript
// 核心记忆节点
type MemoryEntry {
  id: string;                    // UUID
  type: "memory_entry";
  title: string;                 // 标题
  summary: string;               // 摘要（用于向量化）
  content_hash: string;          // 内容哈希（去重）
  importance: number;            // 1-10 重要性
  timestamp: number;             // 创建时间戳
  ttl_days: number | null;       // 过期天数 (null = 永不过期)
  source: "agent" | "user" | "system" | "codegraph";
  
  // 已嵌入的向量引用
  vector_id: string | null;      // 对应向量库中的 ID
}

// 记忆-代码关联边
type LinksToCode {
  type: "links_to_code";
  target: CodeSymbol;            // CodeGraph 中的代码符号
  strength: "strong" | "weak" | "auto_detected";
  description: string;
}

// 记忆-记忆关联边
type LinksToMemory {
  type: "links_to_memory";
  target: MemoryEntry;
  relation: "causes" | "fixes" | "precedes" | "references" | "contradicts";
  weight: number;                // 0-1 关联强度
}

// 决策节点（扩展）
type Decision {
  type: "decision";
  context: string;               // 决策背景
  options: string[];             // 备选方案
  chosen: string;                // 选定方案
  rationale: string;             // 理由
  outcome: "success" | "failure" | "pending";
  links_to_memory: string[];     // 关联的记忆
}
```

### 3.2 图剪枝策略

```typescript
// 定期运行（cron: 0 3 * * 0 — 每周日凌晨3点）
function pruneMemoryGraph() {
  // 1. 删除过期节点（TTL 到期）
  // 2. 合并重复节点（content_hash 相同）
  // 3. 降级低重要性节点（importance < 3 且 0 入边 → 归档到冷存储）
  // 4. 压缩边（合并多条 weak 关联为一条 aggregated 关联）
}
```

---

## 4. 向量引擎接口

### 4.1 抽象接口（可替换实现）

```typescript
interface VectorStore {
  // 写入
  embed(text: string): Promise<number[]>;
  upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void>;
  
  // 查询
  query(vector: number[], topK: number): Promise<VectorResult[]>;
  
  // 维护
  delete(id: string): Promise<void>;
  stats(): Promise<{ total: number; dimension: number }>;
}

type VectorResult = {
  id: string;                    // 对应 memory_entry.id
  score: number;                 // 余弦相似度
  metadata: {
    type: string;
    title: string;
    timestamp: number;
    node_id: string;             // CodeGraph 节点 ID
  };
};
```

### 4.2 实现策略

| 阶段 | 实现 | 理由 |
|------|------|------|
| MVP | SQLite + sqlite-vec | 零依赖，本地优先，够用 |
| Beta | ChromaDB | 开源，可嵌入，支持过滤 |
| GA | LanceDB | 列式存储，大规模向量场景优化 |

---

## 5. 双写一致性

### 5.1 写入顺序

```
1. CodeGraph 写入（先写图，图是权威源）
2. 图写入成功 → 向量写入
3. 向量写入成功 → Obsidian 写入（最终一致）
4. 任一失败 → 回滚 + 重试队列
```

### 5.2 最终一致保证

- CodeGraph 是 **source of truth**
- 向量库可重建（从 CodeGraph 全量重新 embedding）
- Obsidian 是**人类可读缓存**，丢失可重建

---

## 6. 与 One 系统的集成

```
One App
  │
  ├── 启动时 → memory-orchestrator.init()
  │               ├── 连接 CodeGraph 引擎
  │               ├── 连接向量库
  │               └── 验证一致性
  │
  ├── 运行时 → 每次 Agent 生成/消费记忆
  │               ├── memory-orchestrator.write(entry)
  │               └── memory-orchestrator.query(q) → top 5
  │
  └── 维护时 → memory-cli prune / memory-cli rebuild-vector
```

---

## 7. 性能目标

| 指标 | 目标 | 说明 |
|------|------|------|
| P50 查询延迟 | < 200ms | 向量粗召回 50ms + 图精排序 100ms + 融合 50ms |
| P99 查询延迟 | < 1s | 大规模图遍历上限 |
| 写入 P50 | < 100ms | 图 + 向量双写 |
| 单节点容量 | 100 万+ | 图节点 + 向量，支持剪枝 |
| 每日写入量 | 10 万+ | 活跃运行上限 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| CodeGraph 引擎不是为高频写入设计 | 写入性能瓶颈 | 写入缓冲队列 + 批量 flush |
| 双写一致性复杂 | 数据不一致 | CodeGraph 为权威源，向量可重建 |
| 图遍历在深度 > 5 后指数级增长 | 查询超时 | 设置 max_depth=5 + 超时 500ms |
| 向量模型质量影响检索效果 | 召回率低 | 支持多模型切换，内置评测集 |
