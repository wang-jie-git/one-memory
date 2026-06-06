/**
 * Memory Watchdog — 健康监控与系统通知
 *
 * 定期检查记忆系统各组件的健康状态，
 * 发现问题时触发通知回调。
 *
 * 检查项：
 *   graphDb     — SQLite 连接 + 节点查询
 *   vectorStore — 向量库可达 + 条目计数
 *   embedder    — embedding 模型响应
 *   obsidian    — Obsidian 文件写入
 *   operations  — 最近读写梦境是否正常
 */

import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
import type { ObsidianWriter } from "../../memory-graph/src/obsidian-writer";
import { MemoryLogger } from "./memory-logger";

// ===== Types =====

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
  score: number; // 0-10
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
}

export type HealthChangeCallback = (status: HealthStatus, previous: HealthStatus | null) => void;
export type UnhealthyCallback = (status: HealthStatus) => void;

const DEFAULT_CONFIG: WatchdogConfig = {
  checkIntervalMs: 60000,
  operationTimeoutMs: 5000,
  errorThreshold: 5,
  autoStart: true,
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

  // 操作状态追踪
  private _lastWriteOk = true;
  private _lastWriteTime = Date.now();
  private _lastQueryOk = true;
  private _lastQueryTime = Date.now();
  private _lastDreamOk = true;
  private _lastDreamTime = Date.now();

  private onHealthChangeCallbacks: HealthChangeCallback[] = [];
  private onUnhealthyCallbacks: UnhealthyCallback[] = [];

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

  // ===== Operation Status (由 MemorySystem 调用) =====

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

  // ===== Health Check =====

  async checkHealth(): Promise<HealthStatus> {
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
    const lastWriteAgoMs = now - this._lastWriteTime;
    const lastQueryAgoMs = now - this._lastQueryTime;
    const lastDreamAgoMs = now - this._lastDreamTime;

    const operations = {
      lastWriteOk: this._lastWriteOk,
      lastWriteAgoMs,
      lastQueryOk: this._lastQueryOk,
      lastQueryAgoMs,
      lastDreamOk: this._lastDreamOk,
      lastDreamAgoMs,
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

    this._previousStatus = this._status;
    this._status = status;

    // 触发回调
    const previous = this._previousStatus;
    const healthChanged = previous && previous.healthy !== healthy;
    if (healthChanged) {
      for (const cb of this.onHealthChangeCallbacks) {
        try { cb(status, previous); } catch { /* 不阻塞 */ }
      }
    }

    if (!healthy) {
      // Log the unhealthy status
      this.logger.warn("watchdog", "checkHealth",
        `系统不健康 评分:${score}/10 graphDb:${graphDb.ok} vectorStore:${vectorStore.ok} embedder:${embedder.ok} 错误数:${recentErrors}`,
      );

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

  /** 获取最近一次健康状态 */
  get lastStatus(): HealthStatus | null {
    return this._status;
  }

  /** 获取系统健康评分 (0-10) */
  get score(): number {
    return this._status?.score ?? 10;
  }

  // ===== Auto Check =====

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkHealth().catch((err) => {
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

  /** 获取 uptime 格式化字符串 */
  getUptime(): string {
    const ms = Date.now() - this._startTime;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  // ===== Private =====

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
