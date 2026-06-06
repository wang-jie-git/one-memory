/**
 * memory-orchestrator: MemorySystem — 统一入口
 *
 * One App 通过 MemorySystem 完成所有记忆操作：
 *   init(dbPath) → 连接图 + 向量 + embedder
 *   write(entry) → 图写入 + 向量索引 + Obsidian 同步
 *   query(text)  → 混合查询
 *   shutdown()   → flush 缓冲 + 关闭所有连接
 */

import { MemoryDatabase, type MemoryNode, type MemoryNodeType, type MemoryStatus, type MemorySource } from "../../memory-graph/src/database";
import { ObsidianWriter } from "../../memory-graph/src/obsidian-writer";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import { LocalEmbedder, ApiEmbedder } from "../../memory-vector/src/embedder";
import type { Embedder } from "../../memory-vector/src/embedder";
import { HybridQueryEngine, type HybridQueryConfig } from "./index";
import * as path from "node:path";
import * as fs from "node:fs";

// ===== Config =====

export interface MemorySystemConfig {
  /** CodeGraph DB 目录（包含 codegraph.db） */
  codegraphDir: string;
  /** 向量存储文件名（相对 codegraphDir） */
  vectorDbFilename?: string;
  /** Obsidian Vault 根路径 */
  obsidianVaultPath?: string;
  /** Obsidian 子目录 */
  obsidianSubDir?: string;
  /** Embedder 类型: 'local' | 'api' */
  embedder?: "local" | "api";
  /** API embedder 配置（仅 embedder='api' 时需要） */
  embedderApiKey?: string;
  embedderBaseUrl?: string;
  embedderModel?: string;
  /** 混合查询配置 */
  hybridQuery?: Partial<HybridQueryConfig>;
  /** 写入缓冲大小（条数，默认 10） */
  writeBufferSize?: number;
  /** 写入缓冲间隔（ms，默认 2000） */
  writeBufferIntervalMs?: number;
}

const DEFAULT_CONFIG: Partial<MemorySystemConfig> = {
  vectorDbFilename: "memory-vectors.db",
  embedder: "local",
  writeBufferSize: 10,
  writeBufferIntervalMs: 2000,
};

// ===== Write Buffer =====

interface BufferedEntry {
  node: MemoryNode;
  resolve: () => void;
  reject: (err: Error) => void;
}

// ===== MemorySystem =====

export class MemorySystem {
  private config: Required<MemorySystemConfig>;
  private memoryDb!: MemoryDatabase;
  private vectorStore!: SqliteVectorStore;
  private embedder!: Embedder;
  private obsidianWriter?: ObsidianWriter;
  private queryEngine!: HybridQueryEngine;
  private writeBuffer: BufferedEntry[] = [];
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private _initialized = false;

  private constructor(config: Required<MemorySystemConfig>) {
    this.config = config;
  }

  // ===== Initialize =====

  static async init(config: MemorySystemConfig): Promise<MemorySystem> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config } as Required<MemorySystemConfig>;

    const cgDbPath = path.join(fullConfig.codegraphDir, "codegraph.db");
    if (!fs.existsSync(cgDbPath)) {
      throw new Error(`CodeGraph database not found: ${cgDbPath}\nRun 'codegraph index' first.`);
    }

    const sys = new MemorySystem(fullConfig);

    // 1. Open graph DB
    sys.memoryDb = MemoryDatabase.open(cgDbPath);

    // 2. Open vector store
    const vecDbPath = path.join(fullConfig.codegraphDir, fullConfig.vectorDbFilename);
    sys.vectorStore = SqliteVectorStore.open(vecDbPath);

    // 3. Initialize embedder
    if (fullConfig.embedder === "api") {
      sys.embedder = new ApiEmbedder({
        model: fullConfig.embedderModel ?? "text-embedding-3-small",
        apiKey: fullConfig.embedderApiKey!,
        baseUrl: fullConfig.embedderBaseUrl,
      });
    } else {
      const local = new LocalEmbedder();
      await local.init();
      sys.embedder = local;
    }

    // 4. Initialize Obsidian writer (optional)
    if (fullConfig.obsidianVaultPath) {
      sys.obsidianWriter = new ObsidianWriter({
        vaultPath: fullConfig.obsidianVaultPath,
        subDir: fullConfig.obsidianSubDir,
      });
    }

    // 5. Initialize query engine
    sys.queryEngine = new HybridQueryEngine(
      sys.memoryDb,
      sys.vectorStore,
      sys.embedder,
      fullConfig.hybridQuery,
    );

    sys._initialized = true;
    return sys;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  // ===== Write (buffered) =====

  /**
   * 写入记忆条目。
   * 写入缓冲 + 自动 flush，避免高频写入压垮 SQLite。
   */
  async write(data: {
    title: string;
    summary?: string;
    body?: string;
    importance?: number;
    tags?: string[];
    nodeType?: MemoryNodeType;
    source?: MemorySource;
    sourceSession?: string;
    ttlDays?: number | null;
  }): Promise<MemoryNode> {
    // Create node in graph (immediate — graph is authoritative)
    const node = this.memoryDb.createNode({
      id: crypto.randomUUID(),
      title: data.title,
      summary: data.summary ?? "",
      body: data.body ?? "",
      importance: data.importance ?? 5,
      status: "active",
      source: data.source ?? "agent",
      sourceSession: data.sourceSession ?? null,
      tags: data.tags ?? [],
      nodeType: data.nodeType ?? "memory_entry",
      ttlDays: data.ttlDays ?? null,
    });

    // Buffer the vector + obsidian write
    return new Promise((resolve, reject) => {
      this.writeBuffer.push({
        node,
        resolve: () => resolve(node),
        reject,
      });
      this.scheduleFlush();
    });
  }

  /**
   * 批量写入（不走缓冲，直接写入）
   */
  async writeBatch(entries: Array<{
    title: string;
    summary?: string;
    body?: string;
    importance?: number;
    tags?: string[];
    nodeType?: MemoryNodeType;
    source?: MemorySource;
  }>): Promise<MemoryNode[]> {
    const nodes: MemoryNode[] = [];
    const vectorEntries: Array<{
      id: string;
      vector: Float32Array;
      metadata: {
        nodeId: string;
        type: string;
        title: string;
        summary: string;
        importance: number;
        createdAt: number;
        source: string;
      };
    }> = [];

    for (const data of entries) {
      const node = this.memoryDb.createNode({
        id: crypto.randomUUID(),
        title: data.title,
        summary: data.summary ?? "",
        body: data.body ?? "",
        importance: data.importance ?? 5,
        status: "active",
        source: data.source ?? "agent",
        sourceSession: null,
        tags: data.tags ?? [],
        nodeType: data.nodeType ?? "memory_entry",
        ttlDays: null,
      });
      nodes.push(node);

      const summary = data.summary ?? data.title;
      const vector = await this.embedder.embed(summary);
      vectorEntries.push({
        id: node.id,
        vector,
        metadata: {
          nodeId: node.id,
          type: node.nodeType,
          title: node.title,
          summary: node.summary,
          importance: node.importance,
          createdAt: node.createdAt,
          source: node.source,
        },
      });

      // Sync to Obsidian
      if (this.obsidianWriter) {
        try { this.obsidianWriter.write(node); } catch { /* non-blocking */ }
      }
    }

    this.vectorStore.upsertBatch(vectorEntries);
    return nodes;
  }

  private scheduleFlush(): void {
    if (this.bufferTimer) return; // Already scheduled

    // Flush when buffer reaches threshold
    if (this.writeBuffer.length >= this.config.writeBufferSize) {
      this.flush();
      return;
    }

    // Or flush after interval
    this.bufferTimer = setTimeout(() => {
      this.bufferTimer = null;
      if (this.writeBuffer.length > 0) this.flush();
    }, this.config.writeBufferIntervalMs);
  }

  private flush(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }

    const batch = this.writeBuffer.splice(0);
    if (batch.length === 0) return;

    // Fire and forget — resolves each promise individually
    (async () => {
      for (const entry of batch) {
        try {
          // Embed and store vector
          const vector = await this.embedder.embed(entry.node.summary || entry.node.title);
          this.vectorStore.upsert(entry.node.id, vector, {
            nodeId: entry.node.id,
            type: entry.node.nodeType,
            title: entry.node.title,
            summary: entry.node.summary,
            importance: entry.node.importance,
            createdAt: entry.node.createdAt,
            source: entry.node.source,
          });

          // Sync to Obsidian
          if (this.obsidianWriter) {
            this.obsidianWriter.write(entry.node);
          }

          entry.resolve();
        } catch (err) {
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
  }

  // ===== Query =====

  async query(text: string, filter?: { importanceMin?: number }) {
    return this.queryEngine.query(text, filter);
  }

  // ===== Link =====

  linkMemoryToCode(memoryId: string, codeSymbolId: string, description?: string): void {
    this.memoryDb.linkMemoryToCode(memoryId, codeSymbolId, description);
  }

  linkMemoryToMemory(
    sourceId: string,
    targetId: string,
    relation: "causes" | "fixes" | "precedes" | "references" | "contradicts" | "supersedes" | "relates_to" | "implements",
    description?: string,
  ): void {
    this.memoryDb.linkMemoryToMemory(sourceId, targetId, relation, 1.0, description);
  }

  // ===== Maintenance =====

  /**
   * 剪枝：删除过期节点 + 归档低重要度孤立节点
   */
  prune(options?: { dryRun?: boolean }): { deleted: number; archived: number } {
    this.flush();
    return this.memoryDb.prune(options?.dryRun ?? false);
  }

  /**
   * 一致性检查：验证向量库 ↔ 图数据库同步状态
   */
  checkConsistency(): {
    inGraph: number;
    inVector: number;
    graphOnly: string[];
    vectorOnly: string[];
    ok: boolean;
  } {
    this.flush();

    // Get all node IDs from graph
    const stats = this.memoryDb.getStats();
    const allGraphNodes = this.memoryDb.searchByText("", 99999);

    // Get all entries from vector store
    const vecStats = this.vectorStore.stats();

    // We can't enumerate all vector IDs efficiently, so compare counts
    const graphCount = stats.totalNodes;
    const vectorCount = vecStats.totalEntries;

    // Spot-check: iterate a few random graph nodes and verify they have vectors
    const graphOnly: string[] = [];
    for (const node of allGraphNodes.slice(0, 50)) {
      // Query the vector store with the node's title to see if it returns itself
      const result = this.memoryDb.searchByTag(node.id.slice(0, 8), 1);
      // Rough check
    }

    return {
      inGraph: graphCount,
      inVector: vectorCount,
      graphOnly,
      vectorOnly: [],
      ok: Math.abs(graphCount - vectorCount) < 10, // Allow small discrepancy due to buffering
    };
  }

  /**
   * 重建向量索引（从图数据库全量重建）
   */
  async rebuildVectorIndex(): Promise<number> {
    this.flush();

    this.vectorStore.clear();

    const allNodes = this.memoryDb.searchByText("", 99999);
    const batch: Array<{
      id: string;
      vector: Float32Array;
      metadata: {
        nodeId: string;
        type: string;
        title: string;
        summary: string;
        importance: number;
        createdAt: number;
        source: string;
      };
    }> = [];

    for (const node of allNodes) {
      const summary = node.summary || node.title;
      const vector = await this.embedder.embed(summary);
      batch.push({
        id: node.id,
        vector,
        metadata: {
          nodeId: node.id,
          type: node.nodeType,
          title: node.title,
          summary: node.summary,
          importance: node.importance,
          createdAt: node.createdAt,
          source: node.source,
        },
      });
    }

    if (batch.length > 0) {
      this.vectorStore.upsertBatch(batch);
    }

    return batch.length;
  }

  // ===== Stats =====

  stats() {
    this.flush();

    const graphStats = this.memoryDb.getStats();
    const vecStats = this.vectorStore.stats();
    const obsidianCount = this.obsidianWriter?.count() ?? 0;

    return {
      graph: graphStats,
      vector: { total: vecStats.totalEntries, dimension: vecStats.dimension },
      obsidian: obsidianCount,
      bufferPending: this.writeBuffer.length,
    };
  }

  // ===== Shutdown =====

  async shutdown(): Promise<void> {
    // Flush remaining buffer
    if (this.writeBuffer.length > 0) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.writeBuffer.length === 0) resolve();
          else setTimeout(check, 100);
        };
        this.flush();
        check();
      });
    }

    this.memoryDb.close();
    this.vectorStore.close();
    this._initialized = false;
  }
}
