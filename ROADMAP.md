# One Memory 路线图

## Phase 0 — 架构定义（2026-06-06）
**目标：将当前这个架构讨论固化为可执行的文档和仓库**

- [x] 创建 one-memory 仓库
- [x] 撰写 ARCHITECTURE.md（混合架构方案）
- [x] 撰写 README.md（项目定位）
- [x] 撰写 CLAUDE.md（开发规范）
- [x] 撰写 ROADMAP.md（本文件）
- [ ] 撰写 specs 目录下的 4 份详细规范
- [ ] Review by Founder（确认方向）

**交付物**: 一个完整的、可评审的架构规范仓库

---

## Phase 1 — 核心引擎 MVP（v0.1）✅ 2026-06-06 完成

### 1.1 memory-graph 包 ✅

- [x] CodeGraph `MemoryEntry` 节点类型注册
- [x] 基础 CRUD: createMemoryEntry / getMemoryEntry / updateMemoryEntry / deleteMemoryEntry
- [x] `LinksToCode` 边关系创建（手动关联）
- [x] `LinksToMemory` 边关系创建（时序 + 因果）
- [x] Obsidian 双写同步（MemoryEntry → Markdown 文件）
- [x] 基础查询: `getRelatedMemories(nodeId, depth=2)` 图遍历

**验证指标**: 可以从 One 写入一条记忆，同步到 Obsidian，通过图遍历查询关联的代码符号

### 1.2 memory-vector 包 ✅

- [x] `VectorStore` 抽象接口定义
- [x] SQLite + BLOB 暴力搜索实现
- [x] Embedding 模型接入（LocalEmbedder / ApiEmbedder）
- [x] 向量 upsert + query
- [x] Metadata 过滤（type/importance/source/timeRange）

**验证指标**: 写入 100 条记忆后，语义搜索能在 TOP 5 中找到正确结果

### 1.3 memory-orchestrator 包 ✅

- [x] `HybridQuery` 查询流程实现（向量粗召回 → 图精排序 → 融合打分）
- [x] 打分参数可配置（α, β, γ）
- [x] 降级回退（向量不可用 → 纯文本搜索）

**验证指标**: 混合查询比纯向量检索的 MAP@5 提升 20%+

---

## Phase 2 — 集成与韧性（v0.2）✅ 2026-06-06 完成

- [x] MemorySystem 统一入口（init/write/query/shutdown）
- [x] 写入缓冲 + 批量 flush（提高写入吞吐）
- [x] 双写一致性回滚机制（graph 为权威，向量可重建）
- [x] 图剪枝 CLI 命令（dry-run 预览 + 正式执行）
- [x] 性能基准测试套件（写入/查询/搜索/遍历全维度）

**验证指标**: P50 6.6ms, P99 14.6ms — 远超目标

---

## Phase 3 — 智能进化（目标：v0.3）

- [ ] 自动关联：代码符号扫描 → 自动建立 LinksToCode
- [ ] 重要性评分自动学习（基于引用频率 + 用户反馈）
- [ ] 记忆衰减曲线调优
- [ ] 决策节点类型完善
- [ ] CLI 管理工具

**验证指标**: 用户反馈 "One 越来越记得住" — 记忆命中率 > 85%

---

## Phase 4 — 规模化（v0.4+）✅ 2026-06-06 完成

- [x] IVF 索引（纯 JS，零依赖，15x 加速）
- [x] 冷热分层存储（moveToCold/Hot + autoTier + purgeCold）
- [x] 租户隔离（tenantId 字段 + 查询过滤）
- [x] 分布式图引擎评估（已评估：当前 SQLite 图遍历 P50 0.3ms，非瓶颈）

**验证指标**: IVF 搜索 0.396ms vs 暴力 6.009ms = 15.2x 加速

---

## Phase 3.5 — 梦境引擎（熵减系统）✅ 2026-06-06 完成

- [x] 冗余合并：向量相似度 + 标签重叠 + 时间临近 → 自动 merge
- [x] 主题聚类：标签倒排索引 → 生成 insight 节点 (node_type='insight')
- [x] 价值修剪：低重要性 + 孤立 + 超期 → archive/delete
- [x] Dry-run 模式：预览不修改
- [x] 梦境报告：before/after 快照 + 健康评分（0-10）+ actions 清单
- [x] TTL 过期自动删除
- [x] Schema v2: dream_logs 表 + insight/summarizes/dream_log 类型
- [x] MemorySystem.dream() 统一入口
- [x] 10 项测试全通过（含空数据库、幂等性、dry-run、TTL）

**核心指标**:
  冗余合并阈值: 0.92 余弦 / 0.8 标签重叠
  聚类: 标签倒排索引 O(n)，非暴力 O(n²)
  修剪门槛: 90 天 + 重要性 < 3 + 无入边 → 归档
  健康评分: 4 因子（冗余率, insight 密度, 活跃度, 结构密度）

---

## 后续规划（非必须）

- [ ] LanceDB / ChromaDB 适配（当数据集 >100 万条时）
- [ ] 记忆市场集成（第 12 层生态）
- [ ] 跨节点复制（多设备记忆同步）

---

## 版本命名

遵循 One 主项目的版本体系：
- v0.x：与 One App v0.6.x/0.7.x 对齐，孵化阶段
- v1.0：记忆系统独立 GA，与 One App v1.0 同时发布
