/**
 * memory-vector: 桥接测试 (连接 memory-graph 与 memory-vector)
 *
 * 验证从 MemoryDatabase 写入节点 → 自动 embedding → 向量查询的端到端流程。
 * 核心架构: 图写入 + 向量索引 = 混合检索基础
 */

import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../src/vector-store";
import * as fs from "node:fs";
import * as path from "node:path";

const CG_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "bridge-test-cg.db");
const VEC_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "bridge-test-vec.db");

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTest() {
  console.log("\n🔗 memory-graph ↔ memory-vector 桥接测试\n");

  // Cleanup
  for (const p of [CG_DB, CG_DB + "-wal", CG_DB + "-shm", VEC_DB, VEC_DB + "-wal", VEC_DB + "-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  // 1. Write memory entries via memory-graph
  const memDb = MemoryDatabase.create(CG_DB);

  const node1 = memDb.createNode({
    title: "熔断器阈值调整",
    summary: "将 CircuitBreaker 阈值从 5 改为 10 以解决支付模块频繁触发的问题",
    importance: 8,
    status: "active",
    source: "agent",
    tags: ["熔断器", "支付"],
    nodeType: "decision",
    ttlDays: null,
  });

  const node2 = memDb.createNode({
    title: "WebSocket 替代轮询",
    summary: "支付状态从轮询改为 WebSocket 长连接，减少延迟",
    importance: 7,
    status: "active",
    source: "agent",
    tags: ["支付", "架构"],
    nodeType: "decision",
    ttlDays: null,
  });

  const node3 = memDb.createNode({
    title: "首页设计讨论",
    summary: "官网首页新设计，深色模式加渐变背景",
    importance: 3,
    status: "active",
    source: "user",
    tags: ["官网", "设计"],
    nodeType: "memory_entry",
    ttlDays: 30,
  });

  assert(memDb.getStats().totalNodes === 3, "3 nodes written to graph");

  // 2. Generate mock embeddings and store in vector DB
  // In production, this would use LocalEmbedder with @xenova/transformers
  const vecStore = SqliteVectorStore.open(VEC_DB);

  // Mock embeddings with deterministic patterns:
  // - node1 and node2 have similar patterns (payment-related)
  // - node3 has a different pattern (design-related)
  const mockEmbed = (seed: number): Float32Array => {
    const v = new Float32Array(384);
    for (let i = 0; i < 384; i++) v[i] = Math.sin(i * 0.1 + seed * 0.5);
    return v;
  };

  vecStore.upsert(node1.id, mockEmbed(1), {
    nodeId: node1.id, type: "decision", title: node1.title,
    summary: node1.summary, importance: node1.importance,
    createdAt: node1.createdAt, source: node1.source,
  });
  vecStore.upsert(node2.id, mockEmbed(2), {
    nodeId: node2.id, type: "decision", title: node2.title,
    summary: node2.summary, importance: node2.importance,
    createdAt: node2.createdAt, source: node2.source,
  });
  vecStore.upsert(node3.id, mockEmbed(10), {
    nodeId: node3.id, type: "memory_entry", title: node3.title,
    summary: node3.summary, importance: node3.importance,
    createdAt: node3.createdAt, source: node3.source,
  });

  assert(vecStore.totalEntries === 3, "3 vectors stored");

  // 3. Query: find memory similar to "支付系统"
  const queryVec = mockEmbed(1.5); // Between node1 and node2
  const results = vecStore.query(queryVec, { topK: 3 });

  assert(results.length === 3, "3 results returned");
  assert(results[0].id === node1.id || results[0].id === node2.id,
    "Top results are payment-related");

  console.log(`\n  Query results (by similarity):`);
  for (const r of results) {
    console.log(`    ${r.score.toFixed(4)} | ${r.metadata.title} (${r.metadata.type})`);
  }

  // 4. Hybrid query: vector similarity + graph traversal
  // Find nodes similar to payment query, then use graph to verify code linkage
  const top2 = results.slice(0, 2);
  for (const r of top2) {
    // Simulate: check if node has code links
    const memNode = memDb.getNode(r.metadata.nodeId);
    const hasCodeLink = memNode?.tags.includes("支付");
    console.log(`\n  ${r.metadata.title}: importance=${r.metadata.importance}, payment_tag=${hasCodeLink}`);
  }

  // 5. Test filtering + importance in vector query
  const importantOnly = vecStore.query(queryVec, {
    topK: 10,
    filter: { importanceMin: 7 },
  });
  assert(importantOnly.length === 2, "Only 2 entries with importance >= 7");
  assert(importantOnly.every((r) => r.metadata.importance >= 7),
    "All results have importance >= 7");

  // Cleanup
  memDb.close();
  vecStore.close();
  for (const p of [CG_DB, CG_DB + "-wal", CG_DB + "-shm", VEC_DB, VEC_DB + "-wal", VEC_DB + "-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`\n🎉 All bridge tests passed!`);
  console.log("  memory-graph  ↔  memory-vector  ✓ 数据双写通路验证通过");
}

runTest().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
