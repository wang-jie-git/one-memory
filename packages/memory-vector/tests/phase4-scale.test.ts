/**
 * Phase 4: IVF + 冷热分层 + 租户隔离 集成测试
 */

import { SqliteVectorStore } from "../src/vector-store";
import { IVFIndex } from "../src/ivf-index";
import * as path from "node:path";
import * as fs from "node:fs";

const TEST_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "p4-test.db");

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log("\n🚀 Phase 4 规模化测试\n");

  // Cleanup
  for (const p of [TEST_DB, TEST_DB+"-wal", TEST_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  const store = SqliteVectorStore.open(TEST_DB);

  // ===== Generate test data =====
  const NUM_VECTORS = 500;
  const DIM = 384;

  // Create 5 semantic groups
  const groups = [
    { prefix: "payment", seed: 1, count: 100 },
    { prefix: "auth", seed: 10, count: 100 },
    { prefix: "ui", seed: 20, count: 100 },
    { prefix: "database", seed: 30, count: 100 },
    { prefix: "deploy", seed: 40, count: 100 },
  ];

  let totalVectors = 0;
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      const vec = new Float32Array(DIM);
      for (let d = 0; d < DIM; d++) {
        vec[d] = Math.sin(d * 0.1 + group.seed + i * 0.01);
      }
      const id = `${group.prefix}-${i}`;
      store.upsert(id, vec, {
        nodeId: id,
        type: i % 3 === 0 ? "decision" : "memory_entry",
        title: `${group.prefix} entry ${i}`,
        summary: `Test entry for ${group.prefix}`,
        importance: 1 + (i % 10),
        createdAt: Date.now() - (i * 86400000), // Each entry 1 day apart
        source: i % 2 === 0 ? "agent" : "user",
        tenantId: i < 50 ? "tenant-a" : "tenant-b",
        tier: "hot",
      });
      totalVectors++;
    }
  }

  assert(store.totalEntries === NUM_VECTORS, `Inserted ${NUM_VECTORS} test vectors`);
  console.log(`  Dataset: ${NUM_VECTORS} vectors, ${DIM} dim, 5 semantic groups`);

  // ── Test 1: Tenant isolation ──
  console.log("\n🔒 Test 1: Tenant isolation filtering");

  const qv = new Float32Array(DIM);
  // Query for payment-related (group seed 1)
  for (let d = 0; d < DIM; d++) qv[d] = Math.sin(d * 0.1 + 1);

  const tenantAResults = store.query(qv, {
    topK: 10,
    filter: { tenantId: "tenant-a" },
  });
  assert(tenantAResults.length > 0, "Tenant A returns results");
  assert(tenantAResults.every((r) => r.metadata.tenantId === "tenant-a"),
    "All results are from tenant-a");

  const tenantBResults = store.query(qv, {
    topK: 10,
    filter: { tenantId: "tenant-b" },
  });
  assert(tenantBResults.every((r) => r.metadata.tenantId === "tenant-b"),
    "All results are from tenant-b");
  console.log(`  Tenant A: ${tenantAResults.length}, Tenant B: ${tenantBResults.length}`);

  // ── Test 2: Cold storage tiering ──
  console.log("\n❄️  Test 2: Cold storage tiering");

  const oldEntries = store.query(qv, {
    topK: 10,
    filter: { tiers: ["hot"] },
  });
  assert(oldEntries.length > 0, "Hot entries exist");

  // Move some entries to cold
  const coldIds = ["payment-0", "payment-1", "payment-2", "auth-0", "auth-1"];
  const moved = store.moveToCold(coldIds);
  assert(moved === 5, `Moved ${moved} entries to cold`);

  // Hot query should exclude them
  const hotOnly = store.query(qv, {
    topK: 10,
    filter: { tiers: ["hot"] },
  });
  const coldEntryFound = hotOnly.some((r) => coldIds.includes(r.id));
  assert(!coldEntryFound, "Cold entries excluded from hot query");
  console.log(`  Hot only query returned ${hotOnly.length} results, no cold entries`);

  // Cold-specific query
  const coldOnly = store.query(qv, {
    topK: 10,
    filter: { tiers: ["cold"] },
  });
  assert(coldOnly.every((r) => coldIds.includes(r.id)), "Cold query returns only cold entries");
  assert(coldOnly.length <= 5, `Cold entries: ${coldOnly.length}`);

  // Move back
  store.moveToHot(coldIds);
  const afterMoveBack = store.query(qv, {
    topK: 5,
    filter: { tiers: ["hot"] },
  });
  assert(afterMoveBack.some((r) => coldIds.includes(r.id)), "Restored entries appear in hot query");

  // ── Test 3: Auto-tier ──
  console.log("\n🤖 Test 3: Auto-tier by age + importance");
  const autoResult = store.autoTier(30, 3);
  if (autoResult.movedToCold > 0) {
    console.log(`  Auto-moved ${autoResult.movedToCold} entries to cold`);
    // Move back for other tests
    const allCold = store.query(qv, { topK: 1000, filter: { tiers: ["cold"] } });
    store.moveToHot(allCold.map((r) => r.id));
  } else {
    console.log("  No entries met auto-tier criteria");
  }

  // ── Test 4: IVF Index performance vs brute force ──
  console.log("\n📊 Test 4: IVF Index performance benchmark");

  // Collect all vectors for training
  const allVectors: Array<{ id: string; vector: Float32Array }> = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups[i].count; j++) {
      const id = `${groups[i].prefix}-${j}`;
      // Re-read from store... actually let's just generate again for the IVF
      const vec = new Float32Array(DIM);
      for (let d = 0; d < DIM; d++) vec[d] = Math.sin(d * 0.1 + groups[i].seed + j * 0.01);
      allVectors.push({ id, vector: vec });
    }
  }

  // Train IVF with 25 clusters
  const ivf = new IVFIndex(DIM, 25);
  const t0 = performance.now();
  ivf.train(allVectors);
  const trainTime = performance.now() - t0;
  assert(ivf.isTrained, "IVF index trained");
  const ivfStats = ivf.stats();
  console.log(`  IVF training: ${trainTime.toFixed(0)}ms`);
  console.log(`  Clusters: ${ivfStats.clusters}, Entries: ${ivfStats.entries}`);
  console.log(`  Distribution: [${ivfStats.distribution.slice(0, 10).join(", ")}${ivfStats.distribution.length > 10 ? "..." : ""}]`);

  // IVF already has all entries after train — don't double-add

  // Benchmark: IVF search vs brute force
  const queryVec = new Float32Array(DIM);
  for (let d = 0; d < DIM; d++) queryVec[d] = Math.sin(d * 0.1 + 1.5); // Between payment groups

  // IVF search (search_clusters=3)
  const ivfTimes: number[] = [];
  for (let trial = 0; trial < 20; trial++) {
    const t = performance.now();
    ivf.search(queryVec, 5, 3);
    ivfTimes.push(performance.now() - t);
  }

  // Brute force via store
  const bfTimes: number[] = [];
  for (let trial = 0; trial < 20; trial++) {
    const t = performance.now();
    store.query(queryVec, { topK: 5 });
    bfTimes.push(performance.now() - t);
  }

  const avgIvf = ivfTimes.reduce((a, b) => a + b, 0) / ivfTimes.length;
  const avgBf = bfTimes.reduce((a, b) => a + b, 0) / bfTimes.length;

  console.log(`\n  ┌─────────────────────┬────────────┐`);
  console.log(`  │ Search (${NUM_VECTORS} vecs)      │ Avg Time   │`);
  console.log(`  ├─────────────────────┼────────────┤`);
  console.log(`  │ Brute force (SQLite) │ ${avgBf.toFixed(3).padStart(8)}ms │`);
  console.log(`  │ IVF (3 clusters)    │ ${avgIvf.toFixed(3).padStart(8)}ms │`);
  console.log(`  │ Speedup             │ ${(avgBf / avgIvf).toFixed(1).padStart(8)}x │`);
  console.log(`  └─────────────────────┴────────────┘`);

  assert(avgIvf < avgBf, `IVF (${avgIvf.toFixed(3)}ms) faster than brute force (${avgBf.toFixed(3)}ms)`);

  // IVF accuracy: top results should be payment-related (group seed 1)
  const ivfResults = ivf.search(queryVec, 5, 3);
  const paymentResults = ivfResults.filter((r) => r.id.startsWith("payment"));
  console.log(`  IVF top 5: [${ivfResults.map((r) => r.id).join(", ")}]`);
  console.log(`  Payment results in top 5: ${paymentResults.length}`);

  // ── Test 5: IVF incremental add + delete ──
  console.log("\n➕ Test 5: IVF incremental operations");

  ivf.add("new-item-1", queryVec);
  const afterAdd = ivf.search(queryVec, 5, 3);
  assert(afterAdd.some((r) => r.id === "new-item-1"), "New item found in IVF search");
  console.log(`  Added 'new-item-1' → found in search results: ✅`);

  ivf.delete("new-item-1");
  const afterDelete = ivf.search(queryVec, 5, 3);
  assert(!afterDelete.some((r) => r.id === "new-item-1"), "Deleted item removed from IVF");
  console.log(`  Deleted 'new-item-1' → absent from search results: ✅`);

  // Cleanup
  store.close();
  for (const p of [TEST_DB, TEST_DB+"-wal", TEST_DB+"-shm"]) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`\n🎉 All Phase 4 tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
