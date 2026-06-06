/**
 * Obsidian 双写同步器测试
 *
 * 写入实际的 Obsidian Vault 验证正确性，然后清理。
 */

import { ObsidianWriter } from "../src/obsidian-writer";
import * as fs from "node:fs";
import * as path from "node:path";

const VAULT_ROOT = "/Users/mac/Documents/ObsidianVault";
const SUB_DIR = "2.项目/One Platform/1.Agent_Memory/_test_write";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`❌ ${msg}`);
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log("\n📝 Obsidian Writer 测试\n");

  // ── Test 1: Write a memory entry ──
  console.log("📄 Test 1: Write a memory entry to Obsidian vault");

  const writer = new ObsidianWriter({
    vaultPath: VAULT_ROOT,
    subDir: SUB_DIR,
  });

  const node = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    title: "熔断器阈值从5改为10",
    summary: "由于支付模块超时频繁触发熔断，将阈值从5提升到10",
    body: "## 背景\n支付模块在高峰时段频繁触发熔断。\n## 决策\n将 CircuitBreaker 阈值从 5 改为 10。\n## 结果\n熔断触发频率降低 80%。",
    contentHash: "abc123",
    importance: 8,
    status: "active" as const,
    source: "agent" as const,
    sourceSession: "session-001",
    tags: ["熔断器", "支付", "决策"],
    nodeType: "decision" as const,
    createdAt: Date.parse("2026-06-06T10:00:00Z"),
    updatedAt: Date.parse("2026-06-06T10:00:00Z"),
    ttlDays: null,
  };

  const filePath = writer.write(node);
  assert(fs.existsSync(filePath), `File created: ${path.basename(filePath)}`);

  // ── Test 2: Verify file content ──
  console.log("\n📖 Test 2: Verify file content");
  const content = fs.readFileSync(filePath, "utf-8");
  assert(content.includes("title: \"熔断器阈值从5改为10\""), "Frontmatter title correct");
  assert(content.includes("node_id: \"a1b2c3d4-e5f6-7890-abcd-ef1234567890\""), "Frontmatter node_id correct");
  assert(content.includes("# 熔断器阈值从5改为10"), "Heading correct");
  assert(content.includes("CircuitBreaker"), "Body content preserved");
  assert(content.includes("One Memory ID:"), "Backlink marker present");
  console.log(`  File: ${filePath}`);
  console.log(`  Size: ${content.length} bytes`);

  // ── Test 3: Update existing entry ──
  console.log("\n🔄 Test 3: Update (overwrite) existing entry");
  const updatedNode = { ...node, title: "熔断器阈值调整（更新）", importance: 9 };
  const updatedPath = writer.write(updatedNode);
  assert(fs.existsSync(updatedPath), "File still exists after update");
  const updatedContent = fs.readFileSync(updatedPath, "utf-8");
  assert(updatedContent.includes("熔断器阈值调整（更新）"), "Title updated");
  assert(updatedContent.includes("importance: 9"), "Importance updated");

  // ── Test 4: Delete ──
  console.log("\n🗑️  Test 4: Delete");
  const deleted = writer.delete(node.id);
  assert(deleted, "Delete returns true");
  assert(!fs.existsSync(updatedPath), "File removed after delete");

  // ── Test 5: List ──
  console.log("\n📋 Test 5: List entries");
  // Write a few entries then list
  const nodeA = { ...node, id: "aaaa-1111", title: "测试条目A", tags: ["test"] };
  const nodeB = { ...node, id: "bbbb-2222", title: "测试条目B", tags: ["test"] };
  writer.write(nodeA);
  writer.write(nodeB);

  const list = writer.list();
  assert(list.length === 2, "List returns 2 entries");
  assert(list.some((e) => e.nodeId === "aaaa-1111"), "nodeA in list");
  assert(list.some((e) => e.nodeId === "bbbb-2222"), "nodeB in list");
  console.log(`  Found ${list.length} entries`);

  // Cleanup
  for (const entry of list) {
    fs.unlinkSync(path.join(VAULT_ROOT, SUB_DIR, entry.filename));
  }
  assert(writer.count() === 0, "All test files cleaned up");

  // Remove subdir if empty
  try { fs.rmdirSync(path.join(VAULT_ROOT, SUB_DIR)); } catch { /* ignore */ }

  // ── Test 6: Verify directory creation ──
  console.log("\n📁 Test 6: Auto-creates directory");
  const tmpDir = "_test_write_auto";
  const writer2 = new ObsidianWriter({ vaultPath: VAULT_ROOT, subDir: tmpDir });
  writer2.write(nodeA);
  const tmpPath = path.join(VAULT_ROOT, tmpDir);
  assert(fs.existsSync(tmpPath), "Directory auto-created");
  // Cleanup
  writer2.delete(nodeA.id);
  try { fs.rmdirSync(tmpPath); } catch { /* ignore */ }

  console.log(`\n🎉 All Obsidian writer tests passed!`);
}

runTests().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
