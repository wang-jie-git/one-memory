/**
 * One Memory MCP — 记忆系统工具定义
 *
 * 给 Agent 提供 6 个记忆操作工具：
 *   write   — 写入记忆（自动图+向量索引）
 *   query   — 语义+结构混合搜索
 *   dream   — 触发梦境整理（熵减）
 *   health  — 健康检查
 *   logs    — 最近日志
 *   report  — 评估报告
 *   stats   — 系统统计
 */

// 直接导入 MemorySystem（相对路径，不依赖 workspace 解析）
import { MemorySystem } from "../../memory-orchestrator/src/memory-system";
import type { MemoryNodeType } from "../../memory-graph/src/database";

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
  // ── write ──
  {
    name: "memory_write",
    description: "写入一条长期记忆（自动索引到图+向量库）",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "记忆标题（必填，简短精确）" },
        summary: { type: "string", description: "一句话摘要（AI 读取用，建议 <100 字符）" },
        body: { type: "string", description: "详细内容（可选，人类阅读用）" },
        importance: { type: "number", description: "重要性 1-10（默认 5）", default: 5 },
        tags: { type: "array", items: { type: "string" }, description: "标签数组" },
        type: { type: "string", enum: ["memory_entry", "decision", "project_milestone", "insight"], description: "节点类型" },
        ttl_days: { type: "number", description: "自动过期天数（不填则永不过期）" },
      },
      required: ["title"],
    },
  },

  // ── query ──
  {
    name: "memory_query",
    description: "语义搜索记忆（支持模糊匹配，返回结构化结果）",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索文本（自然语言即可）" },
        limit: { type: "number", description: "最多返回条数（默认 5）", default: 5 },
        min_importance: { type: "number", description: "最低重要性过滤（1-10）" },
      },
      required: ["query"],
    },
  },

  // ── dream ──
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

  // ── health ──
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

  // ── logs ──
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

  // ── report ──
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

  // ── stats ──
  {
    name: "memory_stats",
    description: "记忆系统统计数据（图节点数、向量数、写入/查询/梦境计数）",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ===== Tool Handlers =====

export type ToolHandler = (
  ms: MemorySystem,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

export const HANDLERS: Record<string, ToolHandler> = {
  // ── write ──
  async memory_write(ms, args) {
    const node = await ms.write({
      title: String(args.title),
      summary: args.summary as string | undefined,
      body: args.body as string | undefined,
      importance: (args.importance as number) ?? 5,
      tags: (args.tags as string[]) ?? [],
      nodeType: (args.type as MemoryNodeType) ?? "memory_entry",
      ttlDays: (args.ttl_days as number | null) ?? null,
    });
    return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
  },

  // ── query ──
  async memory_query(ms, args) {
    const filter = args.min_importance != null
      ? { importanceMin: Number(args.min_importance) }
      : undefined;
    const result = await ms.query(String(args.query), filter);
    const limit = (args.limit as number) ?? 5;
    const results = result.results.slice(0, limit);

    const text = results.map((r, i) => {
      return `[${i + 1}] ${r.title}\n    重要性: ${r.metadata.importance}/10  |  评分: ${r.score.toFixed(2)}\n    摘要: ${r.summary}\n    标签: #${r.metadata.tags.join(" #")}`;
    }).join("\n\n");

    return {
      content: [{ type: "text", text: text || "无匹配结果" }],
    };
  },

  // ── dream ──
  async memory_dream(ms, args) {
    const dryRun = (args.dry_run as boolean) ?? false;
    const report = await ms.dream(dryRun);
    const text = dryRun
      ? `[预览模式] 梦境整理将执行:\n  合并 ${report.actions.merged.length} 条冗余\n  聚类 ${report.actions.insights.length} 组 insight\n  归档 ${report.actions.archived.length} 条低价值\n  删除 ${report.actions.deleted.length} 条过期`
      : `梦境整理完成:\n  ✅ 合并 ${report.actions.merged.length} 条冗余\n  ✅ 提炼 ${report.actions.insights.length} 条 insight\n  📦 归档 ${report.actions.archived.length} 条\n  🗑 删除 ${report.actions.deleted.length} 条\n  📊 健康评分: ${report.healthScore}/10\n  ⏱ 耗时: ${report.duration}ms`;
    return { content: [{ type: "text", text }] };
  },

  // ── health ──
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

  // ── logs ──
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

  // ── report ──
  async memory_report(ms, args) {
    const format = (args.format as string) ?? "text";
    const report = ms.generateReport();

    if (format === "json") {
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }

    return { content: [{ type: "text", text: ms.formatReport(report) }] };
  },

  // ── stats ──
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
};

export function getToolSchemas(): ToolSchema[] {
  return TOOLS;
}
