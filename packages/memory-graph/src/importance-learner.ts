/**
 * memory-graph: ImportanceLearner — 重要性评分自动学习
 *
 * 基于访问频率和引用热度动态调整记忆重要性。
 * 热度数据持久化在 SQLite memory_heat 表中（与 CodeGraph DB 共享），
 * 替代原有的 JSON 文件方案，消除数据一致性问题。
 *
 * 策略:
 *   - 每次被查询命中时，增加临时热度
 *   - 定期聚合: importance = base_importance × 0.7 + heat × 0.3
 *   - 热度随时间衰减（半衰期 7 天）
 *   - 低热度 + 低重要度 → 自动归档候选
 */

import { MemoryDatabase } from "./database";

export interface ImportanceConfig {
  /** 热度半衰期（ms）默认 7 天 */
  heatDecayHalfLifeMs: number;
  /** 学习率（热度对 importance 的影响权重） */
  learningRate: number;
  /** 基础重要性权重 */
  baseWeight: number;
  /** 归档阈值（重要性低于此值且热度为 0） */
  archiveThreshold: number;
}

const DEFAULT_CONFIG: ImportanceConfig = {
  heatDecayHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
  learningRate: 0.3,
  baseWeight: 0.7,
  archiveThreshold: 2,
};

interface HeatRow {
  node_id: string;
  hits: number;
  last_hit_at: number;
  heat_score: number;
  updated_at: number;
}

export class ImportanceLearner {
  private config: ImportanceConfig;
  private memoryDb: MemoryDatabase;
  /** 内存缓存，避免每次读 DB */
  private heatCache = new Map<string, { hits: number; lastHitAt: number; heatScore: number }>();
  /** 脏标记，用于批量写入 */
  private dirtyNodes = new Set<string>();

  constructor(
    memoryDb: MemoryDatabase,
    _dbDir: string, // 保留参数兼容，不再使用
    config?: Partial<ImportanceConfig>,
  ) {
    this.memoryDb = memoryDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadAllHeat();
  }

  // ===== Heat Tracking =====

  /** 记录一次命中（查询返回了这条记忆） */
  recordHit(nodeId: string): void {
    const now = Date.now();
    const cached = this.heatCache.get(nodeId);

    if (!cached) {
      // 检查 DB 是否已有记录
      const row = this.loadHeatRow(nodeId);
      if (row) {
        this.heatCache.set(nodeId, { hits: row.hits, lastHitAt: row.last_hit_at, heatScore: row.heat_score });
      } else {
        this.heatCache.set(nodeId, { hits: 0, lastHitAt: now, heatScore: 0 });
      }
    }

    const entry = this.heatCache.get(nodeId)!;
    entry.hits++;
    entry.lastHitAt = now;

    // Decay old heat then add new heat
    const decayed = this.decay(entry.heatScore, entry.lastHitAt);
    entry.heatScore = Math.min(decayed + 1.0, 10);

    this.dirtyNodes.add(nodeId);

    // Persist periodically (every 10 hits)
    if (entry.hits % 10 === 0) {
      this.flushDirty();
    }
  }

  /** 计算衰减后的热度 */
  private decay(heat: number, lastTime: number): number {
    const elapsed = Date.now() - lastTime;
    const halfLives = elapsed / this.config.heatDecayHalfLifeMs;
    return heat * Math.pow(0.5, halfLives);
  }

  /** 获取当前有效热度 */
  getEffectiveHeat(nodeId: string): number {
    const cached = this.heatCache.get(nodeId);
    if (!cached) return 0;
    // 衰减基于最后命中时间，而非当前时间
    return this.decay(cached.heatScore, cached.lastHitAt);
  }

  // ===== Importance Update =====

  /** 为单条记忆重新计算重要性 */
  updateImportance(nodeId: string): boolean {
    const node = this.memoryDb.getNode(nodeId);
    if (!node) return false;

    const heat = this.getEffectiveHeat(nodeId);
    const baseImportance = node.importance;

    const newImportance = Math.round(
      baseImportance * this.config.baseWeight +
      heat * this.config.learningRate
    );

    const clamped = Math.max(1, Math.min(10, newImportance));

    if (clamped !== node.importance) {
      this.memoryDb.updateNode(nodeId, { importance: clamped });
      return true;
    }
    return false;
  }

  /** 全量更新（定期运行） */
  updateAll(options?: {
    dryRun?: boolean;
    onProgress?: (done: number) => void;
  }): { scanned: number; updated: number; archiveCandidates: string[] } {
    const allNodes = this.memoryDb.searchByText("", 99999);
    let updated = 0;
    const archiveCandidates: string[] = [];

    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];
      const heat = this.getEffectiveHeat(node.id);

      if (options?.dryRun) {
        if (heat <= 0 && node.importance < this.config.archiveThreshold) {
          archiveCandidates.push(node.id);
        }
        continue;
      }

      const newImportance = Math.round(
        node.importance * this.config.baseWeight +
        heat * this.config.learningRate
      );
      const clamped = Math.max(1, Math.min(10, newImportance));

      if (clamped !== node.importance) {
        this.memoryDb.updateNode(node.id, { importance: clamped });
        updated++;
      }

      if (clamped < this.config.archiveThreshold && heat <= 0) {
        archiveCandidates.push(node.id);
      }

      if (options?.onProgress) options.onProgress(i + 1);
    }

    this.flushDirty();
    return { scanned: allNodes.length, updated, archiveCandidates };
  }

  // ===== SQLite Persistence =====

  private loadAllHeat(): void {
    try {
      const rows = this.memoryDb.getRawDb()
        .prepare("SELECT node_id, hits, last_hit_at, heat_score, updated_at FROM memory_heat")
        .all() as HeatRow[];

      for (const row of rows) {
        this.heatCache.set(row.node_id, {
          hits: row.hits,
          lastHitAt: row.last_hit_at,
          heatScore: row.heat_score,
        });
      }
    } catch {
      // memory_heat 表可能不存在（首次运行），静默处理
    }
  }

  private loadHeatRow(nodeId: string): HeatRow | null {
    try {
      const row = this.memoryDb.getRawDb()
        .prepare("SELECT node_id, hits, last_hit_at, heat_score, updated_at FROM memory_heat WHERE node_id = ?")
        .get(nodeId) as HeatRow | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  /** 批量写入脏数据到 SQLite */
  flushDirty(): void {
    if (this.dirtyNodes.size === 0) return;

    const now = Date.now();
    const stmt = this.memoryDb.getRawDb().prepare(`
      INSERT INTO memory_heat (node_id, hits, last_hit_at, heat_score, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        hits = excluded.hits,
        last_hit_at = excluded.last_hit_at,
        heat_score = excluded.heat_score,
        updated_at = excluded.updated_at
    `);

    for (const nodeId of this.dirtyNodes) {
      const entry = this.heatCache.get(nodeId);
      if (entry) {
        stmt.run(nodeId, entry.hits, entry.lastHitAt, Math.round(entry.heatScore * 100) / 100, now);
      }
    }

    this.dirtyNodes.clear();
  }

  /** Prune stale heat entries (nodes that no longer exist) */
  pruneHeatData(): number {
    const allNodes = this.memoryDb.searchByText("", 99999);
    const existingIds = new Set(allNodes.map((n) => n.id));

    let pruned = 0;
    for (const nodeId of this.heatCache.keys()) {
      if (!existingIds.has(nodeId)) {
        this.heatCache.delete(nodeId);
        this.memoryDb.getRawDb()
          .prepare("DELETE FROM memory_heat WHERE node_id = ?")
          .run(nodeId);
        pruned++;
      }
    }

    return pruned;
  }

  /** Export heat data for analysis */
  exportHeatReport(): Array<{ nodeId: string; heat: number; importance: number; title: string }> {
    const report: Array<{ nodeId: string; heat: number; importance: number; title: string }> = [];
    for (const [nodeId, entry] of this.heatCache) {
      const node = this.memoryDb.getNode(nodeId);
      if (node) {
        report.push({
          nodeId,
          heat: this.decay(entry.heatScore, entry.lastHitAt),
          importance: node.importance,
          title: node.title,
        });
      }
    }
    report.sort((a, b) => b.heat - a.heat);
    return report;
  }
}
