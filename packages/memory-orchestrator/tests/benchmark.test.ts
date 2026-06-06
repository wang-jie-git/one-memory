/**
 * memory-orchestrator: 性能基准测试
 *
 * 测量核心操作的延迟，建立性能基线。
 * 目标: P50 < 200ms, P99 < 1s
 */

import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import { HybridQueryEngine } from "../src/index";
import type { Embedder } from "../../memory-vector/src/embedder";
import * as path from "node:path";
import * as fs from "node:fs";

const CG_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "bench-cg.db");
const VEC_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "bench-vec.db");

// ===== Mock Embedder =====

class MockEmbedder implements Embedder {
  readonly dimension = 384;
  readonly modelName = "mock/bench";

  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(384);
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
    for (let i = 0; i < 384; i++) v[i] = Math.sin(i * 0.1 + seed * 0.001);
    return v;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ===== Helpers =====

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function p99(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.99) - 1];
}

function p50(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ===== Benchmark =====

async function runBenchmark() {
  console.log("\n📊 One Memory 性能基准测试\n");
  console.log("  环境: Node.js " + process.version + "\n");

  // Cleanup
  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm", VEC_DB, VEC_DB+"-wal", VEC_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  const memDb = MemoryDatabase.create(CG_DB);
  const vecDb = SqliteVectorStore.open(VEC_DB);
  const embedder = new MockEmbedder();
  const engine = new HybridQueryEngine(memDb, vecDb, embedder, {
    topK: 5,
    candidateK: 20,
  });

  // ── Benchmark 1: Write throughput ──
  console.log("─── Benchmark 1: Write throughput ───\n");

  const writeTimes: number[] = [];
  const BATCH = 100;

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < BATCH; i++) {
    const t = process.hrtime.bigint();
    const node = memDb.createNode({
      title: `基准测试条目 #${i}`,
      summary: `这是第 ${i} 条基准测试记忆条目`,
      importance: Math.floor(Math.random() * 10) + 1,
      status: "active",
      source: i % 2 === 0 ? "agent" : "user",
      tags: ["benchmark", `tag-${i % 5}`],
      nodeType: "memory_entry",
      ttlDays: null,
    });

    const vec = await embedder.embed(node.title);
    vecDb.upsert(node.id, vec, {
      nodeId: node.id, type: "memory_entry",
      title: node.title, summary: node.summary,
      importance: node.importance, createdAt: node.createdAt, source: node.source,
    });
    writeTimes.push(elapsedMs(t));
  }
  const writeTotal = elapsedMs(t0);

  console.log(`  写入 ${BATCH} 条记忆:`);
  console.log(`    总耗时:    ${writeTotal.toFixed(0)}ms`);
  console.log(`    吞吐:      ${(BATCH / writeTotal * 1000).toFixed(0)} 条/秒`);
  console.log(`    P50:       ${p50(writeTimes).toFixed(1)}ms`);
  console.log(`    P99:       ${p99(writeTimes).toFixed(1)}ms`);

  // ── Benchmark 2: Batch write ──
  console.log("\n─── Benchmark 2: Batch write (10条/批) ───\n");

  const batchTimes: number[] = [];
  for (let b = 0; b < 10; b++) {
    const t = process.hrtime.bigint();
    const batch: Array<{
      id: string; vector: Float32Array; metadata: {
        nodeId: string; type: string; title: string; summary: string;
        importance: number; createdAt: number; source: string;
      };
    }> = [];
    for (let i = 0; i < 10; i++) {
      const idx = BATCH + b * 10 + i;
      const node = memDb.createNode({
        title: `批量测试 #${idx}`, summary: `批量测试条目 ${idx}`,
        importance: 5, status: "active", source: "system",
        tags: ["batch"], nodeType: "memory_entry", ttlDays: null,
      });
      const vec = await embedder.embed(node.title);
      batch.push({
        id: node.id, vector: vec, metadata: {
          nodeId: node.id, type: "memory_entry", title: node.title,
          summary: node.summary, importance: 5,
          createdAt: node.createdAt, source: "system",
        },
      });
    }
    vecDb.upsertBatch(batch);
    batchTimes.push(elapsedMs(t));
  }

  console.log(`  批次 x10 (100条):`);
  console.log(`    P50:       ${p50(batchTimes).toFixed(1)}ms`);
  console.log(`    P99:       ${p99(batchTimes).toFixed(1)}ms`);

  // ── Benchmark 3: Query latency ──
  console.log("\n─── Benchmark 3: Query latency ───\n");

  const queryTexts = ["基准测试", "测试", "memory", "batch", "tag-1", "条目", "系统", "性能"];
  const queryTimes: number[] = [];

  for (let i = 0; i < 50; i++) {
    const text = queryTexts[i % queryTexts.length];
    const t = process.hrtime.bigint();
    await engine.query(text);
    queryTimes.push(elapsedMs(t));
  }

  console.log(`  查询 50 次:`);
  console.log(`    P50:       ${p50(queryTimes).toFixed(1)}ms`);
  console.log(`    P99:       ${p99(queryTimes).toFixed(1)}ms`);
  console.log(`    最快:      ${Math.min(...queryTimes).toFixed(1)}ms`);
  console.log(`    最慢:      ${Math.max(...queryTimes).toFixed(1)}ms`);

  // ── Benchmark 4: Vector brute-force search vs dataset size ──
  console.log("\n─── Benchmark 4: Vector search vs dataset size ───\n");

  const currentCount = vecDb.totalEntries;
  console.log(`  当前向量数: ${currentCount}`);

  const sizes: number[] = [];
  const searchTimes: number[] = [];

  // Query against the full dataset
  const queryVec = await embedder.embed("性能测试查询");
  for (let trial = 0; trial < 20; trial++) {
    const t = process.hrtime.bigint();
    vecDb.query(queryVec, { topK: 5 });
    searchTimes.push(elapsedMs(t));
  }

  console.log(`  暴力搜索 (${currentCount}条, topK=5):`);
  console.log(`    P50:       ${p50(searchTimes).toFixed(2)}ms`);
  console.log(`    P99:       ${p99(searchTimes).toFixed(2)}ms`);

  // ── Benchmark 5: Graph traversal ──
  console.log("\n─── Benchmark 5: Graph traversal ───\n");

  // Create some edges
  const allNodes = memDb.searchByText("", 100);
  const traversalTimes: number[] = [];
  for (let i = 0; i < Math.min(allNodes.length, 50); i++) {
    // Link consecutive nodes
    if (i > 0) {
      memDb.linkMemoryToMemory(allNodes[i].id, allNodes[i - 1].id, "precedes", 0.5);
    }
  }
  for (let i = 0; i < 50; i++) {
    const node = allNodes[i % allNodes.length];
    const t = process.hrtime.bigint();
    memDb.getRelatedMemories(node.id, { depth: 1 });
    traversalTimes.push(elapsedMs(t));
  }

  console.log(`  图遍历 (depth=1):`);
  console.log(`    P50:       ${p50(traversalTimes).toFixed(1)}ms`);
  console.log(`    P99:       ${p99(traversalTimes).toFixed(1)}ms`);

  // ── Benchmark 6: Text search ──
  console.log("\n─── Benchmark 6: Text search ───\n");

  const textSearchTimes: number[] = [];
  for (let i = 0; i < 50; i++) {
    const q = queryTexts[i % queryTexts.length];
    const t = process.hrtime.bigint();
    memDb.searchByText(q, 20);
    textSearchTimes.push(elapsedMs(t));
  }

  console.log(`  文本搜索 (LIKE):`);
  console.log(`    P50:       ${p50(textSearchTimes).toFixed(1)}ms`);
  console.log(`    P99:       ${p99(textSearchTimes).toFixed(1)}ms`);

  // ── Summary ──
  console.log("\n─── 基准测试总结 ───\n");
  console.log("  ┌──────────────────────┬──────────┬──────────┐");
  console.log("  │ 指标                 │ P50      │ P99      │");
  console.log("  ├──────────────────────┼──────────┼──────────┤");
  console.log(`  │ 单条写入              │ ${p50(writeTimes).toFixed(0).padStart(5)}ms   │ ${p99(writeTimes).toFixed(0).padStart(5)}ms   │`);
  console.log(`  │ 批量写入(10条)        │ ${p50(batchTimes).toFixed(0).padStart(5)}ms   │ ${p99(batchTimes).toFixed(0).padStart(5)}ms   │`);
  console.log(`  │ 混合查询              │ ${p50(queryTimes).toFixed(0).padStart(5)}ms   │ ${p99(queryTimes).toFixed(0).padStart(5)}ms   │`);
  console.log(`  │ 向量搜索              │ ${p50(searchTimes).toFixed(1).padStart(6)}ms │ ${p99(searchTimes).toFixed(1).padStart(6)}ms │`);
  console.log(`  │ 图遍历                │ ${p50(traversalTimes).toFixed(0).padStart(5)}ms   │ ${p99(traversalTimes).toFixed(0).padStart(5)}ms   │`);
  console.log(`  │ 文本搜索              │ ${p50(textSearchTimes).toFixed(0).padStart(5)}ms   │ ${p99(textSearchTimes).toFixed(0).padStart(5)}ms   │`);
  console.log("  └──────────────────────┴──────────┴──────────┘");

  // Cleanup
  engine.close();
  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm", VEC_DB, VEC_DB+"-wal", VEC_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`\n  ✅ 基准测试完成`);
}

runBenchmark().catch((err) => {
  console.error("\n❌ Benchmark failed:", err.message);
  process.exit(1);
});
