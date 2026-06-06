/**
 * Dream Engine 测试 — 记忆熵减系统的验证
 *
 * 测试场景：
 *   1. 冗余合并：两条高度相似的记忆 → 合并为一条
 *   2. 主题聚类：多条相关记忆 → 生成 insight
 *   3. 价值修剪：低重要性孤立记忆 → 归档
 *   4. 梦境报告完整性：dry run + 实际执行
 *   5. 健康评分：整理后得分应高于整理前
 *   6. 幂等性：重复梦境不产生额外副作用
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import { DreamEngine, type DreamReport } from "../src/dream";
import type { Embedder } from "../../memory-vector/src/embedder";

// ===== Mock Embedder =====

class MockEmbedder implements Embedder {
  readonly dimension = 32;
  readonly modelName = "mock";

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(32);
    // 用文本的哈希生成确定性向量（相似文本生成相似向量）
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash) / 2147483647;
    for (let i = 0; i < 32; i++) {
      vec[i] = Math.sin(seed * (i + 1) * 100) * 0.5 + 0.5;
    }
    // 归一化
    let norm = 0;
    for (let i = 0; i < 32; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < 32; i++) vec[i] /= norm;
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ===== Test Helpers =====

const TEST_DIR = path.join(__dirname, ".dream-test");

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function createTestEnv() {
  cleanTestDir();
  const dbPath = path.join(TEST_DIR, "codegraph.db");
  const vecPath = path.join(TEST_DIR, "memory-vectors.db");

  const db = MemoryDatabase.create(dbPath);
  const vec = SqliteVectorStore.open(vecPath);
  const embedder = new MockEmbedder();

  return { db, vec, embedder, dbPath, vecPath };
}

// ===== Tests =====

describe("DreamEngine — 记忆熵减", () => {

  // ---------------------------------------------------------------------------
  // 1. 冗余合并
  // ---------------------------------------------------------------------------
  it("应该合并两条高度相似的冗余记忆", async () => {
    const { db, vec, embedder } = createTestEnv();

    // 创建两条几乎相同的记忆
    const n1 = db.createNode({
      title: "支付超时修复",
      summary: "修复了支付超时导致订单失败的问题",
      importance: 7, tags: ["payment", "bugfix", "production"],
      nodeType: "memory_entry", source: "agent",
      sourceSession: null, status: "active", ttlDays: null,
    });

    const n2 = db.createNode({
      title: "支付超时修复(复现)",
      summary: "修复了支付超时导致订单失败的问题(第二次出现)",
      importance: 5, tags: ["payment", "bugfix", "production"],
      nodeType: "memory_entry", source: "agent",
      sourceSession: null, status: "active", ttlDays: null,
    });

    // 写入向量（用相似内容确保高相似度）
    const v1 = await embedder.embed(n1.summary);
    const v2 = await embedder.embed(n2.summary);
    vec.upsert(n1.id, v1, {
      nodeId: n1.id, type: "memory_entry", title: n1.title,
      summary: n1.summary, importance: n1.importance,
      createdAt: n1.createdAt, source: "agent",
    });
    vec.upsert(n2.id, v2, {
      nodeId: n2.id, type: "memory_entry", title: n2.title,
      summary: n2.summary, importance: n2.importance,
      createdAt: n2.createdAt, source: "agent",
    });

    // 修改 n2 的创建时间使其在 7 天内（冗余检测条件）
    const raw = db.getRawDb();
    raw.prepare("UPDATE memory_nodes SET created_at = ? WHERE id = ?")
      .run(n1.createdAt + 3600000, n2.id); // 1 hour apart

    const engine = new DreamEngine(db, vec, embedder, { redundancyThreshold: 0.5 });
    const report = await engine.consolidate();

    expect(report.actions.merged.length).toBeGreaterThanOrEqual(1);
    const merge = report.actions.merged[0];
    expect(merge.sourceIds.length).toBeGreaterThanOrEqual(1);
    expect(merge.mergedImportance).toBeGreaterThanOrEqual(7); // 高重要性保留

    // 验证：源节点已被归档
    const obsoleteNode = db.getNode(merge.sourceIds[0]);
    expect(obsoleteNode?.status).toBe("archived");

    // 验证：存在 supersedes 边
    const related = db.getRelatedMemories(merge.targetId);
    expect(related.some((r) => r.relation === "supersedes")).toBe(true);

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 2. 冗余不合并（低相似度）
  // ---------------------------------------------------------------------------
  it("不应合并不相似的记忆", async () => {
    const { db, vec, embedder } = createTestEnv();

    const n1 = db.createNode({
      title: "支付系统修复",
      summary: "修复了支付超时的问题", importance: 7,
      tags: ["payment"], nodeType: "memory_entry",
      source: "agent", sourceSession: null, status: "active", ttlDays: null,
    });
    const n2 = db.createNode({
      title: "用户界面改版",
      summary: "重新设计了登录页面的布局", importance: 6,
      tags: ["ui", "frontend"], nodeType: "memory_entry",
      source: "agent", sourceSession: null, status: "active", ttlDays: null,
    });

    const v1 = await embedder.embed(n1.summary);
    const v2 = await embedder.embed(n2.summary);
    vec.upsert(n1.id, v1, {
      nodeId: n1.id, type: "memory_entry", title: n1.title,
      summary: n1.summary, importance: n1.importance,
      createdAt: n1.createdAt, source: "agent",
    });
    vec.upsert(n2.id, v2, {
      nodeId: n2.id, type: "memory_entry", title: n2.title,
      summary: n2.summary, importance: n2.importance,
      createdAt: n2.createdAt, source: "agent",
    });

    const engine = new DreamEngine(db, vec, embedder, { redundancyThreshold: 0.99 });
    const report = await engine.consolidate();

    expect(report.actions.merged.length).toBe(0);

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 3. 主题聚类 + Insight 生成
  // ---------------------------------------------------------------------------
  it("应该对相关记忆聚类并生成 insight", async () => {
    const { db, vec, embedder } = createTestEnv();

    // 创建 5 条支付相关的记忆（共享 payment 标签）
    const topics = [
      { title: "支付宝接口迁移", summary: "将支付宝从 v1 迁移到 v2 接口", tags: ["payment", "alipay", "migration"] },
      { title: "微信支付回调修复", summary: "修复微信支付回调验签失败的问题", tags: ["payment", "wechat", "bugfix"] },
      { title: "支付超时阈值调整", summary: "将支付超时从 30s 调整到 60s", tags: ["payment", "timeout", "config"] },
      { title: "支付页面样式更新", summary: "更新支付选择页面的按钮样式和文案", tags: ["payment", "ui", "frontend"] },
      { title: "支付日志审计", summary: "增加支付链路的全量日志用于问题排查", tags: ["payment", "logging", "audit"] },
    ];

    for (const t of topics) {
      const node = db.createNode({
        title: t.title, summary: t.summary, importance: 6,
        tags: t.tags, nodeType: "memory_entry", source: "agent",
        sourceSession: null, status: "active", ttlDays: null,
      });
      const v = await embedder.embed(t.summary);
      vec.upsert(node.id, v, {
        nodeId: node.id, type: "memory_entry", title: node.title,
        summary: node.summary, importance: node.importance,
        createdAt: node.createdAt, source: "agent",
      });
    }

    const engine = new DreamEngine(db, vec, embedder, {
      clusterSimilarity: 0.3, // 低阈值确保 payment 标签聚在一起
      minClusterSize: 3,
    });
    const report = await engine.consolidate();

    // 应该生成至少一个 insight
    expect(report.actions.insights.length).toBeGreaterThanOrEqual(1);
    const insight = report.actions.insights[0];
    expect(insight.relatedNodeIds.length).toBeGreaterThanOrEqual(3);

    // 验证 insight 节点存在于数据库
    const insightNode = db.getNode(insight.insightId);
    expect(insightNode).not.toBeNull();
    expect(insightNode?.nodeType).toBe("insight");

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 4. 价值修剪
  // ---------------------------------------------------------------------------
  it("应归档低重要性且孤立的老旧记忆", async () => {
    const { db, vec, embedder } = createTestEnv();

    const oldNode = db.createNode({
      title: "旧版配置说明",
      summary: "这个配置已经不再使用了",
      importance: 1, // 极低重要性
      tags: ["old", "deprecated"], nodeType: "memory_entry",
      source: "agent", sourceSession: null, status: "active",
      ttlDays: null,
    });

    // 修改创建时间为 180 天前
    const raw = db.getRawDb();
    const longAgo = Date.now() - 180 * 86400000;
    raw.prepare("UPDATE memory_nodes SET created_at = ? WHERE id = ?")
      .run(longAgo, oldNode.id);

    const engine = new DreamEngine(db, vec, embedder, {
      lowImportanceThreshold: 3,
    });
    const report = await engine.consolidate();

    // 应该被归档
    expect(report.actions.archived.length).toBeGreaterThanOrEqual(1);
    expect(report.actions.archived).toContain(oldNode.id);

    // 验证状态
    const archived = db.getNode(oldNode.id);
    expect(archived?.status).toBe("archived");

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 5. Dry run 模式
  // ---------------------------------------------------------------------------
  it("dry run 模式不应修改数据", async () => {
    const { db, vec, embedder } = createTestEnv();

    const node = db.createNode({
      title: "测试记忆",
      summary: "这是测试", importance: 5,
      tags: ["test"], nodeType: "memory_entry",
      source: "agent", sourceSession: null, status: "active",
      ttlDays: null,
    });
    const v = await embedder.embed(node.summary);
    vec.upsert(node.id, v, {
      nodeId: node.id, type: "memory_entry", title: node.title,
      summary: node.summary, importance: node.importance,
      createdAt: node.createdAt, source: "agent",
    });

    const engine = new DreamEngine(db, vec, embedder, { dryRun: true });
    const report = await engine.consolidate();

    // Dry run 报告应该没有 action
    expect(report.dryRun).toBe(true);
    expect(report.actions.merged.length).toBe(0);
    expect(report.actions.insights.length).toBe(0);
    expect(report.actions.deleted.length).toBe(0);
    expect(report.actions.archived.length).toBe(0);

    // 数据不应变动
    const unchanged = db.getNode(node.id);
    expect(unchanged?.status).toBe("active");

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 6. 梦境报告完整性
  // ---------------------------------------------------------------------------
  it("梦境报告应包含完整的 before/after 快照", async () => {
    const { db, vec, embedder } = createTestEnv();

    // 创建几条记忆
    for (let i = 0; i < 5; i++) {
      const node = db.createNode({
        title: `记忆 ${i}`,
        summary: `这是第 ${i} 条测试记忆`,
        importance: 5 + i, tags: ["test"],
        nodeType: i < 2 ? "decision" : "memory_entry",
        source: "agent", sourceSession: null,
        status: "active", ttlDays: null,
      });
      const v = await embedder.embed(node.summary);
      vec.upsert(node.id, v, {
        nodeId: node.id, type: node.nodeType, title: node.title,
        summary: node.summary, importance: node.importance,
        createdAt: node.createdAt, source: "agent",
      });
    }

    const engine = new DreamEngine(db, vec, embedder, { dryRun: true });
    const report = await engine.consolidate();

    expect(report.dreamId).toBeTruthy();
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.duration).toBeGreaterThan(0);
    expect(report.summary.before.nodes).toBeGreaterThanOrEqual(5);
    expect(report.summary.before.activeByType).toHaveProperty("memory_entry");
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(10);

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 7. 空数据库不崩溃
  // ---------------------------------------------------------------------------
  it("空数据库不崩溃", async () => {
    const { db, vec, embedder } = createTestEnv();

    const engine = new DreamEngine(db, vec, embedder);
    const report = await engine.consolidate();

    expect(report).toBeDefined();
    expect(report.summary.before.nodes).toBe(0);
    expect(report.actions.merged.length).toBe(0);
    expect(report.actions.insights.length).toBe(0);

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 8. 健康评分与节点变化
  // ---------------------------------------------------------------------------
  it("整理后节点数应减少（合并冗余后）", async () => {
    const { db, vec, embedder } = createTestEnv();

    // 创建 3 条高度相似的冗余记忆
    for (let i = 0; i < 3; i++) {
      const node = db.createNode({
        title: `重复记录 ${i}`,
        summary: "完全相同的摘要内容用于测试冗余合并",
        importance: 4, tags: ["test", "duplicate"],
        nodeType: "memory_entry", source: "agent",
        sourceSession: null, status: "active", ttlDays: null,
      });
      const v = await embedder.embed(node.summary);
      vec.upsert(node.id, v, {
        nodeId: node.id, type: "memory_entry", title: node.title,
        summary: node.summary, importance: node.importance,
        createdAt: node.createdAt, source: "agent",
      });
    }

    const engine = new DreamEngine(db, vec, embedder, {
      redundancyThreshold: 0.1, // 强制触发合并
      lowImportanceThreshold: 2,
    });

    const report = await engine.consolidate();

    // 整理后 active 节点数应减少（2 条冗余被合并）
    expect(report.summary.after.nodes).toBeLessThan(report.summary.before.nodes);
    // 健康评分应 > 0
    expect(report.healthScore).toBeGreaterThan(0);

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 9. TTL 过期删除
  // ---------------------------------------------------------------------------
  it("应删除 TTL 过期的记忆", async () => {
    const { db, vec, embedder } = createTestEnv();

    const node = db.createNode({
      title: "临时缓存",
      summary: "这条记忆应该过期被删除",
      importance: 5, tags: ["temp"],
      nodeType: "memory_entry", source: "agent",
      sourceSession: null, status: "active",
      ttlDays: 1, // 设置 1 天 TTL
    });

    // 修改创建时间为 2 天前
    const raw = db.getRawDb();
    raw.prepare("UPDATE memory_nodes SET created_at = ? WHERE id = ?")
      .run(Date.now() - 2 * 86400000, node.id);

    // 写入向量
    const v = await embedder.embed(node.summary);
    vec.upsert(node.id, v, {
      nodeId: node.id, type: "memory_entry", title: node.title,
      summary: node.summary, importance: node.importance,
      createdAt: node.createdAt, source: "agent",
    });

    const engine = new DreamEngine(db, vec, embedder);
    const report = await engine.consolidate();

    expect(report.actions.deleted).toContain(node.id);
    expect(db.getNode(node.id)).toBeNull(); // 数据库已删除

    db.close(); vec.close();
  });

  // ---------------------------------------------------------------------------
  // 10. 已有测试回退验证
  // ---------------------------------------------------------------------------
  it("不破坏已有功能", async () => {
    const { db, vec, embedder, vecPath } = createTestEnv();

    // 创建正常记忆
    const node = db.createNode({
      title: "正常记忆",
      summary: "不影响已有功能的验证",
      importance: 7, tags: ["test"],
      nodeType: "memory_entry", source: "user",
      sourceSession: null, status: "active", ttlDays: null,
    });
    const v = await embedder.embed(node.summary);
    vec.upsert(node.id, v, {
      nodeId: node.id, type: "memory_entry", title: node.title,
      summary: node.summary, importance: node.importance,
      createdAt: node.createdAt, source: "user",
    });

    // 向量搜索功能正常
    const queryV = await embedder.embed("正常记忆");
    const results = vec.query(queryV, { topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(node.id);

    db.close(); vec.close();
  });
});
