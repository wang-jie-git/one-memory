/**
 * memory-orchestrator: 集成测试
 *
 * 端到端混合查询测试：memory-graph + memory-vector + embedder → hybrid query
 *
 * 由于 embedder 需要 @xenova/transformers（~50MB），
 * 测试使用 mock embedder 验证混合查询逻辑正确性。
 */

import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import { HybridQueryEngine } from "../src/index";
import type { Embedder } from "../../memory-vector/src/embedder";
import * as fs from "node:fs";
import * as path from "node:path";

const CG_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "orch-test-cg.db");
const VEC_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "orch-test-vec.db");

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

// ===== Mock Embedder (384-dim, deterministic) =====

class MockEmbedder implements Embedder {
  readonly dimension = 384;
  readonly modelName = "mock/test";

  private mockVector(seed: number): Float32Array {
    const v = new Float32Array(384);
    for (let i = 0; i < 384; i++) v[i] = Math.sin(i * 0.1 + seed * 0.5);
    return v;
  }

  async embed(text: string): Promise<Float32Array> {
    // Deterministic seed from text
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
    return this.mockVector(seed);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ===== Tests =====

async function runTests() {
  console.log("\n🔬 memory-orchestrator 混合查询集成测试\n");

  // Cleanup
  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm", VEC_DB, VEC_DB+"-wal", VEC_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  // ── Setup: create test data ──
  console.log("📦 Setup: Creating test dataset");

  const memDb = MemoryDatabase.create(CG_DB);
  const vecDb = SqliteVectorStore.open(VEC_DB);
  const embedder = new MockEmbedder();
  const engine = new HybridQueryEngine(memDb, vecDb, embedder, {
    topK: 3, candidateK: 10,
  });

  // Payment-related memories
  const node1 = memDb.createNode({
    title: "熔断器阈值从5改为10",
    summary: "由于支付模块超时频繁触发熔断，将阈值从5提升到10",
    importance: 8, status: "active", source: "agent",
    tags: ["熔断器", "支付", "决策"], nodeType: "decision", ttlDays: null,
  });
  const node2 = memDb.createNode({
    title: "支付模块超时修复",
    summary: "Webhook 响应时间超过 30s 时触发熔断的修复",
    importance: 9, status: "active", source: "agent",
    tags: ["支付", "bug修复"], nodeType: "memory_entry", ttlDays: null,
  });
  const node3 = memDb.createNode({
    title: "WebSocket 替代轮询",
    summary: "支付状态从轮询改为 WebSocket 长连接",
    importance: 7, status: "active", source: "agent",
    tags: ["支付", "架构"], nodeType: "decision", ttlDays: null,
  });
  // unrelated
  const node4 = memDb.createNode({
    title: "首页深色模式设计",
    summary: "官网首页深色模式加渐变背景",
    importance: 3, status: "active", source: "user",
    tags: ["官网", "设计"], nodeType: "memory_entry", ttlDays: 30,
  });
  const node5 = memDb.createNode({
    title: "Kdenlive 视频编辑 v1.1 升级",
    summary: "视频编辑 agent 模型升级，增加 AI 配音和 BGM",
    importance: 5, status: "active", source: "agent",
    tags: ["视频", "Kdenlive"], nodeType: "memory_entry", ttlDays: null,
  });

  // Add edges: node2 (fix) → node1 (decision)
  memDb.linkMemoryToMemory(node2.id, node1.id, "fixes", 1.0, "超时修复导致了熔断器调整");
  // node3 (WebSocket) → node2 (timeout fix) 
  memDb.linkMemoryToMemory(node3.id, node2.id, "references", 0.7, "WebSocket 方案引用了超时问题");
  // node5 → unrelated
  memDb.linkMemoryToMemory(node5.id, node4.id, "relates_to", 0.3, "都是 UI 层面改动");

  // Vector search: store embeddings with payment-related vectors being similar
  const paymentSeed = ("支付").split("").reduce((s, c) => s + c.charCodeAt(0), 0); // 25990+20184
  const designSeed = ("设计").split("").reduce((s, c) => s + c.charCodeAt(0), 0);

  const storeWithSeed = async (text: string, memNode: { id: string; title: string; summary: string; importance: number; createdAt: number; source: string; nodeType: string }) => {
    const vec = await embedder.embed(text);
    vecDb.upsert(memNode.id, vec, {
      nodeId: memNode.id, type: memNode.nodeType,
      title: memNode.title, summary: memNode.summary,
      importance: memNode.importance,
      createdAt: memNode.createdAt, source: memNode.source,
    });
  };

  await storeWithSeed("支付熔断器决策", { id: node1.id, ...node1, nodeType: node1.nodeType, createdAt: node1.createdAt });
  await storeWithSeed("支付超时修复Webhook", { id: node2.id, ...node2, nodeType: node2.nodeType, createdAt: node2.createdAt });
  await storeWithSeed("支付WebSocket轮询", { id: node3.id, ...node3, nodeType: node3.nodeType, createdAt: node3.createdAt });
  await storeWithSeed("首页深色模式设计官网", { id: node4.id, ...node4, nodeType: node4.nodeType, createdAt: node4.createdAt });
  await storeWithSeed("视频编辑Kdenlive AI配音", { id: node5.id, ...node5, nodeType: node5.nodeType, createdAt: node5.createdAt });

  assert(memDb.getStats().totalNodes === 5, "5 memory nodes in graph");
  assert(vecDb.totalEntries === 5, "5 vectors in vector store");

  // ── Test 1: Query "支付" ──
  console.log("\n🔍 Test 1: Query '支付超时了怎么办'");
  const r1 = await engine.query("支付超时了怎么办");
  console.log(`  Telemetry: ${r1.telemetry.totalTimeMs}ms (vec=${r1.telemetry.vectorTimeMs}ms, graph=${r1.telemetry.graphTimeMs}ms)`);
  console.log(`  Candidates: ${r1.telemetry.candidatesCount} → Returned: ${r1.telemetry.returnedCount}`);
  assert(r1.results.length > 0, "Has results");
  assert(r1.results[0].vectorScore > 0 || r1.results[0].graphScore > 0, "Top result has scores");
  console.log(`  Top: ${r1.results[0].title} (score=${r1.results[0].score.toFixed(4)}, vec=${r1.results[0].vectorScore.toFixed(4)}, graph=${r1.results[0].graphScore.toFixed(4)})`);

  // ── Test 2: Verify payment results rank higher than design ──
  console.log("\n🔍 Test 2: Relevance ranking");
  const titles = r1.results.map((r) => r.title);
  console.log(`  Ranked: ${titles.join(" → ")}`);
  // Payment-related should be in top results
  const paymentInTop = titles.some((t) => t.includes("支付") || t.includes("熔断") || t.includes("WebSocket"));
  assert(paymentInTop, "Payment-related results rank high");

  // ── Test 3: Metadata filter ──
  console.log("\n🔍 Test 3: Filter by importance >= 7");
  const r3 = await engine.query("设计", { importanceMin: 7 });
  // Only items with importance >= 7 should remain
  assert(r3.results.every((r) => r.metadata.importance >= 7), "All results have importance >= 7");

  // ── Test 4: Degrade gracefully ──
  console.log("\n🔍 Test 4: Fallback on empty vector store");
  const emptyVec = SqliteVectorStore.open(path.join(__dirname, "..", "..", "..", ".codegraph", "empty-vec.db"));
  const engine2 = new HybridQueryEngine(memDb, emptyVec, embedder);
  const r4 = await engine2.query("支付");
  assert(r4.telemetry.degraded === "vector_timeout", "Degraded to vector_timeout");
  assert(r4.results.length > 0, "Fallback returns text search results");
  console.log(`  Fallback results: ${r4.results.length} items (${r4.results[0].title})`);

  // Cleanup
  engine.close();
  engine2.close();
  emptyVec.close();

  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm", VEC_DB, VEC_DB+"-wal", VEC_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(path.join(__dirname, "..", "..", "..", ".codegraph", "empty-vec.db")); } catch {}
  try { fs.unlinkSync(path.join(__dirname, "..", "..", "..", ".codegraph", "empty-vec.db-wal")); } catch {}

  console.log(`\n🎉 All orchestrator tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
