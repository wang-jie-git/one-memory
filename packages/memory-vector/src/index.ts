/**
 * memory-vector: 主入口
 *
 * 将向量存储和 embedding 模型组合为统一的检索能力。
 */

export { SqliteVectorStore } from "./vector-store";
export { LocalEmbedder, ApiEmbedder } from "./embedder";
export type { Embedder } from "./embedder";
export type {
  VectorMetadata,
  VectorEntry,
  VectorQueryOptions,
  VectorResult,
  VectorStoreStats,
} from "./vector-store";
