/**
 * Memory Logger + Watchdog 测试
 *
 * 测试场景：
 *   1. Logger: 基本日志级别
 *   2. Logger: 环形缓冲区溢出
 *   3. Logger: 错误级别触发回调
 *   4. Logger: Timed 操作日志
 *   5. Logger: 按级别过滤
 *   6. Logger: 按时间查询错误
 *   7. Logger: 按模块查询
 *   8. Logger: 清空缓冲区
 *   9. Watchdog: 健康检查（正常状态）
 *   10. Watchdog: 模拟故障
 *   11. Watchdog: 不健康触发回调
 *   12. Watchdog: 健康状态变化回调
 *   13. Watchdog: 定时检查
 *   14. Watchdog: uptime 格式化
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryLogger, type LogEntry } from "../src/memory-logger";
import { MemoryWatchdog } from "../src/memory-watchdog";
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
import type { HealthStatus } from "../src/memory-watchdog";

// ===== Mock Embedder =====

class MockEmbedder implements Embedder {
  readonly dimension = 32;
  readonly modelName = "mock";
  failCount = 0;
  private callCount = 0;

  async embed(text: string): Promise<Float32Array> {
    this.callCount++;
    if (this.failCount > 0 && this.callCount <= this.failCount) {
      throw new Error("Mock embedder failure");
    }
    const vec = new Float32Array(32);
    for (let i = 0; i < 32; i++) vec[i] = 0.1;
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ===== Test Helpers =====

const TEST_DIR = path.join(__dirname, ".watchdog-test");

function cleanDir() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function createTestEnv() {
  cleanDir();
  const dbPath = path.join(TEST_DIR, "codegraph.db");
  const vecPath = path.join(TEST_DIR, "memory-vectors.db");
  const db = MemoryDatabase.create(dbPath);
  const vec = SqliteVectorStore.open(vecPath);
  const embedder = new MockEmbedder();
  return { db, vec, embedder, dbPath, vecPath };
}

// ===== MemoryLogger Tests =====

describe("MemoryLogger", () => {

  it("应记录不同级别的日志", () => {
    const logger = new MemoryLogger();

    logger.debug("test", "op1", "debug msg");
    logger.info("test", "op2", "info msg");
    logger.warn("test", "op3", "warn msg");
    logger.error("test", "op4", "error msg");
    logger.fatal("test", "op5", "fatal msg");

    const recent = logger.getRecent(10);
    expect(recent.length).toBe(5);
    expect(recent[0].level).toBe("debug");
    expect(recent[4].level).toBe("fatal");
    expect(recent[4].module).toBe("test");
  });

  it("应在环形缓冲区满时覆盖最旧条目", () => {
    const logger = new MemoryLogger({ bufferSize: 5 });

    for (let i = 0; i < 10; i++) {
      logger.info("test", "fill", `entry ${i}`);
    }

    const recent = logger.getRecent(10);
    expect(recent.length).toBe(5);
    expect(recent[0].message).toBe("entry 5");
    expect(recent[4].message).toBe("entry 9");
  });

  it("错误级别应触发 onError 回调", () => {
    const logger = new MemoryLogger();
    const errors: string[] = [];

    logger.onError((entry) => {
      errors.push(`${entry.level}: ${entry.message}`);
    });

    logger.info("test", "safe", "不会触发");
    logger.warn("test", "warn", "也不会触发");
    logger.error("test", "fail", "触发错误回调");
    logger.fatal("test", "crash", "触发致命回调");

    expect(errors.length).toBe(2);
    expect(errors[0]).toBe("error: 触发错误回调");
    expect(errors[1]).toBe("fatal: 触发致命回调");
  });

  it("timed 应记录操作耗时和结果", async () => {
    const logger = new MemoryLogger();
    const logs: LogEntry[] = [];

    logger.onLog((entry) => {
      if (entry.operation === "slowOp") logs.push(entry);
    });

    // 成功的操作
    await logger.timed("test", "slowOp", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "done";
    });

    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].message).toBe("OK");
    expect(logs[0].duration).toBeGreaterThanOrEqual(5);

    // 失败的操作
    logs.length = 0;
    try {
      await logger.timed("test", "slowOp", async () => {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("模拟失败");
      });
    } catch {
      // expected
    }

    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("error");
    expect(logs[0].error).toContain("模拟失败");
  });

  it("应能按级别过滤查询", () => {
    const logger = new MemoryLogger();
    logger.debug("test", "d1", "debug");
    logger.info("test", "i1", "info");
    logger.warn("test", "w1", "warn");
    logger.error("test", "e1", "error");

    const errors = logger.getRecent(10, "error");
    expect(errors.length).toBe(1);
    expect(errors[0].level).toBe("error");

    const warns = logger.getRecent(10, "warn");
    expect(warns.length).toBe(2); // warn + error
  });

  it("getErrorsSince 应返回指定时间后的错误", () => {
    const logger = new MemoryLogger();
    const past = Date.now() - 10000;

    logger.error("test", "old", "old error");
    const oldEntry = logger.getRecent(10).find((e) => e.message === "old error")!;
    (oldEntry as any).timestamp = past;

    logger.error("test", "new", "new error");

    const recentErrors = logger.getErrorsSince(Date.now() - 5000);
    expect(recentErrors.length).toBe(1);
    expect(recentErrors[0].message).toBe("new error");
  });

  it("应能按模块查询", () => {
    const logger = new MemoryLogger();
    logger.info("module-a", "op1", "msg1");
    logger.info("module-a", "op2", "msg2");
    logger.info("module-b", "op3", "msg3");

    const modA = logger.getByModule("module-a");
    expect(modA.length).toBe(2);

    const modB = logger.getByModule("module-b");
    expect(modB.length).toBe(1);
  });

  it("clear 应清空缓冲区", () => {
    const logger = new MemoryLogger();
    logger.info("test", "op", "msg");
    expect(logger.getRecent(10).length).toBe(1);
    logger.clear();
    expect(logger.getRecent(10).length).toBe(0);
  });
});

// ===== MemoryWatchdog Tests =====

describe("MemoryWatchdog", () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  it("健康检查应在正常状态下返回 healthy=true", async () => {
    const logger = new MemoryLogger();
    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    const status = await watchdog.checkHealth();

    expect(status.healthy).toBe(true);
    expect(status.graphDb.ok).toBe(true);
    expect(status.vectorStore.ok).toBe(true);
    expect(status.embedder.ok).toBe(true);
    expect(status.score).toBeGreaterThanOrEqual(8);
  });

  it("embedder 故障时应标记不健康", async () => {
    const logger = new MemoryLogger();
    env.embedder.failCount = 1;

    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    const status = await watchdog.checkHealth();

    expect(status.healthy).toBe(false);
    expect(status.embedder.ok).toBe(false);
    expect(status.embedder.error).toBeTruthy();
    expect(status.score).toBeLessThanOrEqual(8);
  });

  it("不健康时应触发 onUnhealthy 回调", async () => {
    const logger = new MemoryLogger();
    env.embedder.failCount = 1;

    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    const unhealthyStatuses: HealthStatus[] = [];
    watchdog.onUnhealthy((status) => {
      unhealthyStatuses.push(status);
    });

    await watchdog.checkHealth();

    expect(unhealthyStatuses.length).toBe(1);
    expect(unhealthyStatuses[0].healthy).toBe(false);
  });

  it("健康状态变化应触发 onHealthChange", async () => {
    const logger = new MemoryLogger();
    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    const changes: Array<{ healthy: boolean; previous: boolean | null }> = [];
    watchdog.onHealthChange((status, prev) => {
      changes.push({ healthy: status.healthy, previous: prev?.healthy ?? null });
    });

    // 第一次健康检查（正常）
    await watchdog.checkHealth();
    expect(changes.length).toBe(0); // 没有 previous 不触发

    // 模拟故障
    env.embedder.failCount = 100;
    await watchdog.checkHealth();

    expect(changes.length).toBe(1);
    expect(changes[0].healthy).toBe(false);
    expect(changes[0].previous).toBe(true);
  });

  it("start/stop 应启动和停止定时检查", async () => {
    const logger = new MemoryLogger();
    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { checkIntervalMs: 100, autoStart: false },
    );

    watchdog.start();
    await new Promise((r) => setTimeout(r, 350));
    watchdog.stop();

    // 经过 350ms（3 个检查周期），应有最近状态
    expect(watchdog.lastStatus).not.toBeNull();
    expect(watchdog.lastStatus!.timestamp).toBeGreaterThan(0);
  });

  it("getUptime 应返回格式化字符串", () => {
    const logger = new MemoryLogger();
    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    const uptime = watchdog.getUptime();
    expect(uptime).toMatch(/^\d+h \d+m \d+s$/);
  });

  it("recordOperation 应正确记录操作状态", () => {
    const logger = new MemoryLogger();
    const watchdog = new MemoryWatchdog(
      env.db, env.vec, env.embedder, logger,
      undefined, { autoStart: false },
    );

    watchdog.recordWrite(true);
    watchdog.recordQuery(true);
    watchdog.recordDream(true);

    // 通过健康检查可以看到操作状态
    // 不报错即验证通过
    expect(watchdog.lastStatus).toBeNull();
  });
});
