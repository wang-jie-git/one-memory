// One Memory — 语义向量引擎适配层
// 本文件定义 VectorStore 抽象接口和类型

// === 核心类型 ===

export interface VectorMetadata {
  node_id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  importance: number;
  created_at: number;
  source: string;
}

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  metadata: VectorMetadata;
}

export interface VectorQueryOptions {
  topK: number;
  filter?: {
    type?: string[];
    importanceMin?: number;
    source?: string[];
    tags?: string[];
    timeRange?: [number, number];
  };
  scoreThreshold?: number;
}

export interface VectorResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

export interface VectorStoreStats {
  totalEntries: number;
  dimension: number;
  memoryUsageBytes: number;
  indexType: string;
}

// === Embedder 接口 ===

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dimension: number;
  readonly modelName: string;
  readonly maxTokens: number;
}

// === VectorStore 抽象接口 ===

export interface VectorStore {
  init(): Promise<void>;
  close(): Promise<void>;

  embed(text: string): Promise<Float32Array>;
  upsert(id: string, vector: Float32Array, metadata: VectorMetadata): Promise<void>;
  upsertBatch(entries: VectorEntry[]): Promise<void>;
  delete(id: string): Promise<void>;

  query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorResult[]>;

  stats(): Promise<VectorStoreStats>;
  rebuildIndex(): Promise<void>;
  flush(): Promise<void>;
}

// === 默认导出 ===
export function createVectorStore(): VectorStore {
  throw new Error("Not implemented yet — Phase 1 target");
}
