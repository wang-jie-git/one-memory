/**
 * memory-graph: ImportanceLearner — 重要性评分自动学习
 *
 * 基于访问频率和引用热度动态调整记忆重要性。
 *
 * 策略:
 *   - 每次被查询命中时，增加临时热度
 *   - 定期聚合: importance = base_importance × 0.7 + heat × 0.3
 *   - 热度随时间衰减（半衰期 7 天）
 *   - 低热度 + 低重要度 → 自动归档候选
 */

import { MemoryDatabase } from "./database";
import * as fs from "node:fs";
import * as path from "node:path";

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

/**
 * 热度跟踪存储在单独的 JSON 文件中（避免修改 CodeGraph DB schema）
 */
interface HeatData {
  [nodeId: string]: {
    hits: number;           // 累计命中次数
    lastHitAt: number;      // 最后命中时间戳
    heatScore: number;      // 当前热度值 0-10
  };
}

export class ImportanceLearner {
  private config: ImportanceConfig;
  private memoryDb: MemoryDatabase;
  private heatData: HeatData = {};
  private heatFilePath: string;

  constructor(
    memoryDb: MemoryDatabase,
    dbDir: string,
    config?: Partial<ImportanceConfig>,
  ) {
    this.memoryDb = memoryDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.heatFilePath = path.join(dbDir, "memory-heat.json");
    this.loadHeatData();
  }

  // ===== Heat Tracking =====

  /** 记录一次命中（查询返回了这条记忆） */
  recordHit(nodeId: string): void {
    const now = Date.now();
    if (!this.heatData[nodeId]) {
      this.heatData[nodeId] = { hits: 0, lastHitAt: now, heatScore: 0 };
    }

    const entry = this.heatData[nodeId];
    entry.hits++;
    entry.lastHitAt = now;

    // Decay old heat then add new heat
    const decayed = this.decay(entry.heatScore, entry.lastHitAt);
    entry.heatScore = Math.min(decayed + 1.0, 10);

    // Persist periodically (every 10 hits)
    if (entry.hits % 10 === 0) {
      this.saveHeatData();
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
    const entry = this.heatData[nodeId];
    if (!entry) return 0;
    return this.decay(entry.heatScore, entry.lastHitAt);
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

    this.saveHeatData();
    return { scanned: allNodes.length, updated, archiveCandidates };
  }

  // ===== Persistence =====

  private loadHeatData(): void {
    try {
      if (fs.existsSync(this.heatFilePath)) {
        this.heatData = JSON.parse(fs.readFileSync(this.heatFilePath, "utf-8"));
      }
    } catch {
      this.heatData = {};
    }
  }

  private saveHeatData(): void {
    try {
      const dir = path.dirname(this.heatFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.heatFilePath, JSON.stringify(this.heatData, null, 2), "utf-8");
    } catch {
      // Non-critical — heat data can be rebuilt
    }
  }

  /** Prune stale heat entries (nodes that no longer exist) */
  pruneHeatData(): number {
    let pruned = 0;
    for (const nodeId of Object.keys(this.heatData)) {
      if (!this.memoryDb.getNode(nodeId)) {
        delete this.heatData[nodeId];
        pruned++;
      }
    }
    if (pruned > 0) this.saveHeatData();
    return pruned;
  }

  /** Export heat data for analysis */
  exportHeatReport(): Array<{ nodeId: string; heat: number; importance: number; title: string }> {
    const report: Array<{ nodeId: string; heat: number; importance: number; title: string }> = [];
    for (const [nodeId, entry] of Object.entries(this.heatData)) {
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
