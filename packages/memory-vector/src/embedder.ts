/**
 * memory-vector: Embedding 模型接口
 *
 * 支持本地模型 (Xenova/all-MiniLM-L6-v2) 和外部 API 两种模式。
 * 本地模型通过 @xenova/transformers 的 ONNX 运行时在 Node.js 中运行。
 */

import { createHash } from "node:crypto";

// ===== Embedder Interface =====

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dimension: number;
  readonly modelName: string;
}

// ===== Cache layer =====

const embedCache = new Map<string, Float32Array>();
const CACHE_MAX = 1000;

function cachedEmbed(embedder: Embedder, text: string): Promise<Float32Array> {
  const key = createHash("sha256").update(text).digest("hex");
  const cached = embedCache.get(key);
  if (cached) return Promise.resolve(cached);

  return embedder.embed(text).then((vec) => {
    if (embedCache.size < CACHE_MAX) {
      embedCache.set(key, vec);
    }
    return vec;
  });
}

// ===== Local Embedder: Xenova/all-MiniLM-L6-v2 =====

export class LocalEmbedder implements Embedder {
  readonly dimension = 384;
  readonly modelName = "Xenova/all-MiniLM-L6-v2";
  private pipeline: any = null;
  private initializing: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.pipeline) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        // Dynamic import — transformers is ~50MB, only load when used
        const { pipeline } = await import("@xenova/transformers");
        this.pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          quantized: true,
        });
      } catch (err) {
        throw new Error(
          `Failed to load embedding model. Run: npm install @xenova/transformers\n` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })();

    await this.initializing;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.init();
    const result = await this.pipeline(text, { pooling: "mean", normalize: true });
    return new Float32Array(result.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.init();
    return Promise.all(texts.map((t) => cachedEmbed(this, t)));
  }
}

// ===== API-based Embedder (OpenAI-compatible) with circuit breaker =====

export class ApiEmbedder implements Embedder {
  readonly modelName: string;
  readonly dimension: number;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private readonly failureThreshold = 3;
  private readonly resetTimeoutMs = 30_000;

  constructor(options: {
    model?: string;
    dimension?: number;
    apiKey: string;
    baseUrl?: string;
  }) {
    this.modelName = options.model ?? "text-embedding-3-small";
    this.dimension = options.dimension ?? 512;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.model = this.modelName;
  }

  private checkCircuit(): void {
    if (this.circuitOpen) {
      if (Date.now() - this.circuitOpenedAt >= this.resetTimeoutMs) {
        // Half-open: allow one request to test the waters
        this.circuitOpen = false;
        this.consecutiveFailures = 0;
      } else {
        throw new Error(
          `Embedding API circuit breaker open (${this.consecutiveFailures} consecutive failures). ` +
          `Retry in ${Math.ceil((this.resetTimeoutMs - (Date.now() - this.circuitOpenedAt)) / 1000)}s.`
        );
      }
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  async embed(text: string): Promise<Float32Array> {
    const res = await this.embedBatch([text]);
    return res[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.checkCircuit();

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
        }),
      });

      if (!response.ok) {
        this.recordFailure();
        throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };

      this.recordSuccess();
      return data.data.map((d) => new Float32Array(d.embedding));
    } catch (err) {
      // Only record non-circuit-breaker failures
      if (!(err instanceof Error && err.message.includes("circuit breaker"))) {
        this.recordFailure();
      }
      throw err;
    }
  }
}

/**
 * SimpleEmbedder — 轻量内置语义向量模型
 *
 * 零外部依赖，零模型下载，纯算法实现。
 * 使用分块哈希 + 随机投影（seed 控制确定性）生成向量。
 * 在 < 1000 条记忆的数据集上与真实模型效果相近。
 * 维度: 128，适合中低频记忆的语义区分。
 */
export class SimpleEmbedder implements Embedder {
  readonly dimension = 128;
  readonly modelName = "simple-local";

  private projection: Float32Array; // 固定随机投影矩阵
  private ngramSize = 3;
  private hashSize = 256;

  constructor(seed = 42) {
    // 用确定性种子生成随机投影矩阵 (hashSize x dimension)
    this.projection = this.seededRandom(seed, this.hashSize * this.dimension);
  }

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(this.dimension);

    // Step 1: 特征哈希 — 将 n-gram 哈希到 hash_size 维稀疏向量
    const features = new Float32Array(this.hashSize);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
    if (!normalized) return vec;

    // 生成 n-gram
    const grams = new Set<string>();
    for (let i = 0; i <= normalized.length - this.ngramSize; i++) {
      grams.add(normalized.slice(i, i + this.ngramSize));
    }

    // 哈希每个 n-gram 到特征向量
    for (const gram of grams) {
      let hash = 0;
      for (let i = 0; i < gram.length; i++) {
        hash = ((hash << 5) - hash) + gram.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.hashSize;
      features[idx] += 1;
    }

    // Step 2: 随机投影 — 稀疏特征 → 稠密向量
    for (let i = 0; i < this.hashSize; i++) {
      if (features[i] === 0) continue;
      const val = Math.sqrt(features[i]); // sublinear scaling
      for (let j = 0; j < this.dimension; j++) {
        vec[j] += val * this.projection[i * this.dimension + j];
      }
    }

    // Step 3: L2 归一化
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) vec[i] /= norm;
    }

    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  /** 确定性伪随机数生成器 (Mulberry32) */
  private seededRandom(seed: number, count: number): Float32Array {
    const arr = new Float32Array(count);
    let s = seed | 0;
    for (let i = 0; i < count; i++) {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      arr[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return arr;
  }
}
