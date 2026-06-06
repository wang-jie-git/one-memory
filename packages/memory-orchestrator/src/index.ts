// One Memory — 混合查询编排器
// 本文件定义 HybridQuery Engine 的核心逻辑

import type { MemoryGraphAPI, MemoryGraphQueryResult, MemoryEntry } from "@one/memory-graph";
import type { VectorStore, VectorResult } from "@one/memory-vector";

// === 配置 ===

export interface HybridQueryConfig {
  alpha: number;         // 向量相似度权重 (default 0.4)
  beta: number;          // 图关联度权重 (default 0.4)
  gamma: number;         // 时效性权重 (default 0.2)
  topK: number;          // 最终返回数量 (default 5)
  candidateK: number;    // 粗召回数量 (default 20)
  maxGraphDepth: number; // 图遍历深度 (default 3)
  timeoutMs: number;     // 查询超时 (default 1000)
}

export const DEFAULT_CONFIG: HybridQueryConfig = {
  alpha: 0.4,
  beta: 0.4,
  gamma: 0.2,
  topK: 5,
  candidateK: 20,
  maxGraphDepth: 3,
  timeoutMs: 1000,
};

// === 查询结果 ===

export interface MemoryQueryResult {
  nodeId: string;
  title: string;
  summary: string;
  score: number;
  vectorScore: number;
  graphScore: number;
  recencyScore: number;
  relations: Array<{
    type: string;
    direction: "incoming" | "outgoing";
    strength: number;
  }>;
  metadata: {
    type: string;
    tags: string[];
    importance: number;
    created_at: number;
    source: string;
  };
}

export interface QueryTelemetry {
  totalTimeMs: number;
  vectorTimeMs: number;
  graphTimeMs: number;
  candidatesCount: number;
  degraded: false | "graph_timeout" | "vector_timeout" | "both_timeout" | "vector_empty" | "graph_empty";
  top1Score: number;
}

export interface HybridQueryResponse {
  results: MemoryQueryResult[];
  telemetry: QueryTelemetry;
}

// === 查询引擎 ===

export class HybridQueryEngine {
  private config: HybridQueryConfig;
  private graphAPI: MemoryGraphAPI;
  private vectorStore: VectorStore;

  constructor(
    graphAPI: MemoryGraphAPI,
    vectorStore: VectorStore,
    config: Partial<HybridQueryConfig> = {},
  ) {
    this.graphAPI = graphAPI;
    this.vectorStore = vectorStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async query(query: string, filter?: VectorQueryOptions["filter"]): Promise<HybridQueryResponse> {
    // Step 1: 向量粗召回
    // Step 2: 图遍历精排序
    // Step 3: 融合重排序
    // Step 4: 返回 TOP K
    throw new Error("Not implemented yet — Phase 1 target");
  }

  private computeRecency(timestamp: number): number {
    const now = Date.now();
    const ageMs = now - timestamp;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < 1) return 1.0;
    if (ageDays < 7) return 0.8;
    if (ageDays < 30) return 0.5;
    if (ageDays < 90) return 0.2;
    return 0.1;
  }

  private computeGraphScore(node: MemoryEntry, candidates: VectorResult[]): number {
    // 1. 代码关联度: 命中相关代码符号数 / 总符号数
    // 2. 因果链: 目标节点与查询主题的图距离
    // 3. 引用热度: 入边数 / 最大入边数
    throw new Error("Not implemented yet — Phase 1 target");
  }
}
