# Changelog

所有重要的更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- GitHub Actions CI/CD 自动化
- Moat 代码质量检查集成
- TypeScript 严格模式配置

### Changed
- 统一包命名规范（@one/*）

## [0.1.0] - 2026-07-07

### Added

#### 核心引擎
- **memory-graph**: 图数据库层
  - CodeGraph 记忆节点类型注册
  - 基础 CRUD 操作（create/read/update/delete）
  - LinksToCode 边关系（手动关联代码符号）
  - LinksToMemory 边关系（时序 + 因果）
  - Obsidian 双写同步
  - 图遍历查询（getRelatedMemories）

- **memory-vector**: 向量存储层
  - VectorStore 抽象接口
  - SQLite + BLOB 向量存储
  - Embedding 模型接入（LocalEmbedder / ApiEmbedder）
  - 向量 upsert + query
  - Metadata 过滤（type/importance/source/timeRange）
  - IVF 索引加速（15x 性能提升）

- **memory-orchestrator**: 统一编排层
  - HybridQuery 混合查询（向量粗召回 → 图精排序 → 融合打分）
  - 打分参数可配置（α, β, γ）
  - 降级回退机制（向量不可用 → 纯文本搜索）

#### MCP 服务器
- **memory-mcp**: MCP 协议服务器
  - memory_write 工具
  - memory_query 工具
  - memory_dream 工具
  - memory_health 工具
  - stdio 传输协议

#### CLI 工具
- **memory-cli**: 命令行工具
  - 记忆管理 CLI 接口

#### 梦境引擎
- **dream.ts**: 记忆熵减系统
  - 冗余合并（去重）
  - 主题聚类（提炼 insight）
  - 低值修剪（归档/删除）
  - 健康评分与报告

### Features
- 混合查询引擎（向量 + 图）
- 代码符号自动关联
- Obsidian Vault 双向同步
- 记忆熵减（梦境引擎）
- 健康监控与告警

### Documentation
- README.md - 项目主文档
- ARCHITECTURE.md - 架构设计文档
- CLAUDE.md - 开发规范
- ROADMAP.md - 路线图
- specs/ - 6 个详细技术规范

### Quality
- Moat 代码质量检查（6/6 通过）
- TypeScript 严格模式
- 完整的测试覆盖（12 个测试文件）
- CodeGraph 集成（570 节点，1561 边）

## [0.0.1] - 2026-06-06

### Added
- 初始项目结构
- Phase 0 架构定义
- 基础 TypeScript 配置
