# Spec 03: Vector Engine Interface

**状态**: Draft | **优先级**: P0 | **最后更新**: 2026-06-06

## 1. 抽象接口

```typescript
// === 核心接口 ===

interface VectorStore {
  // 生命周期
  init(): Promise<void>;
  close(): Promise<void>;
  
  // 写入
  embed(text: string): Promise<Float32Array>;
  upsert(id: string, vector: Float32Array, metadata: VectorMetadata): Promise<void>;
  upsertBatch(entries: VectorEntry[]): Promise<void>;
  delete(id: string): Promise<void>;
  
  // 查询
  query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorResult[]>;
  
  // 维护
  stats(): Promise<VectorStoreStats>;
  rebuildIndex(): Promise<void>;
  flush(): Promise<void>;
}

// === 类型定义 ===

type VectorMetadata = {
  node_id: string;               // CodeGraph 节点 ID（必填）
  type: string;                  // memory_entry / decision / project_milestone
  title: string;
  summary: string;
  tags: string[];
  importance: number;
  created_at: number;
  source: string;
};

type VectorEntry = {
  id: string;
  vector: Float32Array;
  metadata: VectorMetadata;
};

type VectorQueryOptions = {
  topK: number;                  // 返回数量
  filter?: {                     // metadata 过滤
    type?: string[];
    importanceMin?: number;
    source?: string[];
    tags?: string[];
    timeRange?: [number, number];
  };
  scoreThreshold?: number;       // 最低相似度阈值
};

type VectorResult = {
  id: string;
  score: number;                 // 余弦相似度 0-1
  metadata: VectorMetadata;
};

type VectorStoreStats = {
  totalEntries: number;
  dimension: number;
  memoryUsageBytes: number;
  indexType: string;
};
```

## 2. Embedding 模型

### 2.1 接口

```typescript
interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
  dimension: number;
  modelName: string;
  maxTokens: number;
}
```

### 2.2 推荐模型

| 阶段 | 模型 | 维度 | 说明 |
|------|------|------|------|
| MVP | `all-MiniLM-L6-v2` | 384 | 本地运行，CPU 友好，质量够用 |
| Beta | `BAAI/bge-small-zh-v1.5` | 512 | 中文优化，本地运行 |
| GA | `text-embedding-3-small` | 512 | OpenAI，质量最佳，有成本 |
| GA | `bge-m3` | 1024 | BAAI 多语言，可本地 |

### 2.3 策略

```
默认使用 local embedder（all-MiniLM-L6-v2），
当 MEMORY_EMBEDDING_PROVIDER=openai 时切换。
切换时需重建全部向量索引。
```

## 3. 实现方案

### 3.1 SQLite + sqlite-vec（MVP）

```sql
-- 向量表
CREATE TABLE vectors (
  id TEXT PRIMARY KEY,           -- UUID，对应 memory_entry.id
  vector BLOB NOT NULL,          -- Float32Array 字节流
  metadata_json TEXT NOT NULL,   -- JSON 序列化的 VectorMetadata
  created_at INTEGER NOT NULL
);

-- 虚拟表（sqlite-vec）
CREATE VIRTUAL TABLE vec_index USING vec0(
  id TEXT PRIMARY KEY,
  vector float[384]               -- 维度与模型对齐
  -- 或 float[512], float[1024]
);

-- 查询
SELECT v.id, distance, metadata_json
FROM vec_index WHERE vector MATCH ?
  AND k = 20
ORDER BY distance;
```

### 3.2 ChromaDB（Beta）

```python
collection = client.get_or_create_collection(
    name="one_memory",
    embedding_function=None,  # 我们外部做 embedding
    metadata={"hnsw:space": "cosine"}
)

collection.add(
    ids=[entry.id],
    embeddings=[entry.vector],
    metadatas=[entry.metadata]
)

results = collection.query(
    query_embeddings=[query_vector],
    n_results=20,
    where={"importance": {"$gte": 3}}
)
```

## 4. 同步策略

| 事件 | 向量操作 |
|------|---------|
| 写入 MemoryEntry | 异步 upsert（队列，延迟 < 1s） |
| 更新 MemoryEntry | 更新向量 + metadata |
| 删除 MemoryEntry | 删除向量 |
| 重建 | 从 CodeGraph 全量遍历 → re-embed → 全量 upsert |
| 模型切换 | 全部删除 → 重建 |
