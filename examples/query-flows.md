# 查询流示例

本文档展示 One Memory 在实际场景中的工作方式。

---

## 场景 1：记忆 + 代码符号关联

**用户查询**: "上次支付模块超时问题是怎么修的？"

```
Step 1 — 向量粗召回:
  "支付模块超时修复" → embedding → 余弦相似度
    TOP 5: 
    - [0.92] "支付模块超时 fix: webhook 响应时间 > 30s 时熔断"
    - [0.87] "支付模块重构记录: 从轮询改为 WebSocket"  
    - [0.71] "熔断器阈值从 5 改为 10 的决策记录"
    - [0.65] "用户反馈: 支付偶尔卡住"
    - [0.58] "2026-06-04 架构评审纪要"

Step 2 — 图遍历精排序:
  对每个 candidate 走 CodeGraph 图遍历:

  "支付模块超时 fix" 节点:
    → links_to_code: PaymentService.process(), WebhookHandler.verify()
    → links_to_memory: "熔断器阈值决策" (causes)
    → links_to_memory: "2026-06-04 架构评审" (references)
    → 入边: 3 条（高引用热度）
    Graph Score: 0.91

  "支付模块重构记录" 节点:
    → links_to_code: PaymentWebSocket.ts
    → links_to_memory: "支付模块超时 fix" (precedes)  ← 时序前驱
    → 入边: 1 条
    Graph Score: 0.65

Step 3 — 融合打分:
  "支付模块超时 fix": 0.4*0.92 + 0.4*0.91 + 0.2*0.8(7天前) = 0.892
  "支付模块重构记录":  0.4*0.87 + 0.4*0.65 + 0.2*0.5(30天前) = 0.708

Step 4 — 返回 TOP 5:
  1. "支付模块超时 fix" (0.892)  ← 最相关
     → 关联代码: PaymentService.process():42, WebhookHandler.verify():89
     → 关联记忆: 熔断器阈值决策
```

---

## 场景 2：决策回溯

**用户查询**: "为什么熔断器阈值是 5？"

```
向量粗召回 → 找到 "熔断器阈值从 5 改为 10" 决策节点

图遍历:
  Decision "熔断器阈值决策":
    → options: [3, 5, 10]
    → chosen: 5
    → rationale: "3 太敏感频繁触发，10 延迟太高用户体验差"
    → outcome: "success"
    → links_to_memory: "支付模块超时 fix" (fixes)
    → links_to_memory: "2026-06 生产事故报告" (causes)

结果:
  "熔断器阈值决策" + 完整的决策上下文 + 因果链
```

---

## 场景 3：跨会话上下文恢复

**虚拟助手**: "继续之前的工作"

```
→ memory-orchestrator.query("当前上下文和下一步动作", { source: "current_session" })
→ 返回最近的 session 记忆 + 关联的代码和决策
→ Agent 自动恢复状态
```
