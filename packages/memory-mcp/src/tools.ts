/**
 * One Memory MCP — 记忆系统工具定义
 *
 * 给 Agent 提供 11 个记忆操作工具：
 *   memory_write / memory_query / memory_dream / memory_health
 *   memory_logs / memory_report / memory_stats
 *   global_write / global_query / global_stats / global_dream
 *
 * 全局工具（global_*）只能由 One-Prime 调用（ONE_AGENT_TIER=prime 校验）。
 * 项目工具（memory_*）对所有 Agent 开放。
 */

import { MemorySystem } from "../../memory-orchestrator/src/memory-system";
import type { MemoryNodeType, MemoryScope } from "../../memory-graph/src/database";

// ===== Tool Schema =====

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: ToolSchema[] = [
  // ── memory_write (项目级) ──
  {
    name: "memory_write",
    description: "写入一条项目级记忆（自动索引到图+向量库，scope=public）",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "记忆标题（必填，简短精确）" },
        summary: { type: "string", description: "一句话摘要（AI 读取用，建议 <100 字符）" },
        body: { type: "string", description: "详细内容（可选，人类阅读用）" },
        importance: { type: "number", description: "重要性 1-10（默认 5）", default: 5 },
        tags: { type: "array", items: { type: "string" }, description: "标签数组" },
        type: { type: "string", enum: ["memory_entry", "decision", "project_milestone", "insight", "structure_template"], description: "节点类型" },
        ttl_days: { type: "number", description: "自动过期天数（不填则永不过期）" },
        user_id: { type: "string", description: "用户 ID（多租户隔离，默认 'default' 表示无租户）", default: "default" },
      },
      required: ["title"],
    },
  },

  // ── memory_query (项目级) ──
  {
    name: "memory_query",
    description: "语义搜索项目级记忆（自动过滤 scope=public，仅返回可见数据）",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索文本（自然语言即可）" },
        limit: { type: "number", description: "最多返回条数（默认 5）", default: 5 },
        min_importance: { type: "number", description: "最低重要性过滤（1-10）" },
        user_id: { type: "string", description: "用户 ID 过滤（多租户隔离，不传则返回所有 public 数据）", default: "default" },
      },
      required: ["query"],
    },
  },

  // ── memory_dream ──
  {
    name: "memory_dream",
    description: "触发梦境整理——系统和合并冗余记忆、提炼 insight、修剪低价值记忆（熵减过程）",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "预览模式，不实际修改（默认 false）", default: false },
      },
    },
  },

  // ── memory_health ──
  {
    name: "memory_health",
    description: "记忆系统健康检查（组件状态 + 评分 + 问题诊断）",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "text"], description: "输出格式（默认 text）", default: "text" },
      },
    },
  },

  // ── memory_logs ──
  {
    name: "memory_logs",
    description: "查看记忆系统最近日志（调试用）",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "返回条数（默认 20）", default: 20 },
        min_level: { type: "string", enum: ["debug", "info", "warn", "error"], description: "最低日志级别" },
      },
    },
  },

  // ── memory_report ──
  {
    name: "memory_report",
    description: "获取记忆系统评估报告（完整的组件评分 + 错误汇总 + 趋势 + 修复建议）",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "text"], description: "输出格式（默认 text）", default: "text" },
      },
    },
  },

  // ── memory_stats ──
  {
    name: "memory_stats",
    description: "记忆系统统计数据（图节点数、向量数、写入/查询/梦境计数）",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ── global_write (仅 One-Prime) ──
  {
    name: "global_write",
    description: "[One-Prime 专用] 写入全局记忆（scope=global，仅 One-Prime 可见）",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "记忆标题（必填）" },
        summary: { type: "string", description: "一句话摘要" },
        body: { type: "string", description: "详细内容" },
        importance: { type: "number", description: "重要性 1-10（默认 10）", default: 10 },
        tags: { type: "array", items: { type: "string" }, description: "标签数组" },
        type: { type: "string", enum: ["memory_entry", "decision", "project_milestone", "insight", "structure_template"], description: "节点类型" },
      },
      required: ["title"],
    },
  },

  // ── global_query (仅 One-Prime) ──
  {
    name: "global_query",
    description: "[One-Prime 专用] 语义搜索全局记忆（scope=global），支持 JSON 格式输出",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索文本" },
        limit: { type: "number", description: "最多返回条数（默认 5）", default: 5 },
        format: { type: "string", enum: ["text", "json"], description: "输出格式（默认 text）", default: "text" },
      },
      required: ["query"],
    },
  },

  // ── global_stats (仅 One-Prime) ──
  {
    name: "global_stats",
    description: "[One-Prime 专用] 全局记忆统计信息",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ── global_dream (仅 One-Prime) ──
  {
    name: "global_dream",
    description: "[One-Prime 专用] 对全局记忆触发梦境整理",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "预览模式", default: false },
      },
    },
  },
];

// ===== Tool Handlers =====

export type ToolHandler = (
  ms: MemorySystem,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export const HANDLERS: Record<string, ToolHandler> = {
  // ── memory_write ──
  async memory_write(ms, args) {
    const node = await ms.write({
      title: String(args.title),
      summary: args.summary as string | undefined,
      body: args.body as string | undefined,
      importance: (args.importance as number) ?? 5,
      tags: (args.tags as string[]) ?? [],
      nodeType: (args.type as MemoryNodeType) ?? "memory_entry",
      ttlDays: (args.ttl_days as number | null) ?? null,
      scope: "public",
      userId: (args.user_id as string) ?? "default",
    });
    return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
  },

  // ── memory_query ──
  async memory_query(ms, args) {
    const filter: { importanceMin?: number; userId?: string } = {};
    if (args.min_importance != null) filter.importanceMin = Number(args.min_importance);
    if (args.user_id != null && args.user_id !== "default") filter.userId = String(args.user_id);
    const result = await ms.query(String(args.query), filter);
    const limit = (args.limit as number) ?? 5;
    // 过滤仅返回 public 范围
    const results = result.results.filter((r) => (r as any).scope !== "global").slice(0, limit);

    const text = results.map((r, i) => {
      return `[${i + 1}] ${r.title}\n    重要性: ${r.metadata.importance}/10  |  评分: ${r.score.toFixed(2)}\n    摘要: ${r.summary}\n    标签: #${r.metadata.tags.join(" #")}`;
    }).join("\n\n");

    return {
      content: [{ type: "text", text: text || "无匹配结果" }],
    };
  },

  // ── memory_dream ──
  async memory_dream(ms, args) {
    const dryRun = (args.dry_run as boolean) ?? false;
    const report = await ms.dream(dryRun);
    const text = dryRun
      ? `[预览模式] 梦境整理将执行:\n  合并 ${report.actions.merged.length} 条冗余\n  聚类 ${report.actions.insights.length} 组 insight\n  归档 ${report.actions.archived.length} 条低价值\n  删除 ${report.actions.deleted.length} 条过期`
      : `梦境整理完成:\n  ✅ 合并 ${report.actions.merged.length} 条冗余\n  ✅ 提炼 ${report.actions.insights.length} 条 insight\n  📦 归档 ${report.actions.archived.length} 条\n  🗑 删除 ${report.actions.deleted.length} 条\n  📊 健康评分: ${report.healthScore}/10\n  ⏱ 耗时: ${report.duration}ms`;
    return { content: [{ type: "text", text }] };
  },

  // ── memory_health ──
  async memory_health(ms, args) {
    const health = await ms.checkHealth();
    const format = (args.format as string) ?? "text";

    if (format === "json") {
      return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
    }

    const fmt = (ok: boolean) => ok ? "✅" : "❌";
    const text = [
      `记忆系统健康检查`,
      `━━━━━━━━━━━━━━━━━━━`,
      `  评分: ${health.score}/10  |  状态: ${health.healthy ? "✅ 健康" : "⚠ 异常"}`,
      `  ${fmt(health.graphDb.ok)} 图数据库   ${health.graphDb.latencyMs ?? "-"}ms`,
      `  ${fmt(health.vectorStore.ok)} 向量库     ${health.vectorStore.latencyMs ?? "-"}ms  (${health.vectorStore.totalEntries ?? 0} 条)`,
      `  ${fmt(health.embedder.ok)} Embedder   ${health.embedder.latencyMs ?? "-"}ms`,
      `  运行时长: ${Math.round(health.uptimeMs / 1000)}s`,
      ...(health.healthy ? [] : ["", "⚠ 系统异常，请运行 memory_report 查看详情"]),
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },

  // ── memory_logs ──
  async memory_logs(ms, args) {
    const limit = (args.limit as number) ?? 20;
    const level = args.min_level as string | undefined;
    const logs = ms.getLogs(limit, level as any);

    if (logs.length === 0) {
      return { content: [{ type: "text", text: "无日志记录" }] };
    }

    const text = logs.map((l) => {
      const t = new Date(l.timestamp).toLocaleTimeString();
      const err = l.error ? `  ERROR: ${l.error}` : "";
      return `[${t}] [${l.level.toUpperCase().padEnd(5)}] [${l.module}] ${l.message}${err}`;
    }).join("\n");

    return { content: [{ type: "text", text }] };
  },

  // ── memory_report ──
  async memory_report(ms, args) {
    const format = (args.format as string) ?? "text";
    const report = ms.generateReport();

    if (format === "json") {
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }

    return { content: [{ type: "text", text: ms.formatReport(report) }] };
  },

  // ── memory_stats ──
  async memory_stats(ms) {
    const stats = ms.stats();
    const text = [
      `记忆系统统计`,
      `━━━━━━━━━━━━━━━━━━━`,
      `  图节点: ${stats.graph.totalNodes}`,
      `  图边:   ${stats.graph.totalEdges}`,
      `  向量:   ${stats.vector.total} 条 (${stats.vector.dimension} 维)`,
      `  Obsidian: ${stats.obsidian} 篇`,
      `  缓冲待写: ${stats.bufferPending} 条`,
      ...(stats.health ? [
        `  健康评分: ${stats.health.score}/10`,
        `  运行时长: ${stats.health.uptime}`,
      ] : []),
      `  近期错误: ${stats.recentErrors} 条/小时`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },

  // ═══════════════════════════════════════════════
  //  全局工具（仅 One-Prime）
  // ═══════════════════════════════════════════════

  // ── global_write ──
  async global_write(ms, args) {
    MemorySystem.checkSystemTier("global");
    const node = await ms.write({
      title: String(args.title),
      summary: args.summary as string | undefined,
      body: args.body as string | undefined,
      importance: (args.importance as number) ?? 10,
      tags: (args.tags as string[]) ?? [],
      nodeType: (args.type as MemoryNodeType) ?? "memory_entry",
      scope: "global",
    });
    return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
  },

  // ── global_query ──
  async global_query(ms, args) {
    MemorySystem.checkSystemTier("global");
    const result = await ms.query(String(args.query));
    const limit = (args.limit as number) ?? 5;
    const format = (args.format as string) ?? "text";
    // 过滤仅返回 global 范围
    const results = result.results.filter((r) => (r as any).scope === "global" || !(r as any).scope).slice(0, limit);

    if (format === "json") {
      return {
        content: [{ type: "text", text: JSON.stringify({ data: results }, null, 2) }],
      };
    }

    const text = results.map((r, i) => {
      return `[${i + 1}] ${r.title}\n    重要性: ${r.metadata.importance}/10  |  评分: ${r.score.toFixed(2)}\n    摘要: ${r.summary}\n    标签: #${r.metadata.tags.join(" #")}`;
    }).join("\n\n");

    return {
      content: [{ type: "text", text: text || "无匹配结果" }],
    };
  },

  // ── global_stats ──
  async global_stats(ms) {
    MemorySystem.checkSystemTier("global");
    const stats = ms.stats();
    const text = [
      `全局记忆统计`,
      `━━━━━━━━━━━━━━━━━━━`,
      `  图节点: ${stats.graph.totalNodes}`,
      `  图边:   ${stats.graph.totalEdges}`,
      `  向量:   ${stats.vector.total} 条`,
      `  健康评分: ${stats.health?.score ?? "N/A"}/10`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },

  // ── global_dream ──
  async global_dream(ms, args) {
    MemorySystem.checkSystemTier("global");
    const dryRun = (args.dry_run as boolean) ?? false;
    const report = await ms.dream(dryRun);
    const text = dryRun
      ? `[预览模式] 全局梦境整理将执行:\n  合并 ${report.actions.merged.length} 条冗余\n  聚类 ${report.actions.insights.length} 组 insight\n  归档 ${report.actions.archived.length} 条\n  删除 ${report.actions.deleted.length} 条`
      : `全局梦境整理完成:\n  ✅ 合并 ${report.actions.merged.length} 条\n  ✅ 提炼 ${report.actions.insights.length} 条 insight\n  📦 归档 ${report.actions.archived.length} 条\n  🗑 删除 ${report.actions.deleted.length} 条\n  📊 健康评分: ${report.healthScore}/10`;
    return { content: [{ type: "text", text }] };
  },
};

export function getToolSchemas(): ToolSchema[] {
  return TOOLS;
}