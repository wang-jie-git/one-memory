# One Memory 开发规范

## 项目定位
One Memory 是 One 操作系统的持久记忆子系统，不是独立产品。所有设计决策以 One 的 12 层价值链为背景。

## 架构红线
1. **CodeGraph 为权威源（source of truth）** — 向量库和 Obsidian 都是派生副本，可重建
2. **本地优先** — 所有核心能力无需外部服务，SQLite 级起步
3. **可替换的向量引擎** — 通过 `VectorStore` 接口抽象，支持 SQLite/Chroma/LanceDB 切换
4. **查询延迟红线** — P50 < 200ms，P99 < 1s，超过即需要优化
5. **禁止引入多余依赖** — 能用 stdlib 不用三方库，能用 SQLite 不用 PG

## 开发原则
1. 先写规范（specs/），再写代码
2. 每个包必须有测试，TDD 优先
3. 所有查询路径必须有性能基准测试
4. 图节点 type 命名使用 snake_case

## 记忆系统术语

| 术语 | 含义 |
|------|------|
| MemoryEntry | 图记忆节点，最小存储单元 |
| LinksToCode | 记忆到代码的关联边 |
| LinksToMemory | 记忆到记忆的关联边 |
| Decision | 决策节点（MemoryEntry 的子类型） |
| HybridQuery | 混合查询（向量粗召回 + 图精排序） |
