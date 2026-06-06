# Spec 04: Dual-Write Consistency

**状态**: Draft | **优先级**: P0 | **最后更新**: 2026-06-06

## 1. 架构角色

| 存储 | 角色 | 一致性 | 可重建 |
|------|------|--------|--------|
| CodeGraph | **Source of Truth** | 强一致 | — |
| 向量库 | 派生索引 | 最终一致 | ✅ 从 CodeGraph 重建 |
| Obsidian Vault | 人类可读缓存 | 最终一致 | ✅ 从 CodeGraph 重建 |

## 2. 写入协议

### 2.1 正常写入

```
mutation writeMemory(entry) {
  // Phase 1: CodeGraph 写入（权威）
  const nodeId = codegraph.createMemoryEntry(entry);
  
  // Phase 2: 向量写入（异步）
  const vector = await embedder.embed(entry.summary);
  await vectorStore.upsert(nodeId, vector, metadata).catch(err => {
    // 向量写入失败 → 记录失败事件，不阻塞返回
    failureQueue.push({ type: 'vector', nodeId, entry, error: err });
    telemetry.incr('vector_write_failure');
  });
  
  // Phase 3: Obsidian 写入（异步）
  const markdown = toMarkdown(entry);
  await obsidianWrite(entry, markdown).catch(err => {
    // Obsidian 写入失败 → 只记录不阻塞
    failureQueue.push({ type: 'obsidian', nodeId, entry, error: err });
  });
  
  return nodeId;
}
```

### 2.2 失败恢复

```typescript
// 重试队列（进程内，非持久）
const failureQueue: Queue<{
  type: 'vector' | 'obsidian';
  nodeId: string;
  entry: MemoryEntry;
  error: Error;
  retryCount: number;
}>;

// 重试策略
// - 每 30s 扫描队列
// - 最大重试 5 次
// - 重试间隔: 指数退避 10s, 30s, 60s, 120s, 300s
// - 5 次后标记为 dead_letter，人工介入

async function retryFailureQueue() {
  for (const item of failureQueue) {
    if (item.retryCount >= 5) {
      telemetry.alert('memory_dead_letter', item);
      continue;
    }
    
    try {
      if (item.type === 'vector') {
        const vector = await embedder.embed(item.entry.summary);
        await vectorStore.upsert(item.nodeId, vector, toMetadata(item.entry));
      } else {
        await obsidianWrite(item.entry);
      }
      failureQueue.remove(item);
      telemetry.incr('memory_retry_success');
    } catch (err) {
      item.retryCount++;
      telemetry.incr('memory_retry_failure');
    }
  }
}
```

## 3. 一致性验证

```typescript
// 定时验证（cron: 0 6 * * * — 每天凌晨6点）
async function verifyConsistency() {
  const codegraphNodes = await codegraph.getMemoryEntries({ limit: 1000 });
  const vectorIds = await vectorStore.listIds();
  const obsidianIds = await listObsidianEntries();
  
  const report = {
    total: codegraphNodes.length,
    missingInVector: codegraphNodes.filter(n => !vectorIds.includes(n.id)).length,
    missingInObsidian: codegraphNodes.filter(n => !obsidianIds.includes(n.id)).length,
    orphanedInVector: vectorIds.filter(id => !codegraphNodes.find(n => n.id === id)).length,
  };
  
  if (report.missingInVector > 10 || report.missingInObsidian > 10) {
    telemetry.alert('memory_inconsistency_high', report);
  }
  
  return report;
}
```

## 4. 全量重建

```typescript
// 从 CodeGraph 重建所有派生存储
async function rebuildFromCodeGraph() {
  // 1. 清空向量库
  await vectorStore.flush();
  
  // 2. 遍历所有 CodeGraph 记忆节点
  const allNodes = await codegraph.getAllMemoryEntries();
  
  // 3. 批量向量化
  const BATCH_SIZE = 50;
  for (let i = 0; i < allNodes.length; i += BATCH_SIZE) {
    const batch = allNodes.slice(i, i + BATCH_SIZE);
    const texts = batch.map(n => n.summary);
    const vectors = await embedder.embed(texts);
    
    await vectorStore.upsertBatch(
      batch.map((n, j) => ({
        id: n.id,
        vector: vectors[j],
        metadata: toMetadata(n)
      }))
    );
  }
  
  // 4. 重建 Obsidian
  await rebuildObsidianFromCodeGraph();
  
  telemetry.incr('memory_rebuild_complete');
}
```

## 5. 数据恢复 SLA

| 场景 | RTO | RPO | 操作 |
|------|-----|-----|------|
| 向量库损坏 | 30 分钟 | 0（从 CodeGraph 重建） | `rebuildFromCodeGraph()` |
| Obsidian 删除 | 1 小时 | 0（从 CodeGraph 重建） | `rebuildObsidianFromCodeGraph()` |
| CodeGraph 损坏 | 取决于备份 | 最近备份点 | 从 CodeGraph 备份恢复 |
| 全量丢失 | 2 小时 | 最近备份点 | 备份恢复 → 重建向量/Obsidian |
