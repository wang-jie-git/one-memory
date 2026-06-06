/**
 * AutoLinker 测试
 *
 * 验证从 CodeGraph nodes 表自动匹配并建立 links_to_code 边的能力。
 * 需要实际的 CodeGraph DB 中有代码符号数据。
 */

import { MemoryDatabase } from "../src/database";
import { AutoLinker } from "../src/auto-linker";
import * as path from "node:path";
import * as fs from "node:fs";

const ONE_PROD_DB = path.join(
  process.env.HOME ?? "/Users/mac",
  "Library", "Application Support", "@one", "electron", ".codegraph", "codegraph.db",
);

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log("\n🔗 AutoLinker 测试\n");

  // ── Test 1: Scan code symbols from production DB ──
  console.log("📦 Test 1: Scan production CodeGraph DB for symbols");
  if (!fs.existsSync(ONE_PROD_DB)) {
    console.log("  ⏭️  Production DB not found, skipping");
    return;
  }

  const db = MemoryDatabase.open(ONE_PROD_DB);

  // Check if there are code symbols in the DB
  const rawDb = db.getRawDb();
  const symbolCount = (rawDb.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
  console.log(`  CodeGraph symbols in DB: ${symbolCount}`);

  if (symbolCount === 0) {
    console.log("  ⏭️  No code symbols found, skipping");
    db.close();
    return;
  }

  // ── Test 2: Create a memory entry and auto-link it ──
  console.log("\n🏷️  Test 2: Auto-link a memory entry to code symbols");

  // Get some existing tags from code symbols for a realistic test
  const sampleKinds = (rawDb.prepare("SELECT DISTINCT kind FROM nodes LIMIT 20").all() as Array<{ kind: string }>).map(r => r.kind);
  console.log(`  Available symbol kinds: ${sampleKinds.join(", ")}`);

  const node = db.createNode({
    title: "支付模块 WebSocket 重构",
    summary: "将支付状态从轮询改为 WebSocket 长连接以减少延迟",
    importance: 7,
    status: "active",
    source: "agent",
    sourceSession: null,
    tags: ["支付", "WebSocket", "轮询"],
    nodeType: "decision",
    ttlDays: null,
  });

  const linker = new AutoLinker(db, {
    maxLinksPerMemory: 5,
    minConfidence: 0.3, // Lower threshold for test
    allowedKinds: sampleKinds.length > 0 ? sampleKinds : undefined,
  });

  const matches = linker.autoLink(node.id);
  console.log(`  Memory: "${node.title}"`);
  console.log(`  Tags:   ${node.tags.join(", ")}`);
  console.log(`  Matches: ${matches.length} code symbols`);

  for (const m of matches) {
    console.log(`    [${m.matchType}] ${m.symbolId} (confidence: ${m.confidence.toFixed(2)}) — ${m.description}`);
  }

  // Verify edges were created (max 5 per config)
  const createdEdges = db.getMemoryWithCodeSymbols(node.id);
  assert(createdEdges.length > 0 && createdEdges.length <= 5, `Created ${createdEdges.length} code links (max 5)`);
  console.log(`  Created ${createdEdges.length} edges from ${matches.length} candidate matches`);

  // Cleanup
  db.deleteNode(node.id);

  db.close();
  console.log(`\n🎉 All AutoLinker tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
