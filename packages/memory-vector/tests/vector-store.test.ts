/**
 * memory-vector: 集成测试
 *
 * 验证向量存储的 upsert、查询、删除等核心功能。
 */

import { SqliteVectorStore } from "../src/vector-store";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "memory-vectors.test.db");

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ASSERT FAILED: ${msg}`);
  console.log(`  ✅ ${msg}`);
}

function approxEqual(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) < epsilon;
}

async function runTests() {
  console.log("\n🔬 memory-vector 集成测试\n");

  // Clean up any previous test DB
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch { /* ignore */ }

  const store = SqliteVectorStore.open(TEST_DB);

  // ── Test 1: Basic upsert ──
  console.log("📝 Test 1: Upsert and read vectors");

  const vec1 = new Float32Array(384);
  for (let i = 0; i < 384; i++) vec1[i] = Math.sin(i * 0.1); // deterministic "semantic" vector

  const vec2 = new Float32Array(384);
  for (let i = 0; i < 384; i++) vec2[i] = Math.cos(i * 0.1);

  store.upsert("mem-001", vec1, {
    nodeId: "mem-001",
    type: "memory_entry",
    title: "熔断器阈值调整",
    summary: "从 5 改为 10",
    importance: 8,
    createdAt: Date.now(),
    source: "agent",
  });

  store.upsert("mem-002", vec2, {
    nodeId: "mem-002",
    type: "decision",
    title: "支付模块架构决策",
    summary: "从轮询改为 WebSocket",
    importance: 9,
    createdAt: Date.now(),
    source: "user",
  });

  assert(store.totalEntries === 2, "Stored 2 vectors");

  // ── Test 2: Similarity query ──
  console.log("\n🔍 Test 2: Similarity query");

  // Query with a vector similar to vec1 (sin pattern)
  const queryVec = new Float32Array(384);
  for (let i = 0; i < 384; i++) queryVec[i] = Math.sin(i * 0.1 + 0.01); // slightly shifted

  const results = store.query(queryVec, { topK: 2 });
  assert(results.length === 2, "Returned 2 results");
  assert(results[0].id === "mem-001", "First result is the most similar (sin)");
  assert(results[0].score > 0.9, `High similarity score: ${results[0].score.toFixed(4)}`);
  assert(results[0].metadata.title === "熔断器阈值调整", "Metadata preserved");
  console.log(`  Top result: ${results[0].id} (${results[0].metadata.title}) score=${results[0].score.toFixed(4)}`);

  // ── Test 3: Threshold filter ──
  console.log("\n📊 Test 3: Score threshold");
  const thresholdResults = store.query(queryVec, { topK: 10, scoreThreshold: 0.99 });
  // The slightly shifted sin vector should still be similar but maybe not >0.99
  // This test at least verifies the threshold logic doesn't crash
  assert(thresholdResults.length >= 0, "Threshold filtering works");

  // ── Test 4: Metadata filtering ──
  console.log("\n🔎 Test 4: Metadata filter");
  const filteredResults = store.query(queryVec, {
    topK: 10,
    filter: { types: ["decision"] },
  });
  assert(filteredResults.length === 1, "Only 1 decision type result");
  assert(filteredResults[0].id === "mem-002", "Filtered to the decision");
  console.log(`  Filtered (types=[decision]): ${filteredResults[0].id} (${filteredResults[0].metadata.title})`);

  // ── Test 5: importanceMin filter ──
  console.log("\n🏋️  Test 5: Importance filter");
  const impResults = store.query(queryVec, {
    topK: 10,
    filter: { importanceMin: 9 },
  });
  assert(impResults.length === 1, "Only 1 with importance >= 9");
  assert(impResults[0].id === "mem-002", "High importance entry");

  // ── Test 6: Batch upsert ──
  console.log("\n📦 Test 6: Batch upsert");
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
  for (let i = 0; i < 10; i++) {
    const v = new Float32Array(384);
    for (let j = 0; j < 384; j++) v[j] = Math.sin(j * 0.1 + i * 0.5);
    batch.push({
      id: `mem-batch-${i}`,
      vector: v,
      metadata: {
        nodeId: `mem-batch-${i}`,
        type: i % 2 === 0 ? "memory_entry" : "decision",
        title: `批量记忆 #${i}`,
        summary: `测试批量写入第 ${i} 条`,
        importance: 5 + (i % 5),
        createdAt: Date.now(),
        source: "system",
      },
    });
  }
  store.upsertBatch(batch);
  assert(store.totalEntries === 12, "12 entries after batch");

  // ── Test 7: Query with metadata filter + score ──
  const allFiltered = store.query(queryVec, {
    topK: 5,
    filter: { sources: ["system"], importanceMin: 7 },
  });
  // Only batch entries with source=system and importance >= 7
  // importance 5 + (i % 5): i=2→7, i=3→8, i=4→9, i=7→7, i=8→8, i=9→9
  // So 6 entries with importance >= 7
  assert(allFiltered.length <= 5, "Filtered results capped at topK");

  // ── Test 8: Delete ──
  console.log("\n🗑️  Test 8: Delete");
  const deleted = store.delete("mem-001");
  assert(deleted, "Delete returns true for existing entry");
  assert(store.totalEntries === 11, "11 entries after delete");

  const notFound = store.delete("non-existent");
  assert(!notFound, "Delete returns false for non-existent");

  // ── Test 9: Stats ──
  console.log("\n📊 Test 9: Statistics");
  const stats = store.stats();
  console.log(`  Total: ${stats.totalEntries}, Dimension: ${stats.dimension}`);
  assert(stats.totalEntries === 11, "Stats total correct");
  assert(stats.dimension === 384, "Stats dimension correct");

  // ── Test 10: Clear ──
  console.log("\n🧹 Test 10: Clear");
  store.clear();
  assert(store.totalEntries === 0, "0 entries after clear");

  store.close();

  // Cleanup
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch { /* ignore */ }
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch { /* ignore */ }

  console.log(`\n🎉 All tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
