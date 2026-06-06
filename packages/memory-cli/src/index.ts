#!/usr/bin/env node
// One Memory CLI — 记忆管理工具

const COMMANDS = `
Usage: one-memory <command> [options]

Commands:
  query <text>          混合查询记忆
  write <title>        写入新记忆条目
  stats                查看记忆系统统计
  prune                执行图剪枝
  rebuild-vector       从 CodeGraph 重建向量索引
  check-consistency    验证双写一致性
  serve                启动记忆查询 API 服务
`;

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case "query":
      console.log("🔍 查询功能 — Phase 1 实现");
      break;
    case "write":
      console.log("✍️  写入功能 — Phase 1 实现");
      break;
    case "stats":
      console.log("📊 统计功能 — Phase 1 实现");
      break;
    case "prune":
      console.log("✂️  剪枝功能 — Phase 2 实现");
      break;
    case "rebuild-vector":
      console.log("🔄 重建向量索引 — Phase 2 实现");
      break;
    case "check-consistency":
      console.log("✅ 一致性检查 — Phase 2 实现");
      break;
    case "serve":
      console.log("🌐 启动 API 服务 — Phase 3 实现");
      break;
    default:
      console.log(COMMANDS);
      process.exit(1);
  }
}

main().catch(console.error);
