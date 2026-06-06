-- One Memory Schema v1
-- 在 CodeGraph 的 DB 中新增平行表，不修改 nodes/edges

-- =============================================================================
-- Memory Schema Versioning
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- =============================================================================
-- Memory Nodes
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_nodes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 5
        CHECK (importance >= 1 AND importance <= 10),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived', 'pending_review')),
    source TEXT NOT NULL DEFAULT 'agent'
        CHECK (source IN ('agent', 'user', 'system', 'imported')),
    source_session TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    node_type TEXT NOT NULL DEFAULT 'memory_entry'
        CHECK (node_type IN ('memory_entry', 'decision', 'project_milestone')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ttl_days INTEGER
);

-- =============================================================================
-- Memory Edges (links to code symbols or other memory entries)
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('memory', 'code')),
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL
        CHECK (target_type IN ('memory', 'code')),
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL
        CHECK (relation IN (
            'links_to_code', 'causes', 'fixes', 'precedes',
            'follows', 'references', 'contradicts', 'supersedes',
            'relates_to', 'implements', 'questions'
        )),
    weight REAL NOT NULL DEFAULT 1.0
        CHECK (weight >= 0.0 AND weight <= 1.0),
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_memory_nodes_tags ON memory_nodes(tags);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_source ON memory_nodes(source);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_created_at ON memory_nodes(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_importance ON memory_nodes(importance);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_status ON memory_nodes(status);

CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_memory_edges_relation ON memory_edges(relation);
