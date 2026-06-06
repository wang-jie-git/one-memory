/**
 * memory-graph: Database Connection
 *
 * Opens the same SQLite database as CodeGraph (node:sqlite, Node 22.5+)
 * and manages memory-specific schema migrations.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ===== SQLite Adapter (thin wrapper over node:sqlite) =====

interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDB {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  readonly open: boolean;
}

function createDB(dbPath: string): SqliteDB {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");
  return {
    prepare(sql: string): SqliteStatement {
      const stmt = raw.prepare(sql);
      return {
        run(...params: unknown[]) {
          const r = stmt.run(...params);
          return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid ?? 0 };
        },
        get(...params: unknown[]) {
          return stmt.get(...params) as Record<string, unknown> | undefined;
        },
        all(...params: unknown[]) {
          return stmt.all(...params) as Record<string, unknown>[];
        },
      };
    },
    exec(sql: string) {
      raw.exec(sql);
    },
    close() {
      if (raw.isOpen) raw.close();
    },
    get open() {
      return raw.isOpen;
    },
  };
}

// ===== Memory Types =====

export type MemoryNodeType = "memory_entry" | "decision" | "project_milestone";
export type MemoryStatus = "active" | "archived" | "pending_review";
export type MemorySource = "agent" | "user" | "system" | "imported";
export type EdgeRelation =
  | "links_to_code"
  | "causes" | "fixes" | "precedes" | "follows"
  | "references" | "contradicts" | "supersedes"
  | "relates_to" | "implements" | "questions";

export interface MemoryNode {
  id: string;
  title: string;
  summary: string;
  body: string;
  contentHash: string;
  importance: number;
  status: MemoryStatus;
  source: MemorySource;
  sourceSession: string | null;
  tags: string[];
  nodeType: MemoryNodeType;
  createdAt: number;
  updatedAt: number;
  ttlDays: number | null;
}

export interface MemoryEdge {
  id: number;
  sourceType: "memory" | "code";
  sourceId: string;
  targetType: "memory" | "code";
  targetId: string;
  relation: EdgeRelation;
  weight: number;
  description: string;
  createdAt: number;
}

export interface MemoryGraphStats {
  totalNodes: number;
  totalEdges: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  codeLinked: number;
}

// ===== Database Connection =====

const MEMORY_SCHEMA_VERSION = 1;

export class MemoryDatabase {
  private db: SqliteDB;
  private dbPath: string;

  private constructor(db: SqliteDB, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /** Open or create memory tables in an existing CodeGraph database */
  static open(dbPath: string): MemoryDatabase {
    const exists = fs.existsSync(dbPath);
    if (!exists) {
      throw new Error(`CodeGraph database not found: ${dbPath}\nRun codegraph index first.`);
    }

    const db = createDB(dbPath);
    const memdb = new MemoryDatabase(db, dbPath);
    memdb.migrate();
    return memdb;
  }

  /** Create a fresh database (for testing) */
  static create(dbPath: string): MemoryDatabase {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = createDB(dbPath);
    const memdb = new MemoryDatabase(db, dbPath);
    memdb.migrate();
    return memdb;
  }

  private migrate(): void {
    // Check if memory_schema_versions table exists
    const tableCheck = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_schema_versions'")
      .get() as { name: string } | undefined;

    let currentVersion = 0;
    if (tableCheck) {
      const row = this.db
        .prepare("SELECT version FROM memory_schema_versions ORDER BY version DESC LIMIT 1")
        .get() as { version: number } | undefined;
      currentVersion = row?.version ?? 0;
    }

    if (currentVersion < MEMORY_SCHEMA_VERSION) {
      // Load and execute schema
      const schemaPath = path.join(__dirname, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      this.db.exec(schema);

      // Record version
      this.db
        .prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)")
        .run(MEMORY_SCHEMA_VERSION, Date.now(), "Initial memory schema");
    }
  }

  // ===== Node Operations =====

  createNode(data: Omit<MemoryNode, "id" | "contentHash" | "createdAt" | "updatedAt"> & { id?: string }): MemoryNode {
    const id = data.id ?? crypto.randomUUID();
    const now = Date.now();
    const contentHash = createHash("sha256").update(data.summary + data.body).digest("hex");

    this.db
      .prepare(`
        INSERT INTO memory_nodes (id, title, summary, body, content_hash, importance, status, source, source_session, tags, node_type, created_at, updated_at, ttl_days)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.title,
        data.summary ?? "",
        data.body ?? "",
        contentHash,
        data.importance ?? 5,
        data.status ?? "active",
        data.source ?? "agent",
        data.sourceSession ?? null,
        JSON.stringify(data.tags ?? []),
        data.nodeType ?? "memory_entry",
        now,
        now,
        data.ttlDays ?? null,
      );

    return {
      id, ...data,
      contentHash,
      createdAt: now,
      updatedAt: now,
    };
  }

  getNode(id: string): MemoryNode | null {
    const row = this.db
      .prepare("SELECT * FROM memory_nodes WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToNode(row);
  }

  updateNode(id: string, data: Partial<Omit<MemoryNode, "id" | "createdAt">>): boolean {
    const existing = this.getNode(id);
    if (!existing) return false;

    const now = Date.now();
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (data.title !== undefined) { updates.push("title = ?"); params.push(data.title); }
    if (data.summary !== undefined) { updates.push("summary = ?"); params.push(data.summary); }
    if (data.body !== undefined) { updates.push("body = ?"); params.push(data.body); }
    if (data.importance !== undefined) { updates.push("importance = ?"); params.push(data.importance); }
    if (data.status !== undefined) { updates.push("status = ?"); params.push(data.status); }
    if (data.tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(data.tags)); }
    if (data.ttlDays !== undefined) { updates.push("ttl_days = ?"); params.push(data.ttlDays); }

    params.push(id);
    this.db.prepare(`UPDATE memory_nodes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return true;
  }

  deleteNode(id: string): boolean {
    const result = this.db.prepare("DELETE FROM memory_nodes WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ===== Edge Operations =====

  createEdge(data: Omit<MemoryEdge, "id" | "createdAt">): MemoryEdge {
    const now = Date.now();
    const result = this.db
      .prepare(`
        INSERT INTO memory_edges (source_type, source_id, target_type, target_id, relation, weight, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(data.sourceType, data.sourceId, data.targetType, data.targetId, data.relation, data.weight, data.description, now);

    return { id: Number(result.lastInsertRowid), ...data, createdAt: now };
  }

  linkMemoryToCode(memoryId: string, codeSymbolId: string, description = ""): MemoryEdge {
    return this.createEdge({
      sourceType: "memory",
      sourceId: memoryId,
      targetType: "code",
      targetId: codeSymbolId,
      relation: "links_to_code",
      weight: 1.0,
      description,
    });
  }

  linkMemoryToMemory(
    sourceId: string,
    targetId: string,
    relation: EdgeRelation,
    weight = 1.0,
    description = "",
  ): MemoryEdge {
    // 'links_to_code' is not valid for memory-to-memory links
    if (relation === "links_to_code") {
      throw new Error("Use linkMemoryToCode for memory-to-code links");
    }
    return this.createEdge({
      sourceType: "memory",
      sourceId,
      targetType: "memory",
      targetId,
      relation,
      weight,
      description,
    });
  }

  // ===== Query Operations =====

  /** Get memory entry with its code symbol associations (joins CodeGraph's nodes table) */
  getMemoryWithCodeSymbols(memoryId: string) {
    const rows = this.db
      .prepare(`
        SELECT
          me.relation, me.weight, me.description AS edge_description,
          n.id AS code_id, n.name AS code_name, n.kind AS code_kind,
          n.file_path, n.qualified_name, n.signature
        FROM memory_edges me
        JOIN nodes n ON n.id = me.target_id
        WHERE me.source_id = ?
          AND me.source_type = 'memory'
          AND me.target_type = 'code'
          AND me.relation = 'links_to_code'
      `)
      .all(memoryId) as Record<string, unknown>[];

    return rows.map((r) => ({
      relation: r.relation as string,
      weight: r.weight as number,
      description: r.edge_description as string,
      symbol: {
        id: r.code_id as string,
        name: r.code_name as string,
        kind: r.code_kind as string,
        filePath: r.file_path as string,
        qualifiedName: r.qualified_name as string,
      },
    }));
  }

  /** Get related memory entries (graph traversal, depth=1) */
  getRelatedMemories(memoryId: string, options?: {
    depth?: number;
    relationTypes?: EdgeRelation[];
    minWeight?: number;
  }): Array<{
    node: MemoryNode;
    relation: EdgeRelation;
    weight: number;
    direction: "incoming" | "outgoing";
  }> {
    const maxDepth = options?.depth ?? 1;
    const relationFilter = options?.relationTypes;
    const minWeight = options?.minWeight ?? 0;

    if (maxDepth < 1) return [];

    // Depth 1: direct edges
    const rows = this.db
      .prepare(`
        SELECT
          me.relation, me.weight, me.source_type, me.target_type,
          me.source_id, me.target_id,
          mn.id AS node_id, mn.title, mn.summary,
          mn.importance, mn.status, mn.tags, mn.node_type,
          mn.created_at, mn.updated_at, mn.source
        FROM memory_edges me
        JOIN memory_nodes mn ON (
          (me.source_id = ? AND me.target_type = 'memory' AND me.target_id = mn.id)
          OR
          (me.target_id = ? AND me.source_type = 'memory' AND me.source_id = mn.id)
        )
        WHERE (
          (me.source_id = ? AND me.source_type = 'memory')
          OR
          (me.target_id = ? AND me.target_type = 'memory')
        )
        ${relationFilter ? `AND me.relation IN (${relationFilter.map(() => "?").join(",")})` : ""}
        AND me.weight >= ?
      `)
      .all(
        memoryId, memoryId, memoryId, memoryId,
        ...(relationFilter ?? []),
        minWeight,
      ) as Record<string, unknown>[];

    const results: Array<{
      node: MemoryNode;
      relation: EdgeRelation;
      weight: number;
      direction: "incoming" | "outgoing";
    }> = [];

    for (const row of rows) {
      const direction: "incoming" | "outgoing" =
        (row.source_id as string) === memoryId ? "outgoing" : "incoming";

      // Deduplicate by node_id
      if (!results.some((r) => r.node.id === row.node_id)) {
        results.push({
          node: this.rowToNode(row),
          relation: row.relation as EdgeRelation,
          weight: row.weight as number,
          direction,
        });
      }
    }

    return results;
  }

  /** Full-text search across memory titles and summaries */
  searchByText(query: string, limit = 20): MemoryNode[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND (title LIKE ? OR summary LIKE ? OR body LIKE ?)
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
      .all(like, like, like, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToNode(r));
  }

  /** Search by tags */
  searchByTag(tag: string, limit = 20): MemoryNode[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND tags LIKE ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
      .all(`%"${tag}"%`, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToNode(r));
  }

  /** Get recent memories by time range */
  getRecentMemories(hours = 24, limit = 50): MemoryNode[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const rows = this.db
      .prepare(`
        SELECT * FROM memory_nodes
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(cutoff, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToNode(r));
  }

  /** Get statistics */
  getStats(): MemoryGraphStats {
    const totalNodes = (this.db.prepare("SELECT COUNT(*) as count FROM memory_nodes").get() as Record<string, unknown>).count as number;
    const totalEdges = (this.db.prepare("SELECT COUNT(*) as count FROM memory_edges").get() as Record<string, unknown>).count as number;
    const codeLinked = (this.db
      .prepare("SELECT COUNT(*) as count FROM memory_edges WHERE relation = 'links_to_code'")
      .get() as Record<string, unknown>).count as number;

    const byStatusRows = this.db.prepare("SELECT status, COUNT(*) as count FROM memory_nodes GROUP BY status").all() as Record<string, unknown>[];
    const byTypeRows = this.db.prepare("SELECT node_type, COUNT(*) as count FROM memory_nodes GROUP BY node_type").all() as Record<string, unknown>[];

    return {
      totalNodes,
      totalEdges,
      codeLinked,
      byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status as string, r.count as number])),
      byType: Object.fromEntries(byTypeRows.map((r) => [r.node_type as string, r.count as number])),
    };
  }

  /** Prune expired and low-importance entries */
  prune(dryRun = true): { deleted: number; archived: number } {
    const now = Date.now();

    // Delete expired
    const expired = this.db
      .prepare("SELECT id FROM memory_nodes WHERE ttl_days IS NOT NULL AND (created_at + ttl_days * 86400000) < ?")
      .all(now) as Record<string, unknown>[];

    // Archive low-importance with no edges
    const lowImp = this.db
      .prepare(`
        SELECT mn.id FROM memory_nodes mn
        WHERE mn.importance < 3 AND mn.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM memory_edges me WHERE me.source_id = mn.id OR me.target_id = mn.id)
      `)
      .all() as Record<string, unknown>[];

    if (dryRun) {
      return { deleted: expired.length, archived: lowImp.length };
    }

    for (const row of expired) {
      this.db.prepare("DELETE FROM memory_nodes WHERE id = ?").run(row.id);
    }
    for (const row of lowImp) {
      this.db.prepare("UPDATE memory_nodes SET status = 'archived' WHERE id = ?").run(row.id);
    }

    return { deleted: expired.length, archived: lowImp.length };
  }

  /** Close the database connection */
  close(): void {
    if (this.db.open) this.db.close();
  }

  // ===== Helpers =====

  private rowToNode(row: Record<string, unknown>): MemoryNode {
    return {
      id: row.id as string,
      title: row.title as string,
      summary: (row.summary as string) ?? "",
      body: (row.body as string) ?? "",
      contentHash: row.content_hash as string,
      importance: (row.importance as number) ?? 5,
      status: (row.status as MemoryStatus) ?? "active",
      source: (row.source as MemorySource) ?? "agent",
      sourceSession: (row.source_session as string) ?? null,
      tags: JSON.parse((row.tags as string) ?? "[]"),
      nodeType: (row.node_type as MemoryNodeType) ?? "memory_entry",
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      ttlDays: (row.ttl_days as number) ?? null,
    };
  }
}
