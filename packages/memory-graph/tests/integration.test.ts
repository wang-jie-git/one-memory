/**
 * memory-graph: 集成测试
 *
 * 验证 memory-graph 能直接打开 CodeGraph 的 SQLite DB 并正确读写。
 */

import { MemoryDatabase } from "../src/database";
import * as path from "node:path";
import * as fs from "node:fs";

const TEST_DB = path.join(__dirname, "..", "..", "..", "..", ".codegraph", "codegraph.db");
const ONE_PROD_DB = path.join(
  process.env.HOME ?? "/Users/mac",
  "Library", "Application Support", "@one", "electron", ".codegraph", "codegraph.db",
);

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ASSERT FAILED: ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log("\n🔬 memory-graph 集成测试\n");

  // ── Test 1: Open production DB ──
  console.log("📁 Test 1: Open One production CodeGraph database");
  const prodDbExists = fs.existsSync(ONE_PROD_DB);
  if (prodDbExists) {
    const db = MemoryDatabase.open(ONE_PROD_DB);
    assert(db !== null, "Opened production database");
    const stats = db.getStats();
    console.log(`  📊 Stats: ${stats.totalNodes} nodes, ${stats.totalEdges} edges, ${stats.codeLinked} code links`);
    db.close();
  } else {
    console.log("  ⏭️  Production DB not found, skipping");
  }

  // ── Test 2: Create and query memory nodes ──
  console.log("\n📝 Test 2: Create and query memory nodes");
  const tmpPath = path.join(__dirname, "..", "tmp_test.db");
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  const db = MemoryDatabase.create(tmpPath);

  const node1 = db.createNode({
    title: "熔断器阈值从5改为10",
    summary: "由于支付模块超时频繁触发熔断，将阈值从5提升到10",
    body: "## 背景\n支付模块在高峰时段频繁触发熔断...\n## 决策\n将 CircuitBreaker 阈值从 5 改为 10",
    importance: 8,
    status: "active",
    source: "agent",
    sourceSession: "session-001",
    tags: ["熔断器", "支付", "决策"],
    nodeType: "decision",
    ttlDays: null,
  });
  assert(node1.id.length > 0, "Created node with UUID");

  const node2 = db.createNode({
    title: "支付模块超时修复记录",
    summary: "Webhook 响应时间超过 30s 时触发熔断的修复记录",
    importance: 7,
    status: "active",
    source: "agent",
    tags: ["支付", "bug修复"],
    nodeType: "memory_entry",
    ttlDays: null,
  });

  const node3 = db.createNode({
    title: "2026-06-06 架构评审纪要",
    summary: "One Memory 混合架构设计评审",
    importance: 6,
    status: "active",
    source: "system",
    tags: ["架构", "记忆系统"],
    nodeType: "memory_entry",
    ttlDays: null,
  });

  // ── Test 3: Create edges ──
  console.log("\n🔗 Test 3: Create memory-to-memory and memory-to-code edges");

  // memory-to-memory: "熔断器决策" caused by "支付模块超时修复"
  const edge1 = db.linkMemoryToMemory(node1.id, node2.id, "fixes", 1.0, "熔断器阈值调整修复了支付超时问题");
  assert(edge1.id > 0, "Created memory-to-memory edge");

  // memory-to-memory: "架构评审" references "熔断器决策"
  db.linkMemoryToMemory(node3.id, node1.id, "references", 0.8, "评审中讨论了熔断器设计");

  // memory-to-code: "支付模块超时修复" links to PaymentService.process
  const edgeCode = db.linkMemoryToCode(node2.id, "PaymentService_process", "修复的代码入口");
  assert(edgeCode.relation === "links_to_code", "Created memory-to-code edge");

  // ── Test 4: Query ──
  console.log("\n🔍 Test 4: Query operations");

  const retrieved = db.getNode(node1.id);
  assert(retrieved !== null, "Get node by ID");
  assert(retrieved!.title === "熔断器阈值从5改为10", "Title matches");

  const relatedToNode1 = db.getRelatedMemories(node1.id);
  assert(relatedToNode1.length > 0, "Has related memories");
  console.log(`  Related to node1: ${relatedToNode1.map((r) => r.node.title + " (" + r.relation + ")").join(", ")}`);

  const textSearch = db.searchByText("熔断器");
  assert(textSearch.length > 0, "Text search works");
  console.log(`  Text search '熔断器': ${textSearch.map((n) => n.title).join(", ")}`);

  const tagSearch = db.searchByTag("支付");
  assert(tagSearch.length > 0, "Tag search works");

  // ── Test 5: Update and delete ──
  console.log("\n🔄 Test 5: Update and delete");
  
  db.updateNode(node2.id, { importance: 9, tags: ["支付", "bug修复", "P0"] });
  const updated = db.getNode(node2.id);
  assert(updated!.importance === 9, "Updated importance");
  assert(updated!.tags.includes("P0"), "Updated tags");

  db.deleteNode(node3.id);
  const deleted = db.getNode(node3.id);
  assert(deleted === null, "Deleted node");

  // ── Test 6: Stats ──
  console.log("\n📊 Test 6: Statistics");
  const stats = db.getStats();
  console.log(`  Total nodes: ${stats.totalNodes}`);
  console.log(`  Total edges: ${stats.totalEdges}`);
  console.log(`  Code links:  ${stats.codeLinked}`);
  console.log(`  By type:     ${JSON.stringify(stats.byType)}`);
  console.log(`  By status:   ${JSON.stringify(stats.byStatus)}`);
  assert(stats.totalNodes === 2, "2 nodes (1 deleted)");
  assert(stats.totalEdges === 3, "3 edges");

  // ── Test 7: Prune ──
  console.log("\n✂️  Test 7: Prune dry-run");
  const pruneResult = db.prune(true);
  console.log(`  Would delete: ${pruneResult.deleted}, archive: ${pruneResult.archived}`);

  // Cleanup
  db.close();
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  console.log(`\n🎉 All tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
