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

## Phase 1 — 核心引擎 MVP（目标：v0.1）

### 1.1 memory-graph 包

- [ ] CodeGraph `MemoryEntry` 节点类型注册
- [ ] 基础 CRUD: createMemoryEntry / getMemoryEntry / updateMemoryEntry / deleteMemoryEntry
- [ ] `LinksToCode` 边关系创建（手动关联）
- [ ] `LinksToMemory` 边关系创建（时序 + 因果）
- [ ] Obsidian 双写同步（MemoryEntry → Markdown 文件）
- [ ] 基础查询: `getRelatedMemories(nodeId, depth=2)` 图遍历

**验证指标**: 可以从 One 写入一条记忆，同步到 Obsidian，通过图遍历查询关联的代码符号

### 1.2 memory-vector 包

- [ ] `VectorStore` 抽象接口定义
- [ ] SQLite + sqlite-vec 实现
- [ ] Embedding 模型接入（支持 HuggingFace / OpenAI / 本地模型）
- [ ] 向量 upsert + query

**验证指标**: 写入 100 条记忆后，语义搜索能在 TOP 5 中找到正确结果

### 1.3 memory-orchestrator 包

- [ ] `HybridQuery` 查询流程实现（向量粗召回 → 图精排序 → 融合打分）
- [ ] 打分参数可配置（α, β, γ）

**验证指标**: 混合查询比纯向量检索的 MAP@5 提升 20%+

---

## Phase 2 — 集成与韧性（目标：v0.2）

- [ ] 集成到 One App 的启动生命周期
- [ ] 写入缓冲 + 批量 flush（提高写入吞吐）
- [ ] 双写一致性回滚机制
- [ ] 图剪枝定时任务
- [ ] 性能基准测试套件

**验证指标**: 连续写入 10,000 条记忆，P99 写入延迟 < 500ms

---

## Phase 3 — 智能进化（目标：v0.3）

- [ ] 自动关联：代码符号扫描 → 自动建立 LinksToCode
- [ ] 重要性评分自动学习（基于引用频率 + 用户反馈）
- [ ] 记忆衰减曲线调优
- [ ] 决策节点类型完善
- [ ] CLI 管理工具

**验证指标**: 用户反馈 "One 越来越记得住" — 记忆命中率 > 85%

---

## Phase 4 — 规模化（目标：v0.4+）

- [ ] LanceDB 向量引擎适配
- [ ] 分布式图引擎评估（如果 CodeGraph 成为瓶颈）
- [ ] 冷热分层存储
- [ ] 跨用户/跨团队记忆隔离
- [ ] 记忆市场（Memory Marketplace）集成 — 第 9-10 层生态

---

## 版本命名

遵循 One 主项目的版本体系：
- v0.x：与 One App v0.6.x/0.7.x 对齐，孵化阶段
- v1.0：记忆系统独立 GA，与 One App v1.0 同时发布
