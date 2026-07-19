# One Memory 检查报告

**项目**: `/Users/mac/Desktop/one-memory`
**时间**: 2026-07-19 17:34
**检查工具**: Moat v0.4.0
**最新状态**: ⚠️ **通过 1, 失败 1（已知误报）, 警告 10（已知误报）**

---

## 🎉 当前检查结果

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 密钥检测 | ✅ 通过 | - |
| 依赖安全 | ❌ **1 个 HIGH** | `@xenova/transformers@2.17.2` 漏洞 — **已知误报，当前即最新版本** |
| 未使用导出 | ⚠️ 10 个 LOW | 全为库包公共 API 导出，由外部消费者引用，非真正未使用 |

## 📌 已知误报说明

### 1. `@xenova/transformers` 依赖漏洞（DEPS-001）

- Moat 建议升级到 `2.0.1`，但当前版本 `2.17.2` 已是 npm 最新版
- `2.0.1` 是旧版本，降级不合理
- **结论**: Moat 漏洞数据库数据有误，等待上游更新

### 2. 未使用导出（UNUSED-001）

| 文件 | 导出 | 说明 |
|------|------|------|
| `types/xenova-transformers.d.ts` | `EmbeddingOutput` | 类型声明，供外部使用 |
| `memory-mcp/src/tools.ts` | `HANDLERS`, `getToolSchemas` | MCP 工具注册入口 |
| `memory-orchestrator/src/memory-logger.ts` | `MemoryLogger` | 公共 API 导出 |
| `memory-orchestrator/src/dream.ts` | `DreamEngine` | 公共 API 导出 |
| `memory-orchestrator/src/index.ts` | `HybridQueryEngine` | 包入口导出 |
| `memory-orchestrator/src/memory-watchdog.ts` | `MemoryWatchdog` | 公共 API 导出 |
| `memory-vector/src/embedder.ts` | `LocalEmbedder`, `ApiEmbedder` | 公共 API 导出 |
| `memory-graph/src/obsidian-writer.ts` | `ObsidianWriter` | 公共 API 导出 |

**结论**: 均为库包公共 API，由 monorepo 外部消费者导入，非真正未使用。

---

## 📊 真实测试结果

| 测试套件 | 状态 |
|---------|------|
| auto-linker | ✅ 通过 |
| decision-tracker | ✅ 通过 |
| importance-learner | ✅ 通过 |
| obsidian-writer | ✅ 通过 |
| integration | ✅ 通过 |
| vector-store | ✅ 通过 |
| bridge | ✅ 通过 |
| phase4-scale | ✅ 通过 |

**8/8 全部通过 ✅**

---

## Phase 5 工程加固

| 修复项 | 状态 |
|--------|------|
| 热度数据 JSON → SQLite 持久化 | ✅ |
| 双写事务回滚 | ✅ |
| API Embedder 熔断保护 | ✅ |
| Obsidian 文件名碰撞（4 字节 → 6 字节） | ✅ |
| AutoLinker 模块解耦（CodeSymbolResolver 接口） | ✅ |
| 依赖管理修复 | ✅ |
| Moat 配置入仓（.moat/ 不再 gitignore） | ✅ |

---

## 📈 CodeGraph 集成

**知识图谱**：
- ✅ 570 个节点
- ✅ 1561 条边
- ✅ 索引时间：729ms

**语义检查**：
- ✅ L2 TypeScript 语义去重
- ✅ L2 TypeScript 语义竞态