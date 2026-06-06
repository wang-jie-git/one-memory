// One Memory — CodeGraph 记忆引擎集成层
// 本文件定义 memory-graph 包的核心类型和接口

// === 节点类型 ===

export interface MemoryEntry {
  id: string;
  type: "memory_entry";
  label: string;
  title: string;
  summary: string;
  content_hash: string;
  importance: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  created_at: number;
  updated_at: number;
  ttl_days: number | null;
  source: "agent" | "user" | "system" | "codegraph" | "imported";
  source_session: string | null;
  vector_id: string | null;
  last_embedded_at: number | null;
  status: "active" | "archived" | "pending_review";
  tags: string[];
}

export interface Decision extends MemoryEntry {
  type: "decision";
  context: string;
  options: Array<{
    name: string;
    description: string;
    pros: string[];
    cons: string[];
  }>;
  chosen: string;
  rationale: string;
  outcome: "success" | "failure" | "pending" | "unknown";
  outcome_evidence: string | null;
}

export interface ProjectMilestone extends MemoryEntry {
  type: "project_milestone";
  milestone_date: number;
  phase: string;
  key_deliverables: string[];
  participants: string[];
}

// === 边类型 ===

export interface LinksToCode {
  type: "links_to_code";
  source: string;
  target: string;
  strength: "strong" | "weak" | "auto_detected" | "user_confirmed";
  direction: "memory_to_code" | "code_to_memory";
  description: string;
  created_at: number;
  auto_confidence?: number;
}

export interface LinksToMemory {
  type: "links_to_memory";
  source: string;
  target: string;
  relation:
    | "causes"
    | "fixes"
    | "precedes"
    | "follows"
    | "references"
    | "contradicts"
    | "supersedes"
    | "relates_to"
    | "implements"
    | "questions";
  weight: number;
  description: string;
}

// === 查询类型 ===

export interface MemoryQueryOptions {
  depth?: number;
  relationTypes?: string[];
  minWeight?: number;
}

export interface MemoryGraphQueryResult {
  node: MemoryEntry;
  score: number;
  relations: Array<{
    type: string;
    direction: "incoming" | "outgoing";
    strength: number;
  }>;
}

// === API 接口 ===

export interface MemoryGraphAPI {
  // 节点操作
  createMemoryEntry(data: MemoryEntry): string;
  getMemoryEntry(id: string): MemoryEntry | null;
  updateMemoryEntry(id: string, data: Partial<MemoryEntry>): void;
  deleteMemoryEntry(id: string): void;

  // 关联操作
  linkMemoryToCode(
    memoryId: string,
    codeSymbolId: string,
    strength: string,
  ): void;
  linkMemoryToMemory(
    sourceId: string,
    targetId: string,
    relation: string,
    weight: number,
  ): void;

  // 查询
  getRelatedMemories(
    nodeId: string,
    options?: MemoryQueryOptions,
  ): MemoryGraphQueryResult[];

  // 维护
  getMemoryStats(): {
    totalNodes: number;
    totalEdges: number;
    byType: Record<string, number>;
  };
}

// === 默认导出 ===
export function createMemoryGraphAPI(): MemoryGraphAPI {
  throw new Error("Not implemented yet — Phase 1 target");
}
