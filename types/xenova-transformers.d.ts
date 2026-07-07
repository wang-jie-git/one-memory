declare module '@xenova/transformers' {
  export { pipeline, env } from '@xenova/transformers';
  
  export interface EmbeddingOutput {
    embedding: number[];
  }
}
