/**
 * Memory Watchdog — 健康监控 + 评估报告 + 系统通知
 *
 * 职责链：
 *   定期检查 → 发现问题 → 生成评估报告 → 触发通知回调
 *
 * 评估报告 (EvaluationReport) 是结构化的诊断文档，
 * 包含组件状态、错误汇总、趋势分析和修复建议。
 */

import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
import type { ObsidianWriter } from "../../memory-graph/src/obsidian-writer";
import { MemoryLogger, type LogEntry } from "./memory-logger";

// ===== Core Types =====

export interface ComponentHealth {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export interface HealthStatus {
  healthy: boolean;
  timestamp: number;
  uptimeMs: number;
  graphDb: ComponentHealth;
  vectorStore: ComponentHealth & { totalEntries?: number };
  embedder: ComponentHealth;
  obsidianWriter: ComponentHealth & { count?: number };
  operations: {
    lastWriteOk: boolean;
    lastWriteAgoMs: number;
    lastQueryOk: boolean;
    lastQueryAgoMs: number;
    lastDreamOk: boolean;
    lastDreamAgoMs: number;
  };
  recentErrors: number;
  score: number;
}

export interface WatchdogConfig {
  /** 健康检查间隔 (ms, 默认 60000 = 1分钟) */
  checkIntervalMs: number;
  /** 操作超时阈值 (ms, 默认 5000) */
  operationTimeoutMs: number;
  /** 错误阈值：超过此数量触发告警 (默认 5) */
  errorThreshold: number;
  /** 是否自动启动定时检查 (默认 true) */
  autoStart: boolean;
  /** 历史记录保留条数 (默认 60) */
  historySize: number;
}

// ===== Report Types =====

export interface ComponentScore {
  name: string;
  status: "healthy" | "degraded" | "down";
  score: number; // 0-10
  error?: string;
  latencyMs?: number;
  detail?: string;
}

export interface EvaluationReport {
  /** 报告 ID */
  id: string;
  /** 生成时间 */
  timestamp: number;
  /** 上报类型 */
  type: "periodic" | "on_demand" | "unhealthy_trigger";
  /** 运行时长 */
  uptime: string;

  // ── 总览 ──
  overallScore: number;
  healthy: boolean;
  summary: string;        // 一句话总结
  summaryZh: string;      // 中文一句话总结

  // ── 组件 ──
  components: ComponentScore[];

  // ── 错误 ──
  errorSummary: Array<{
    module: string;
    operation: string;
    message: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
  }>;
  totalErrorsLastHour: number;

  // ── 操作 ──
  operations: {
    lastWriteOk: boolean;
    lastWriteAgo: string;
    lastQueryOk: boolean;
    lastQueryAgo: string;
    lastDreamOk: boolean;
    lastDreamAgo: string;
  };

  // ── 趋势 ──
  trend: "improving" | "stable" | "degrading";
  scoreHistory: number[];

  // ── 诊断 ──
  recommendations: string[];

  // ── 原始数据 ──
  raw: HealthStatus;
}

// ===== Callback Types =====

export type HealthChangeCallback = (status: HealthStatus, previous: HealthStatus | null) => void;
export type UnhealthyCallback = (status: HealthStatus) => void;
export type ReportCallback = (report: EvaluationReport) => void;

// ===== Defaults =====

const DEFAULT_CONFIG: WatchdogConfig = {
  checkIntervalMs: 60000,
  operationTimeoutMs: 5000,
  errorThreshold: 5,
  autoStart: true,
  historySize: 60,
};

// ===== Watchdog =====

export class MemoryWatchdog {
  private config: WatchdogConfig;
  private memoryDb: MemoryDatabase;
  private vectorStore: SqliteVectorStore;
  private embedder: Embedder;
  private obsidianWriter?: ObsidianWriter;
  private logger: MemoryLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: HealthStatus | null = null;
  private _previousStatus: HealthStatus | null = null;
  private _startTime = Date.now();
  private _healthHistory: HealthStatus[] = [];
  private _totalChecks = 0;

  // 操作状态追踪
  private _lastWriteOk = true;
  private _lastWriteTime = Date.now();
  private _lastQueryOk = true;
  private _lastQueryTime = Date.now();
  private _lastDreamOk = true;
  private _lastDreamTime = Date.now();

  private onHealthChangeCallbacks: HealthChangeCallback[] = [];
  private onUnhealthyCallbacks: UnhealthyCallback[] = [];
  private onReportCallbacks: ReportCallback[] = [];

  constructor(
    memoryDb: MemoryDatabase,
    vectorStore: SqliteVectorStore,
    embedder: Embedder,
    logger: MemoryLogger,
    obsidianWriter?: ObsidianWriter,
    config: Partial<WatchdogConfig> = {},
  ) {
    this.memoryDb = memoryDb;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.logger = logger;
    this.obsidianWriter = obsidianWriter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===== Operation Status =====

  recordWrite(success: boolean): void {
    this._lastWriteOk = success;
    this._lastWriteTime = Date.now();
  }

  recordQuery(success: boolean): void {
    this._lastQueryOk = success;
    this._lastQueryTime = Date.now();
  }

  recordDream(success: boolean): void {
    this._lastDreamOk = success;
    this._lastDreamTime = Date.now();
  }

  // ===== Callbacks =====

  /** 健康状态变化时触发 */
  onHealthChange(cb: HealthChangeCallback): void {
    this.onHealthChangeCallbacks.push(cb);
  }

  /** 系统不健康时触发 */
  onUnhealthy(cb: UnhealthyCallback): void {
    this.onUnhealthyCallbacks.push(cb);
  }

  /** 评估报告生成时触发 */
  onReport(cb: ReportCallback): void {
    this.onReportCallbacks.push(cb);
  }

  // ===== Health Check =====

  async checkHealth(type: EvaluationReport["type"] = "periodic"): Promise<HealthStatus> {
    const startTime = performance.now();
    const now = Date.now();

    // Graph DB
    const graphDb = await this.checkComponent(async () => {
      const stats = this.memoryDb.getStats();
      if (stats.totalNodes < 0) throw new Error("Invalid node count");
    });

    // Vector Store
    const vectorStore = await this.checkComponent(async () => {
      const vecStats = this.vectorStore.stats();
      return { totalEntries: vecStats.totalEntries };
    });

    // Embedder
    const embedder = await this.checkComponent(async () => {
      const vec = await this.embedder.embed("health check");
      if (!vec || vec.length === 0) throw new Error("Embedder returned empty vector");
    });

    // Obsidian Writer (if configured)
    let obsidianWriter: ComponentHealth & { count?: number } = { ok: true };
    if (this.obsidianWriter) {
      obsidianWriter = await this.checkComponent(async () => {
        const count = (this.obsidianWriter as any).count?.() ?? 0;
        return { count };
      });
    }

    // Recent errors
    const recentErrors = this.logger.getRecentErrorCount(3600000);

    // Operations health
    const operations = {
      lastWriteOk: this._lastWriteOk,
      lastWriteAgoMs: now - this._lastWriteTime,
      lastQueryOk: this._lastQueryOk,
      lastQueryAgoMs: now - this._lastQueryTime,
      lastDreamOk: this._lastDreamOk,
      lastDreamAgoMs: now - this._lastDreamTime,
    };

    // Overall health
    const healthy = graphDb.ok && vectorStore.ok && embedder.ok && obsidianWriter.ok
      && recentErrors < this.config.errorThreshold;

    // Score (0-10)
    let score = 10;
    if (!graphDb.ok) score -= 3;
    if (!vectorStore.ok) score -= 2;
    if (!embedder.ok) score -= 2;
    if (!obsidianWriter.ok) score -= 1;
    if (recentErrors >= this.config.errorThreshold) score -= 2;
    score = Math.max(0, Math.min(10, score));

    const status: HealthStatus = {
      healthy,
      timestamp: Date.now(),
      uptimeMs: now - this._startTime,
      graphDb,
      vectorStore: { ...vectorStore, ...(vectorStore as any).extra },
      embedder,
      obsidianWriter: { ...obsidianWriter, ...(obsidianWriter as any).extra },
      operations,
      recentErrors,
      score,
    };

    // Clean up extra fields
    delete (status.vectorStore as any).extra;
    delete (status.obsidianWriter as any).extra;

    // Store history
    this._healthHistory.push(status);
    if (this._healthHistory.length > this.config.historySize) {
      this._healthHistory.shift();
    }
    this._totalChecks++;
    this._previousStatus = this._status;
    this._status = status;

    // Trigger callbacks
    const previous = this._previousStatus;
    const healthChanged = previous && previous.healthy !== healthy;

    if (healthChanged) {
      for (const cb of this.onHealthChangeCallbacks) {
        try { cb(status, previous); } catch { /* 不阻塞 */ }
      }
    }

    if (!healthy) {
      this.logger.warn("watchdog", "checkHealth",
        `系统不健康 评分:${score}/10 graphDb:${graphDb.ok} vectorStore:${vectorStore.ok} embedder:${embedder.ok} 错误数:${recentErrors}`,
      );

      // 生成评估报告并通知
      const report = this.generateReport(status, type);
      for (const cb of this.onReportCallbacks) {
        try { cb(report); } catch { /* 不阻塞 */ }
      }

      for (const cb of this.onUnhealthyCallbacks) {
        try { cb(status); } catch { /* 不阻塞 */ }
      }
    }

    const elapsed = Math.round(performance.now() - startTime);
    if (elapsed > 1000) {
      this.logger.warn("watchdog", "checkHealth", `健康检查耗时 ${elapsed}ms，超过预期`);
    }

    return status;
  }

  // ===== Evaluation Report =====

  /**
   * 生成系统评估报告。
   * 报告包含：组件状态、错误汇总、趋势分析、修复建议。
   * 可在不健康时自动生成，也可手动调用。
   */
  generateReport(status?: HealthStatus, type: EvaluationReport["type"] = "on_demand"): EvaluationReport {
    const s = status ?? this._status;
    const now = Date.now();

    // ── 默认状态（无数据时） ──
    if (!s) {
      return {
        id: crypto.randomUUID(),
        timestamp: now,
        type,
        uptime: this.getUptime(),
        overallScore: 10,
        healthy: true,
        summary: "系统初始化中，尚无数据",
        summaryZh: "系统初始化中，尚无数据",
        components: [],
        errorSummary: [],
        totalErrorsLastHour: 0,
        operations: {
          lastWriteOk: true, lastWriteAgo: "N/A",
          lastQueryOk: true, lastQueryAgo: "N/A",
          lastDreamOk: true, lastDreamAgo: "N/A",
        },
        trend: "stable",
        scoreHistory: [],
        recommendations: ["系统初始化中，请等待首次健康检查"],
        raw: {} as HealthStatus,
      };
    }

    // ── 组件评分 ──
    const components = this.scoreComponents(s);

    // ── 错误汇总 ──
    const recentErrors = this.logger.getErrorsSince(now - 3600000);
    const errorSummary = this.summarizeErrors(recentErrors);

    // ── 趋势 ──
    const trend = this.computeTrend();
    const scoreHistory = this._healthHistory.map((h) => h.score);

    // ── 操作格式化 ──
    const fmt = (agoMs: number) => {
      if (agoMs < 60000) return `${Math.round(agoMs / 1000)}s 前`;
      if (agoMs < 3600000) return `${Math.round(agoMs / 60000)}m 前`;
      return `${Math.round(agoMs / 3600000)}h 前`;
    };

    const ops = {
      lastWriteOk: s.operations.lastWriteOk,
      lastWriteAgo: fmt(s.operations.lastWriteAgoMs),
      lastQueryOk: s.operations.lastQueryOk,
      lastQueryAgo: fmt(s.operations.lastQueryAgoMs),
      lastDreamOk: s.operations.lastDreamOk,
      lastDreamAgo: fmt(s.operations.lastDreamAgoMs),
    };

    // ── 推荐建议 ──
    const recommendations = this.generateRecommendations(s);

    // ── 总结 ──
    const { summary, summaryZh } = this.summarize(s);

    return {
      id: crypto.randomUUID(),
      timestamp: now,
      type,
      uptime: this.getUptime(),
      overallScore: s.score,
      healthy: s.healthy,
      summary,
      summaryZh,
      components,
      errorSummary,
      totalErrorsLastHour: s.recentErrors,
      operations: ops,
      trend,
      scoreHistory,
      recommendations,
      raw: s,
    };
  }

  /** 生成格式化文本报告（可直接输出到控制台/通知） */
  formatReport(report?: EvaluationReport): string {
    const r = report ?? this.generateReport();
    const lines: string[] = [];

    // ── 总览 ──
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push(`  记忆系统评估报告`);
    lines.push(`  ${r.summaryZh}`);
    lines.push(`  评分: ${r.overallScore}/10  |  状态: ${r.healthy ? "✅ 健康" : "⚠ 异常"}  |  趋势: ${this.trendEmoji(r.trend)}`);
    lines.push(`  运行时长: ${r.uptime}  |  报告类型: ${r.type}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // ── 组件 ──
    lines.push("");
    lines.push("📊 组件状态:");
    for (const c of r.components) {
      const icon = c.status === "healthy" ? "✅" : c.status === "degraded" ? "⚠" : "❌";
      const lat = c.latencyMs != null ? ` ${c.latencyMs}ms` : "";
      const err = c.error ? `  → ${c.error}` : "";
      lines.push(`  ${icon} ${c.name.padEnd(16)} ${c.score}/10${lat}${err}`);
    }

    // ── 操作 ──
    lines.push("");
    lines.push("⚡ 操作状态:");
    for (const [name, ok, ago] of [
      ["写入", r.operations.lastWriteOk, r.operations.lastWriteAgo],
      ["查询", r.operations.lastQueryOk, r.operations.lastQueryAgo],
      ["梦境", r.operations.lastDreamOk, r.operations.lastDreamAgo],
    ] as const) {
      lines.push(`  ${ok ? "✅" : "❌"} ${name.padEnd(8)} ${ago}`);
    }

    // ── 错误 ──
    if (r.errorSummary.length > 0) {
      lines.push("");
      lines.push(`🚨 近期错误 (${r.totalErrorsLastHour} 条/小时):`);
      for (const e of r.errorSummary.slice(0, 5)) {
        lines.push(`  [${e.module}] ${e.message} (×${e.count})`);
      }
      if (r.errorSummary.length > 5) {
        lines.push(`  ... 还有 ${r.errorSummary.length - 5} 类错误未显示`);
      }
    }

    // ── 评分趋势 ──
    if (r.scoreHistory.length >= 2) {
      const window = r.scoreHistory.slice(-10);
      const bar = window.map((s) => {
        const full = Math.round(s / 2);
        return "█".repeat(full) + "░".repeat(5 - full);
      }).join(" ");
      lines.push("");
      lines.push(`📈 评分趋势 (最近 ${window.length} 次):`);
      lines.push(`  ${bar}`);
    }

    // ── 建议 ──
    if (r.recommendations.length > 0) {
      lines.push("");
      lines.push("💡 修复建议:");
      for (const rec of r.recommendations) {
        lines.push(`  • ${rec}`);
      }
    }

    lines.push("");
    lines.push(`报告 ID: ${r.id}  |  生成时间: ${new Date(r.timestamp).toLocaleString()}`);

    return lines.join("\n");
  }

  // ===== Getters =====

  get lastStatus(): HealthStatus | null {
    return this._status;
  }

  get score(): number {
    return this._status?.score ?? 10;
  }

  get totalChecks(): number {
    return this._totalChecks;
  }

  get healthHistory(): HealthStatus[] {
    return [...this._healthHistory];
  }

  // ===== Auto Check =====

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkHealth("periodic").catch((err) => {
        this.logger.error("watchdog", "autoCheck", `定时检查失败: ${err.message}`, err);
      });
    }, this.config.checkIntervalMs);
    this.logger.info("watchdog", "start", `健康检查已启动，间隔 ${this.config.checkIntervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("watchdog", "stop", "健康检查已停止");
  }

  getUptime(): string {
    const ms = Date.now() - this._startTime;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // ===== Private: Component Scoring =====

  private scoreComponents(s: HealthStatus): ComponentScore[] {
    return [
      {
        name: "图数据库",
        status: s.graphDb.ok ? "healthy" : "down",
        score: s.graphDb.ok ? 10 : 0,
        error: s.graphDb.error,
        latencyMs: s.graphDb.latencyMs,
        detail: s.graphDb.ok ? undefined : "图数据库无响应，记忆关联查询将失败",
      },
      {
        name: "向量库",
        status: s.vectorStore.ok ? "healthy" : "down",
        score: s.vectorStore.ok ? 10 : 0,
        error: s.vectorStore.error,
        latencyMs: s.vectorStore.latencyMs,
        detail: s.vectorStore.ok
          ? `共 ${s.vectorStore.totalEntries} 条向量索引`
          : "向量库不可用，语义搜索将降级",
      },
      {
        name: "Embedder",
        status: s.embedder.ok ? "healthy" : "down",
        score: s.embedder.ok ? 10 : 0,
        error: s.embedder.error,
        latencyMs: s.embedder.latencyMs,
        detail: s.embedder.ok ? undefined : "模型无法响应，任何写入/查询都会失败",
      },
      {
        name: "Obsidian 同步",
        status: s.obsidianWriter.ok ? "healthy" : "degraded",
        score: s.obsidianWriter.ok ? 10 : 3,
        error: s.obsidianWriter.error,
        latencyMs: s.obsidianWriter.latencyMs,
        detail: s.obsidianWriter.ok
          ? s.obsidianWriter.count != null ? `已同步 ${s.obsidianWriter.count} 篇` : ""
          : "Obsidian 同步已关闭或初始化失败",
      },
    ];
  }

  // ===== Private: Error Summarization =====

  private summarizeErrors(errors: LogEntry[]): EvaluationReport["errorSummary"] {
    const groups = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();

    for (const e of errors) {
      const key = `${e.module}:${e.operation}:${e.message}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, e.timestamp);
        existing.firstSeen = Math.min(existing.firstSeen, e.timestamp);
      } else {
        groups.set(key, { count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp });
      }
    }

    return [...groups.entries()]
      .map(([_, v]) => {
        const parts = _.split(":");
        return {
          module: parts[0] ?? "unknown",
          operation: parts[1] ?? "unknown",
          message: parts.slice(2).join(":") ?? "unknown",
          count: v.count,
          firstSeen: v.firstSeen,
          lastSeen: v.lastSeen,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  // ===== Private: Trend =====

  private computeTrend(): "improving" | "stable" | "degrading" {
    if (this._healthHistory.length < 3) return "stable";

    const recent = this._healthHistory.slice(-5);
    const scores = recent.map((h) => h.score);
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));

    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (avg2 - avg1 > 0.5) return "improving";
    if (avg1 - avg2 > 0.5) return "degrading";
    return "stable";
  }

  // ===== Private: Recommendations =====

  private generateRecommendations(s: HealthStatus): string[] {
    const recs: string[] = [];

    if (!s.graphDb.ok) {
      recs.push("图数据库连接失败 — 检查 codegraph.db 文件权限或磁盘空间");
      recs.push("运行 one-memory check 重置索引");
    }
    if (!s.vectorStore.ok) {
      recs.push("向量库异常 — 尝试运行 one-memory rebuild 重建向量索引");
    }
    if (!s.embedder.ok) {
      recs.push(`Embedding 模型不可用 — ${s.embedder.error}`);
      recs.push("检查模型文件是否完整，或切换到 API embedder");
    }
    if (!s.obsidianWriter.ok) {
      recs.push("Obsidian 同步异常 — 检查 vault 路径配置和写入权限");
    }
    if (!s.operations.lastWriteOk) {
      recs.push("最近写入失败 — 检查存储空间和 Embedder 状态");
    }
    if (!s.operations.lastDreamOk) {
      recs.push("最近梦境整理失败 — 运行 one-memory dream 手动触发");
    }
    if (s.recentErrors >= this.config.errorThreshold) {
      recs.push(`1 小时内错误数 (${s.recentErrors}) 超过阈值 (${this.config.errorThreshold}) — 建议检查日志定位根因`);
    }
    if (s.score < 4) {
      recs.push("系统健康严重不足 — 建议立即排查并重启记忆系统");
    }

    return recs;
  }

  // ===== Private: Summary =====

  private summarize(s: HealthStatus): { summary: string; summaryZh: string } {
    const failed = [
      !s.graphDb.ok && "GraphDB",
      !s.vectorStore.ok && "VectorStore",
      !s.embedder.ok && "Embedder",
      !s.obsidianWriter.ok && "Obsidian",
    ].filter(Boolean);

    if (failed.length === 0) {
      return {
        summary: `All systems operational, score ${s.score}/10`,
        summaryZh: `所有组件正常运行，评分 ${s.score}/10`,
      };
    }

    return {
      summary: `${failed.join(", ")} malfunctioning, score ${s.score}/10`,
      summaryZh: `${failed.join("、")} 异常，评分 ${s.score}/10`,
    };
  }

  private trendEmoji(t: string): string {
    switch (t) {
      case "improving": return "📈";
      case "degrading": return "📉";
      default: return "➡";
    }
  }

  // ===== Private: Component Check =====

  private async checkComponent<T>(
    fn: () => Promise<T>,
  ): Promise<ComponentHealth & { extra?: T }> {
    const start = performance.now();
    try {
      const result = await fn();
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        extra: result,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }
}
