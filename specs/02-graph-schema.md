# Spec 02: Graph Schema — Memory Tables

**状态**: Draft → **Implementing** | **优先级**: P0 | **最后更新**: 2026-06-06

## 1. 设计原则

- **不修改 CodeGraph 的 `nodes`/`edges` 表**
- **在同一个 SQLite DB 中新增平行表**: `memory_nodes` / `memory_edges`
- `memory_edges` 引用 `nodes` 表的 `id` 实现记忆→代码关联（外键）
- `memory_nodes` 之间的关联走 `memory_edges` 自己的引用

## 2. SQL Schema

```sql
-- =============================================================================
-- Memory Schema Version 1
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- =============================================================================
-- Memory Nodes: AI-generated and user-created memory entries
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_nodes (
    id TEXT PRIMARY KEY,                          -- UUID v4
    title TEXT NOT NULL,                          -- 记忆标题
    summary TEXT NOT NULL DEFAULT '',              -- 摘要（用于 embedding）
    body TEXT NOT NULL DEFAULT '',                 -- 完整内容（markdown）
    content_hash TEXT NOT NULL,                    -- SHA256 去重
    importance INTEGER NOT NULL DEFAULT 5,         -- 1-10
    status TEXT NOT NULL DEFAULT 'active'          -- active | archived | pending_review
        CHECK (status IN ('active', 'archived', 'pending_review')),
    source TEXT NOT NULL DEFAULT 'agent'           -- agent | user | system | imported
        CHECK (source IN ('agent', 'user', 'system', 'imported')),
    source_session TEXT,                           -- 来源会话 ID
    tags TEXT NOT NULL DEFAULT '[]',               -- JSON array ["tag1","tag2"]
    node_type TEXT NOT NULL DEFAULT 'memory_entry' -- memory_entry | decision | project_milestone
        CHECK (node_type IN ('memory_entry', 'decision', 'project_milestone')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ttl_days INTEGER                              -- NULL = 永不过期
);

-- 决策专用扩展字段（当 node_type = 'decision' 时使用）
-- decision_context TEXT
-- decision_options TEXT   -- JSON array
-- decision_chosen TEXT
-- decision_rationale TEXT
-- decision_outcome TEXT   -- success | failure | pending | unknown

-- =============================================================================
-- Memory Edges: Relationships between memory entries and/or code symbols
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL                       -- 'memory' | 'code'
        CHECK (source_type IN ('memory', 'code')),
    source_id TEXT NOT NULL,                        -- memory_nodes.id 或 nodes.id
    target_type TEXT NOT NULL                       -- 'memory' | 'code'
        CHECK (target_type IN ('memory', 'code')),
    target_id TEXT NOT NULL,                        -- memory_nodes.id 或 nodes.id
    relation TEXT NOT NULL                          -- links_to_code | causes | fixes | precedes | ...
        CHECK (relation IN (
            'links_to_code',     -- memory → code: 关联代码符号
            'causes',            -- memory → memory: A 导致了 B
            'fixes',             -- memory → memory: A 修复了 B
            'precedes',          -- memory → memory: A 早于 B
            'follows',           -- memory → memory: A 晚于 B
            'references',        -- memory → memory: A 引用了 B
            'contradicts',       -- memory → memory: A 与 B 矛盾
            'supersedes',        -- memory → memory: A 取代了 B
            'relates_to',        -- memory → memory: 弱关联
            'implements',        -- memory → memory: A 实现了 B 的决策
            'questions'          -- memory → memory: A 对 B 提出质疑
        )),
    weight REAL NOT NULL DEFAULT 1.0,               -- 0.0 - 1.0 关联强度
    description TEXT NOT NULL DEFAULT '',            -- 关联说明
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
    -- 注意: source_type='code' 时，source_id 引用 nodes(id)，但 SQLite 不支持跨表 FK
);

-- =============================================================================
-- 嵌入向量元数据（指向外部向量库）
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_vectors (
    id TEXT PRIMARY KEY,                            -- UUID，对应 memory_nodes.id
    node_id TEXT NOT NULL UNIQUE,                   -- memory_nodes.id
    embedder_name TEXT NOT NULL,                    -- 模型名: all-MiniLM-L6-v2
    dimension INTEGER NOT NULL,                     -- 向量维度: 384
    created_at INTEGER NOT NULL,                    -- 向量化时间
    FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- 按标签查询
CREATE INDEX IF NOT EXISTS idx_memory_nodes_tags ON memory_nodes(tags);
-- 按来源查询
CREATE INDEX IF NOT EXISTS idx_memory_nodes_source ON memory_nodes(source);
-- 按时序查询
CREATE INDEX IF NOT EXISTS idx_memory_nodes_created_at ON memory_nodes(created_at);
-- 按重要性查询
CREATE INDEX IF NOT EXISTS idx_memory_nodes_importance ON memory_nodes(importance);
-- 按状态查询
CREATE INDEX IF NOT EXISTS idx_memory_nodes_status ON memory_nodes(status);

-- 记忆边查询
CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_memory_edges_relation ON memory_edges(relation);

-- 向量元数据
CREATE INDEX IF NOT EXISTS idx_memory_vectors_node ON memory_vectors(node_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_vectors_node_unique ON memory_vectors(node_id);
```

## 3. 跨表查询示例

```sql
-- 查询记忆条目及其关联的代码符号
SELECT
    mn.id AS memory_id,
    mn.title,
    n.name AS code_symbol_name,
    n.kind AS code_symbol_kind,
    n.file_path,
    me.relation
FROM memory_nodes mn
JOIN memory_edges me ON me.source_id = mn.id AND me.source_type = 'memory'
JOIN nodes n ON n.id = me.target_id AND me.target_type = 'code'
WHERE mn.status = 'active'
ORDER BY mn.importance DESC;

-- 查询决策及其因果链
SELECT
    d.id,
    d.title,
    d.body AS decision_context,
    me.relation,
    mn_related.title AS related_memory
FROM memory_nodes d
JOIN memory_edges me ON me.source_id = d.id AND me.source_type = 'memory'
JOIN memory_nodes mn_related ON mn_related.id = me.target_id AND me.target_type = 'memory'
WHERE d.node_type = 'decision'
  AND me.relation IN ('causes', 'fixes', 'implements');
```

## 4. vs CodeGraph 原生 `nodes` 表

| 维度 | `nodes` (CodeGraph) | `memory_nodes` (One Memory) |
|------|--------------------|----------------------------|
| 用途 | 代码符号 | 记忆/决策/里程碑 |
| ID 格式 | `FileSymbol_qualified_name` | UUID v4 |
| 字段 | code-specific (start_line, language, etc.) | memory-specific (summary, tags, importance) |
| FTS | 有 (nodes_fts) | 无（后期加） |
| 谁写入 | CodeGraph 索引器 | memory-graph |
| 谁读取 | CodeGraph 查询 | memory-orchestrator |
