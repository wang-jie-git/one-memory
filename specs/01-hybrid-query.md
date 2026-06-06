# Spec 01: Hybrid Query Flow

**状态**: Draft | **优先级**: P0 | **最后更新**: 2026-06-06

## 1. 查询入口

```typescript
async function queryMemory(
  query: string,
  options?: {
    topK?: number;              // 最终返回数量，默认 5
    candidateK?: number;        // 粗召回数量，默认 20
    alpha?: number;             // 向量权重，默认 0.4
    beta?: number;              // 图权重，默认 0.4
    gamma?: number;             // 时效权重，默认 0.2
    maxDepth?: number;          // 图遍历深度，默认 3
    timeoutMs?: number;         // 查询超时，默认 1000
    filter?: {                  // 过滤条件
      importanceMin?: number;
      type?: string[];
      source?: string[];
      timeRange?: [number, number];
    };
  }
): Promise<MemoryQueryResult[]>;
```

## 2. 完整流程

```
queryMemory("支付模块超时修复")
    │
    ├── Step 1: 向量粗召回
    │   ├── embed(query) → query_vector
    │   ├── vector_store.query(query_vector, candidateK=20)
    │   └── candidates = [{node_id, score, metadata}, ...]
    │       ( 耗时目标: < 50ms )
    │
    ├── Step 2: 图遍历精排序
    │   ├── for each candidate:
    │   │   ├── codegraph_node(node_id)
    │   │   ├── codegraph_callers(node_id)    // 谁引用了这段记忆
    │   │   ├── codegraph_callees(node_id)    // 这段记忆引用了谁
    │   │   └── graph_relevance ← compute graph score
    │   └── candidates_with_graph = [{node_id, vector_score, graph_score}, ...]
    │       ( 耗时目标: < 100ms for 20 candidates, depth=3 )
    │
    ├── Step 3: 融合重排序
    │   ├── for each candidate:
    │   │   ├── recency = computeRecency(timestamp)  // 24h=1.0, 7d=0.8, 30d=0.5, 90d=0.2
    │   │   └── final = α*vector + β*graph + γ*recency
    │   └── sorted = candidates.sort(desc final)
    │
    └── Step 4: 返回 TOP K
        └── [{node_id, title, summary, score, relations}, ...]
        ( 耗时目标: < 50ms )
```

## 3. 超时与降级

| 场景 | 行为 |
|------|------|
| 图遍历超时 | 降级为纯向量检索，返回向量 TOP 5，标记 `degraded: "graph_timeout"` |
| 向量查询超时 | 降级为纯图遍历，使用 Graph Breadth-First 搜索返回 TOP 5 |
| 两者都超时 | 返回空结果 + 错误码 |
| 向量库为空 | 降级为纯图遍历 |
| 图为空 | 降级为纯向量检索 |

## 4. 缓存策略

- 相同 query 的向量 embedding 结果缓存 5 分钟（LRU, 最大 1000 条）
- 图遍历结果不缓存（实时性要求高）
- 融合打分结果不缓存

## 5. 监控埋点

每次查询必须记录：
- `query_time_ms`: 总耗时
- `vector_time_ms`: 向量阶段耗时
- `graph_time_ms`: 图阶段耗时
- `candidates_count`: 粗召回数量
- `degraded`: 是否降级
- `top1_score`: 最高分
