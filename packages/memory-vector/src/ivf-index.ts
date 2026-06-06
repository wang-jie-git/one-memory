/**
 * memory-vector: IVF 索引 (Inverted File Index)
 *
 * 纯 JS 实现，零外部依赖。通过聚类加速向量搜索：
 *   O(n) → O(n / k * c)
 *   其中 k=簇数量, c=搜索的簇数
 *
 * 使用方法:
 *   const ivf = new IVFIndex(384, 100);  // 384维, 100个簇
 *   ivf.train(vectors);                   // 训练
 *   ivf.add("id-1", vector);             // 添加向量
 *   ivf.search(query, 5);                // 搜索
 */

type Vec = Float32Array;

interface IVFCluster {
  centroid: Vec;
  entries: Array<{ id: string; vector: Vec }>;
}

export class IVFIndex {
  private dimension: number;
  private numClusters: number;
  private clusters: IVFCluster[] = [];
  private trained = false;

  constructor(dimension: number, numClusters: number) {
    this.dimension = dimension;
    this.numClusters = Math.max(1, numClusters);
  }

  get isTrained(): boolean {
    return this.trained;
  }

  get clusterCount(): number {
    return this.clusters.length;
  }

  get totalEntries(): number {
    return this.clusters.reduce((sum, c) => sum + c.entries.length, 0);
  }

  // ===== Training =====

  /**
   * 使用 k-means 训练聚类中心
   */
  train(vectors: Array<{ id: string; vector: Vec }>): void {
    if (vectors.length < this.numClusters) {
      // Fewer vectors than clusters — use each vector as its own cluster
      this.clusters = vectors.map((v) => ({
        centroid: new Float32Array(v.vector),
        entries: [{ id: v.id, vector: v.vector }],
      }));
      this.trained = true;
      return;
    }

    // Initialize centroids: sample k vectors
    const centroids: Vec[] = [];
    const shuffled = [...vectors];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < this.numClusters; i++) {
      centroids.push(new Float32Array(shuffled[i % shuffled.length].vector));
    }

    // K-means iterations
    const MAX_ITER = 20;
    const assignments = new Array(vectors.length).fill(0);

    for (let iter = 0; iter < MAX_ITER; iter++) {
      let changed = 0;

      // Assign each vector to nearest centroid
      for (let i = 0; i < vectors.length; i++) {
        let bestDist = -Infinity;
        let bestCluster = 0;

        for (let j = 0; j < centroids.length; j++) {
          const sim = cosineSimilarity(vectors[i].vector, centroids[j]);
          if (sim > bestDist) {
            bestDist = sim;
            bestCluster = j;
          }
        }

        if (assignments[i] !== bestCluster) {
          assignments[i] = bestCluster;
          changed++;
        }
      }

      if (changed === 0 && iter > 0) break; // Converged

      // Recompute centroids
      const sums: Vec[] = centroids.map(() => new Float32Array(this.dimension));
      const counts = new Array(centroids.length).fill(0);

      for (let i = 0; i < vectors.length; i++) {
        const c = assignments[i];
        for (let d = 0; d < this.dimension; d++) {
          sums[c][d] += vectors[i].vector[d];
        }
        counts[c]++;
      }

      for (let j = 0; j < centroids.length; j++) {
        if (counts[j] > 0) {
          for (let d = 0; d < this.dimension; d++) {
            centroids[j][d] = sums[j][d] / counts[j];
          }
        }
      }
    }

    // Build clusters
    this.clusters = centroids.map(() => ({ centroid: new Float32Array(this.dimension), entries: [] }));
    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      if (this.clusters[c].entries.length === 0) {
        this.clusters[c].centroid = new Float32Array(centroids[c]);
      }
      this.clusters[c].entries.push({ id: vectors[i].id, vector: vectors[i].vector });
    }

    this.trained = true;
  }

  // ===== Add / Delete =====

  /**
   * 添加一个向量到最近的簇
   */
  add(id: string, vector: Vec): void {
    if (!this.trained || this.clusters.length === 0) {
      this.clusters = [{ centroid: new Float32Array(vector), entries: [{ id, vector }] }];
      this.trained = true;
      return;
    }

    // Find nearest cluster
    let bestSim = -Infinity;
    let bestCluster = 0;
    for (let j = 0; j < this.clusters.length; j++) {
      const sim = cosineSimilarity(vector, this.clusters[j].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = j;
      }
    }

    this.clusters[bestCluster].entries.push({ id, vector });
  }

  /**
   * 删除一个向量
   */
  delete(id: string): boolean {
    for (const cluster of this.clusters) {
      const idx = cluster.entries.findIndex((e) => e.id === id);
      if (idx >= 0) {
        cluster.entries.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  // ===== Search =====

  /**
   * 搜索最近的 C 个簇，只在这些簇内暴力搜索
   */
  search(query: Vec, topK: number, searchClusters = 3): Array<{ id: string; score: number }> {
    if (!this.trained || this.clusters.length === 0) {
      return [];
    }

    // Find nearest C clusters
    const clusterSims = this.clusters.map((c, i) => ({
      index: i,
      sim: cosineSimilarity(query, c.centroid),
    }));
    clusterSims.sort((a, b) => b.sim - a.sim);
    const topClusters = clusterSims.slice(0, Math.min(searchClusters, clusterSims.length));

    // Search only those clusters
    const results: Array<{ id: string; score: number }> = [];
    for (const { index } of topClusters) {
      for (const entry of this.clusters[index].entries) {
        const sim = cosineSimilarity(query, entry.vector);
        results.push({ id: entry.id, score: sim });
      }
    }

    // Sort and return top K
    results.sort((a, b) => b.score - a.score);
    // Deduplicate by id
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, topK);
  }

  // ===== Stats =====

  stats(): { clusters: number; entries: number; distribution: number[] } {
    return {
      clusters: this.clusters.length,
      entries: this.totalEntries,
      distribution: this.clusters.map((c) => c.entries.length),
    };
  }
}

// ===== Reuse cosine similarity =====

function cosineSimilarity(a: Vec, b: Vec): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
