declare module './memory-system' {
  export interface MemorySystemConfig {
    codegraphDir: string;
    embedder: string;
    obsidianVaultPath?: string;
    obsidianSubDir?: string;
    writeBufferSize?: number;
  }

  export interface MemorySystemStats {
    graph: { totalNodes: number; totalEdges: number };
    vector: { total: number; dimension: number };
    obsidian: number;
    bufferPending: number;
  }

  export interface MemoryNode {
    id: string;
    title: string;
    summary: string;
    body?: string;
    importance?: number;
    tags?: string[];
    type: string;
    ttl_days?: number;
  }

  export class MemorySystem {
    static init(config: MemorySystemConfig): Promise<MemorySystem>;
    stats(): MemorySystemStats;
    shutdown(): Promise<void>;
    write(data: Partial<MemoryNode>): Promise<MemoryNode>;
    query(text: string, options?: { limit?: number; min_importance?: number }): Promise<MemoryNode[]>;
  }
}
