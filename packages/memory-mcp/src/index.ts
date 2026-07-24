#!/usr/bin/env node
/**
 * One Memory MCP Server
 *
 * 实现 MCP 协议 (JSON-RPC over stdio)，供 AI Agent 调用记忆系统。
 *
 * 用法:
 *   one-memory-mcp --codegraph-dir /path/to/.codegraph [--embedder simple|api|local] [--embedder-api-key xxx] [--embedder-base-url url] [--embedder-model model]
 *
 * MCP 协议:
 *   initialize → tools/list → tools/call("memory_write", ...)
 *
 * 参考: https://spec.modelcontextprotocol.io/
 *
 * 注意: 直接导入源码路径，不需要 npm 安装/workspace 配置。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

// 直接导入 MemorySystem（相对路径，不走 package name resolution）
import { MemorySystem } from "../../memory-orchestrator/src/memory-system";
import { HANDLERS, getToolSchemas, type ToolSchema } from "./tools";

// ===== CLI Args =====

function parseArgs(): {
  codegraphDir: string;
  embedder: string;
  embedderApiKey?: string;
  embedderBaseUrl?: string;
  embedderModel?: string;
} {
  const args = process.argv.slice(2);
  let codegraphDir = "";
  let embedder = "simple"; // 默认用轻量内置 embedder，零模型下载
  let embedderApiKey: string | undefined;
  let embedderBaseUrl: string | undefined;
  let embedderModel: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--codegraph-dir" && i + 1 < args.length) {
      codegraphDir = args[++i];
    }
    if (args[i] === "--embedder" && i + 1 < args.length) {
      embedder = args[++i];
    }
    if (args[i] === "--embedder-api-key" && i + 1 < args.length) {
      embedderApiKey = args[++i];
    }
    if (args[i] === "--embedder-base-url" && i + 1 < args.length) {
      embedderBaseUrl = args[++i];
    }
    if (args[i] === "--embedder-model" && i + 1 < args.length) {
      embedderModel = args[++i];
    }
  }

  if (!codegraphDir) {
    // 默认：从 cwd 往上找 .codegraph
    let dir = process.cwd();
    while (dir !== "/") {
      if (fs.existsSync(path.join(dir, ".codegraph", "codegraph.db"))) {
        codegraphDir = path.join(dir, ".codegraph");
        break;
      }
      dir = path.dirname(dir);
    }
  }

  if (!codegraphDir) {
    process.stderr.write(
      'one-memory-mcp: 未找到 codegraph.db，请指定 --codegraph-dir\n',
    );
    process.exit(1);
  }

  return { codegraphDir, embedder, embedderApiKey, embedderBaseUrl, embedderModel };
}

// ===== Logger =====

function log(msg: string): void {
  process.stderr.write(`[Memory MCP] ${msg}\n`);
}

// ===== MCP Protocol =====

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class McpServer {
  private ms: MemorySystem | null = null;
  private initialized = false;
  private tools: ToolSchema[] = [];

  async start(): Promise<void> {
    const { codegraphDir, embedder, embedderApiKey, embedderBaseUrl, embedderModel } = parseArgs();

    log(`启动中... codegraph-dir=${codegraphDir} embedder=${embedder}${embedderApiKey ? " api-key=***" : ""}`);

    // 初始化 MemorySystem
    const msConfig: any = {
      codegraphDir,
      embedder: embedder as "local" | "api" | "simple",
      watchdog: { autoStart: true },
    };

    // 传递 embedder 配置（仅 api 模式需要）
    if (embedder === "api") {
      msConfig.embedderApiKey = embedderApiKey;
      msConfig.embedderBaseUrl = embedderBaseUrl;
      msConfig.embedderModel = embedderModel;
    }

    this.ms = await MemorySystem.init(msConfig);

    this.tools = getToolSchemas();

    log(`启动完成：${this.tools.length} 个工具可用`);

    // 监听 stdin
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const request: JsonRpcRequest = JSON.parse(trimmed);
        await this.handleRequest(request);
      } catch (err) {
        log(`解析失败: ${err}`);
      }
    }

    // stdin 关闭 → 清理
    await this.shutdown();
  }

  private async handleRequest(req: JsonRpcRequest): Promise<void> {
    const { id, method, params } = req;

    try {
      switch (method) {
        // ── 初始化 ──
        case "initialize":
          this.initialized = true;
          this.send(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "one-memory-mcp", version: "1.0.0" },
          });
          break;

        case "notifications/initialized":
          log("初始化完成");
          break;

        // ── 工具列表 ──
        case "tools/list":
          if (!this.initialized) {
            this.sendError(id, -32000, "Not initialized");
            break;
          }
          this.send(id, { tools: this.tools });
          break;

        // ── 工具调用 ──
        case "tools/call":
          if (!this.initialized) {
            this.sendError(id, -32000, "Not initialized");
            break;
          }
          await this.handleToolCall(id, params);
          break;

        // ── Ping ──
        case "ping":
          this.send(id, {});
          break;

        default:
          this.sendError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      log(`处理请求失败: ${err}`);
      this.sendError(id, -32603, err instanceof Error ? err.message : String(err));
    }
  }

  private async handleToolCall(
    id: string | number | undefined,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};

    if (!name) {
      this.sendError(id, -32602, "Missing tool name");
      return;
    }

    const handler = HANDLERS[name];
    if (!handler) {
      this.sendError(id, -32601, `Unknown tool: ${name}`);
      return;
    }

    if (!this.ms) {
      this.sendError(id, -32000, "MemorySystem not initialized");
      return;
    }

    try {
      const result = await handler(this.ms, args);
      this.send(id, result);
    } catch (err) {
      log(`工具 ${name} 失败: ${err}`);
      // 工具错误返回 content + isError
      this.send(id, {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      });
    }
  }

  private send(id: string | number | undefined, result: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id ?? null,
      result,
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  private sendError(
    id: string | number | undefined,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, data },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  private async shutdown(): Promise<void> {
    log("关闭中...");
    if (this.ms) {
      await this.ms.shutdown();
    }
    process.exit(0);
  }
}

// ===== Main =====

const server = new McpServer();
server.start().catch((err) => {
  process.stderr.write(`[Memory MCP] 启动失败: ${err.message}\n`);
  process.exit(1);
});