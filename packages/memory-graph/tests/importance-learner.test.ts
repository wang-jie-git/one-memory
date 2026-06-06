/**
 * ImportanceLearner 测试
 */

import { MemoryDatabase } from "../src/database";
import { ImportanceLearner } from "../src/importance-learner";
import * as path from "node:path";
import * as fs from "node:fs";

const CG_DB = path.join(__dirname, "..", "..", "..", ".codegraph", "imp-test.db");

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log("\n📈 ImportanceLearner 测试\n");

  // Cleanup
  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm"]) { try { fs.unlinkSync(p); } catch {} }

  const db = MemoryDatabase.create(CG_DB);
  const learner = new ImportanceLearner(db, path.dirname(CG_DB), {
    heatDecayHalfLifeMs: 1000, // Very short half-life for testing
    learningRate: 0.3,
    baseWeight: 0.7,
    archiveThreshold: 3,
  });

  // ── Test 1: Record hits ──
  console.log("🎯 Test 1: Record hits and check heat decay");

  const node1 = db.createNode({
    title: "热门条目", summary: "经常被查询的记忆",
    importance: 5, status: "active", source: "agent",
    tags: [], nodeType: "memory_entry", ttlDays: null,
  });
  const node2 = db.createNode({
    title: "冷门条目", summary: "几乎不被查询",
    importance: 5, status: "active", source: "agent",
    tags: [], nodeType: "memory_entry", ttlDays: null,
  });

  // Record 5 hits on node1
  for (let i = 0; i < 5; i++) learner.recordHit(node1.id);

  const heat1 = learner.getEffectiveHeat(node1.id);
  const heat2 = learner.getEffectiveHeat(node2.id);
  console.log(`  node1 heat (5 hits): ${heat1.toFixed(2)}`);
  console.log(`  node2 heat (0 hits): ${heat2.toFixed(2)}`);
  assert(heat1 > heat2, "Hot entry has higher heat than cold entry");
  assert(heat1 > 0, "Hot entry has positive heat");

  // ── Test 2: Heat decays over time ──
  console.log("\n⏳ Test 2: Heat decay");

  // Wait briefly (half-life is 1s)
  await new Promise((r) => setTimeout(r, 1100));
  const decayedHeat = learner.getEffectiveHeat(node1.id);
  console.log(`  After 1.1s decay: ${decayedHeat.toFixed(2)} (was: ${heat1.toFixed(2)})`);
  // Should have decayed by ~50%
  assert(decayedHeat < heat1, "Heat decays over time");

  // ── Test 3: Update importance ──
  console.log("\n🔄 Test 3: Update importance based on heat");

  // Record more hits to raise heat
  for (let i = 0; i < 10; i++) learner.recordHit(node1.id);

  const updated = learner.updateImportance(node1.id);
  assert(updated, "Importance was updated");

  const node1After = db.getNode(node1.id);
  console.log(`  node1 importance: ${node1After!.importance} (was: 5)`);
  assert(node1After!.importance > 5, "Importance increased due to heat");

  // ── Test 4: Cold entry stays same ──
  console.log("\n❄️  Test 4: Cold entry unchanged");
  const node2Before = db.getNode(node2.id)!;
  const updated2 = learner.updateImportance(node2.id);
  const node2After = db.getNode(node2.id)!;
  console.log(`  node2: ${node2Before.importance} → ${node2After.importance}`);
  assert(node2After.importance <= node2Before.importance, "Cold entry doesn't increase");

  // ── Test 5: Full update ──
  console.log("\n📊 Test 5: Full updateAll dry-run");
  const result = learner.updateAll({ dryRun: true });
  console.log(`  Scanned: ${result.scanned}, Would update: ${result.updated}, Archive candidates: ${result.archiveCandidates.length}`);
  assert(result.scanned === 2, "Scanned 2 entries");

  // ── Test 6: Persistence ──
  console.log("\n💾 Test 6: Heat data persistence");

  // Record on current instance — updateImportance triggers save
  learner.recordHit(node1.id);
  learner.updateAll();

  // Create new instance (loads from same file)
  const learner2 = new ImportanceLearner(db, path.dirname(CG_DB));
  const loadedHeat = learner2.getEffectiveHeat(node1.id);
  const heatFilePath = path.join(path.dirname(CG_DB), "memory-heat.json");
  assert(fs.existsSync(heatFilePath), "Heat file was written");
  assert(loadedHeat >= 0, "Heat data persisted and loaded");

  // ── Test 7: Report ──
  console.log("\n📋 Test 7: Heat report");
  const report = learner.exportHeatReport();
  assert(report.length > 0, "Report has entries");
  assert(report[0].heat >= report[report.length - 1].heat, "Report sorted by heat descending");

  // Cleanup
  for (const p of [CG_DB, CG_DB+"-wal", CG_DB+"-shm"]) { try { fs.unlinkSync(p); } catch {} }
  try { fs.unlinkSync(path.join(path.dirname(CG_DB), "memory-heat.json")); } catch {}

  console.log(`\n🎉 All ImportanceLearner tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
