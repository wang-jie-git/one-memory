# Spec 02: CodeGraph Memory Node Schema

**状态**: Draft | **优先级**: P0 | **最后更新**: 2026-06-06

## 1. 节点类型定义

### `memory_entry`

```typescript
interface MemoryEntry {
  // === 必填字段 ===
  id: string;                    // UUID v4
  type: "memory_entry";
  label: string;                 // 显示标签（节点标题，用于图展示）
  title: string;                 // 完整标题
  summary: string;               // 摘要 1-3 句话（用于向量 embedding）
  content_hash: string;          // SHA256 of body content
  
  // === 元数据 ===
  importance: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  created_at: number;            // Unix timestamp ms
  updated_at: number;
  ttl_days: number | null;       // null = 永不过期
  
  // === 来源追踪 ===
  source: "agent" | "user" | "system" | "codegraph" | "imported";
  source_session: string | null; // 来源会话 ID
  
  // === 向量关联 ===
  vector_id: string | null;      // 向量库中的对应 ID
  last_embedded_at: number | null;
  
  // === 状态 ===
  status: "active" | "archived" | "pending_review";
  tags: string[];                // 标签（语义检索辅助）
}
```

### `decision` (extends `memory_entry`)

```typescript
interface Decision extends MemoryEntry {
  type: "decision";
  context: string;               // 决策背景（markdown）
  options: Array<{
    name: string;
    description: string;
    pros: string[];
    cons: string[];
  }>;
  chosen: string;                // 选定选项的 name
  rationale: string;             // 选择理由
  outcome: "success" | "failure" | "pending" | "unknown";
  outcome_evidence: string | null;  // 结果证据（链接/描述）
}
```

### `project_milestone` (extends `memory_entry`)

```typescript
interface ProjectMilestone extends MemoryEntry {
  type: "project_milestone";
  milestone_date: number;        // 里程碑日期
  phase: string;                 // 阶段名
  key_deliverables: string[];
  participants: string[];
}
```

## 2. 边类型定义

### `links_to_code`

```typescript
interface LinksToCode {
  type: "links_to_code";
  source: string;                // memory_entry.id
  target: string;                // codegraph symbol id
  strength: "strong" | "weak" | "auto_detected" | "user_confirmed";
  direction: "memory_to_code" | "code_to_memory";  // 谁指向谁
  description: string;           // 关联说明
  created_at: number;
  auto_confidence?: number;      // 自动关联时的置信度 0-1
}
```

### `links_to_memory`

```typescript
interface LinksToMemory {
  type: "links_to_memory";
  source: string;
  target: string;
  relation: 
    | "causes"           // A 导致了 B
    | "fixes"            // A 修复了 B
    | "precedes"         // A 早于 B（时序）
    | "follows"          // A 晚于 B（时序）
    | "references"       // A 引用了 B
    | "contradicts"      // A 与 B 矛盾
    | "supersedes"       // A 取代了 B（新决策替代旧决策）
    | "relates_to"       // 弱关联（默认）
    | "implements"       // A 实现了 B 的决策
    | "questions";       // A 对 B 提出质疑
  weight: number;                // 0.0 - 1.0 关联强度
  description: string;
}
```

## 3. 图重要度传播

```
MemoryEntry 的 importance 不是最终值，会通过边传播：

effective_importance(node) = 
  node.importance * 0.7 + 
  avg(incoming_links_to_memory.weight * source.effective_importance) * 0.2 +
  avg(incoming_links_to_code) * 0.1

传播边界：max_depth=3，防止全图震荡
```

## 4. CodeGraph API 扩展

```typescript
// 新增 API（注册到 CodeGraph 引擎）

// 记忆节点操作
createMemoryEntry(data: MemoryEntry): string;    // 返回 node_id
getMemoryEntry(id: string): MemoryEntry | null;
updateMemoryEntry(id: string, data: Partial<MemoryEntry>): void;
deleteMemoryEntry(id: string): void;

// 关联操作
linkMemoryToCode(memoryId: string, codeSymbolId: string, strength: string): void;
linkMemoryToMemory(sourceId: string, targetId: string, relation: string, weight: number): void;

// 查询操作
getRelatedMemories(nodeId: string, options: {
  depth?: number;               // 遍历深度
  relationTypes?: string[];     // 过滤关系类型
  minWeight?: number;           // 最小关联权重
}): MemoryGraphQueryResult[];

// 图健康
getMemoryStats(): { totalNodes: number; totalEdges: number; byType: Record<string, number> };
```
