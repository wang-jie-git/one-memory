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

// ===== API-based Embedder (OpenAI-compatible) =====

export class ApiEmbedder implements Embedder {
  readonly modelName: string;
  readonly dimension: number;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

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

  async embed(text: string): Promise<Float32Array> {
    const res = await this.embedBatch([text]);
    return res[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
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
      throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map((d) => new Float32Array(d.embedding));
  }
}
