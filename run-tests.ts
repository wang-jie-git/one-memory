/**
 * One Memory 测试运行器
 *
 * 用法: node run-tests.js [--auto-linker|--decision|--importance|--obsidian|--integration|--dream|--watchdog|--orchestrator|--vector|--bridge|--scale]
 *
 * 所有测试均使用 tsx 运行，依赖已通过 npm install 统一管理。
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_FILES: Record<string, string> = {
  "auto-linker": "packages/memory-graph/tests/auto-linker.test.ts",
  "decision": "packages/memory-graph/tests/decision-tracker.test.ts",
  "importance": "packages/memory-graph/tests/importance-learner.test.ts",
  "obsidian": "packages/memory-graph/tests/obsidian-writer.test.ts",
  "integration": "packages/memory-graph/tests/integration.test.ts",
  "dream": "packages/memory-orchestrator/tests/dream.test.ts",
  "watchdog": "packages/memory-orchestrator/tests/memory-watchdog.test.ts",
  "orchestrator": "packages/memory-orchestrator/tests/orchestrator.test.ts",
  "vector": "packages/memory-vector/tests/vector-store.test.ts",
  "bridge": "packages/memory-vector/tests/bridge.test.ts",
  "scale": "packages/memory-vector/tests/phase4-scale.test.ts",
};

const args = process.argv.slice(2);
const keys = args.length > 0 ? args.filter((a) => a.startsWith("--")).map((a) => a.slice(2)) : Object.keys(TEST_FILES);

let passed = 0;
let failed = 0;

for (const key of keys) {
  const file = TEST_FILES[key];
  if (!file) {
    console.error(`未知测试: ${key}。可用: ${Object.keys(TEST_FILES).join(", ")}`);
    failed++;
    continue;
  }

  const fullPath = path.join(__dirname, file);
  console.log(`\n━━━ ${key} ━━━`);
  try {
    execSync(`npx tsx "${fullPath}"`, {
      cwd: __dirname,
      stdio: "inherit",
      timeout: 30000,
    });
    console.log(`  ✅ ${key} 通过`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${key} 失败`);
    failed++;
  }
}

console.log(`\n━━━ 结果: ${passed} 通过, ${failed} 失败 ━━━`);
process.exit(failed > 0 ? 1 : 0);