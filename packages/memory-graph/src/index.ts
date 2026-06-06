/**
 * One Memory — CodeGraph 记忆引擎集成层
 *
 * 直接打开 CodeGraph 的 SQLite 数据库，新增 memory_nodes/memory_edges 表。
 * 不修改 CodeGraph 一行代码。
 *
 * 使用方式:
 *   const db = MemoryDatabase.open("/path/to/codegraph.db");
 *   db.createNode({ title: "修复记录", ... });
 *   db.linkMemoryToCode(memoryId, "PaymentService_process", "关联的bug修复");
 *   const related = db.getRelatedMemories(memoryId);
 */

export { MemoryDatabase } from "./database";
export type {
  MemoryNode,
  MemoryEdge,
  MemoryNodeType,
  MemoryStatus,
  MemorySource,
  EdgeRelation,
  MemoryGraphStats,
} from "./database";
