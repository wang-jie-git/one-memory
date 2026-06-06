/**
 * memory-graph: DecisionTracker — 结构化决策记录
 *
 * 将决策过程结构化为标准格式，方便后续回溯。
 *
 * 决策流程:
 *   背景(context) → 备选方案(options) → 选择(chosen) → 理由(rationale) → 结果(outcome)
 *
 * 每个决策自动写入 memory_nodes（node_type='decision'），
 * 并通过 links_to_memory 关联相关上下文。
 */

import { MemoryDatabase } from "./database";
import type { EdgeRelation } from "./database";

export interface DecisionOption {
  name: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface DecisionInput {
  title: string;
  context: string;
  options: DecisionOption[];
  chosen: string;
  rationale: string;
  tags?: string[];
  source?: "agent" | "user" | "system";
  sourceSession?: string | null;
  importance?: number;
}

export interface DecisionRecord {
  nodeId: string;
  title: string;
  context: string;
  options: DecisionOption[];
  chosen: string;
  rationale: string;
  outcome: "pending" | "success" | "failure" | "unknown";
  outcomeEvidence: string | null;
  createdAt: number;
  importance: number;
}

export class DecisionTracker {
  private memoryDb: MemoryDatabase;

  constructor(memoryDb: MemoryDatabase) {
    this.memoryDb = memoryDb;
  }

  /**
   * 记录一项决策。
   * 将决策的 context/options/rationale 存储在 body 字段中，
   * 以结构化 JSON 格式保存以便程序读取。
   */
  recordDecision(input: DecisionInput): DecisionRecord {
    const structuredBody = JSON.stringify(
      {
        context: input.context,
        options: input.options,
        chosen: input.chosen,
        rationale: input.rationale,
        outcome: "pending",
        outcomeEvidence: null,
      },
      null,
      2,
    );

    const node = this.memoryDb.createNode({
      title: input.title,
      summary: `决策: ${input.title} → 选择 "${input.chosen}"`,
      body: structuredBody,
      importance: input.importance ?? 7,
      status: "active",
      source: input.source ?? "agent",
      sourceSession: input.sourceSession ?? null,
      tags: [...(input.tags ?? []), "decision"],
      nodeType: "decision",
      ttlDays: null,
    });

    // Extract decision record
    return {
      nodeId: node.id,
      title: node.title,
      context: input.context,
      options: input.options,
      chosen: input.chosen,
      rationale: input.rationale,
      outcome: "pending",
      outcomeEvidence: null,
      createdAt: node.createdAt,
      importance: node.importance,
    };
  }

  /**
   * 更新决策结果
   */
  updateOutcome(
    nodeId: string,
    outcome: "success" | "failure" | "unknown",
    evidence?: string,
  ): boolean {
    const node = this.memoryDb.getNode(nodeId);
    if (!node || node.nodeType !== "decision") return false;

    try {
      const body = JSON.parse(node.body);
      body.outcome = outcome;
      if (evidence) body.outcomeEvidence = evidence;

      this.memoryDb.updateNode(nodeId, {
        body: JSON.stringify(body, null, 2),
        tags: [...node.tags.filter((t) => t !== "decision"), "decision", `outcome:${outcome}`],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将决策关联到相关记忆
   */
  linkDecision(
    decisionId: string,
    relatedMemoryId: string,
    relation: EdgeRelation = "implements",
  ): void {
    this.memoryDb.linkMemoryToMemory(decisionId, relatedMemoryId, relation, 1.0);
  }

  /**
   * 获取所有决策记录
   */
  getAllDecisions(status?: "pending" | "success" | "failure"): DecisionRecord[] {
    const nodes = this.memoryDb.searchByTag("decision", 9999);
    return nodes
      .filter((n) => n.nodeType === "decision")
      .map((n) => {
        try {
          const body = JSON.parse(n.body);
          return {
            nodeId: n.id,
            title: n.title,
            context: body.context ?? "",
            options: body.options ?? [],
            chosen: body.chosen ?? "",
            rationale: body.rationale ?? "",
            outcome: body.outcome ?? "unknown",
            outcomeEvidence: body.outcomeEvidence ?? null,
            createdAt: n.createdAt,
            importance: n.importance,
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is DecisionRecord => d !== null)
      .filter((d) => !status || d.outcome === status);
  }

  /**
   * 生成决策回溯报告
   */
  generateReport(): string {
    const all = this.getAllDecisions();
    const pending = all.filter((d) => d.outcome === "pending");
    const success = all.filter((d) => d.outcome === "success");
    const failed = all.filter((d) => d.outcome === "failure");

    const lines: string[] = [];
    lines.push("# 决策回溯报告");
    lines.push("");
    lines.push(`总决策数: ${all.length}`);
    lines.push(`待验证: ${pending.length}`);
    lines.push(`成功: ${success.length}`);
    lines.push(`失败: ${failed.length}`);
    lines.push("");

    if (pending.length > 0) {
      lines.push("## 待验证的决策");
      for (const d of pending) {
        lines.push(`- [${d.importance}/10] ${d.title} — 选择: ${d.chosen}`);
        lines.push(`  ${d.rationale.slice(0, 100)}`);
      }
      lines.push("");
    }

    if (success.length > 0) {
      lines.push("## ✅ 成功的决策");
      for (const d of success) {
        lines.push(`- [${d.importance}/10] ${d.title} → ${d.chosen}`);
        lines.push(`  ${d.outcomeEvidence ?? "无记录"}`);
      }
      lines.push("");
    }

    if (failed.length > 0) {
      lines.push("## ❌ 失败的决策");
      for (const d of failed) {
        lines.push(`- ${d.title} → ${d.chosen}`);
        lines.push(`  ${d.outcomeEvidence ?? "无记录"}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
