/**
 * memory-graph: Obsidian 双写同步器
 *
 * 将 memory_nodes 中的条目自动同步写入 Obsidian Vault，
 * 保持人类可读的 markdown 版本。
 *
 * 架构：
 *   CodeGraph DB (source of truth)
 *     ↓ 异步同步（idempotent）
 *   Obsidian Vault (人类可读缓存，可重建)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryNode } from "./database";

export interface ObsidianSyncConfig {
  /** Obsidian Vault 根目录 */
  vaultPath: string;
  /** 记忆子目录（相对 vaultPath） */
  subDir?: string;
  /** 是否把 summary 写入 frontmatter description */
  includeSummary?: boolean;
  /** 是否写入完整 body */
  includeBody?: boolean;
}

const DEFAULT_CONFIG: ObsidianSyncConfig = {
  vaultPath: "",
  subDir: "",
  includeSummary: true,
  includeBody: true,
};

/**
 * 解析 Obsidian 笔记的 frontmatter
 */
interface NoteFrontmatter {
  title: string;
  importance: number;
  tags: string[];
  source: string;
  sourceSession: string | null;
  nodeType: string;
  nodeId: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export class ObsidianWriter {
  private config: ObsidianSyncConfig;

  constructor(config: Partial<ObsidianSyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取笔记目录路径 */
  private getNotesDir(): string {
    return this.config.subDir
      ? path.join(this.config.vaultPath, this.config.subDir)
      : this.config.vaultPath;
  }

  /** 根据 memory node 生成文件名 */
  getFilename(node: MemoryNode): string {
    // Sanitize title for filename
    const safeTitle = node.title
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return `memory-${node.id.slice(0, 8)}-${safeTitle}.md`;
  }

  /** 将 MemoryNode 写入 Obsidian */
  write(node: MemoryNode): string {
    const notesDir = this.getNotesDir();

    // Ensure directory exists
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }

    // Delete any existing file for this node ID first
    this.delete(node.id);

    const filename = this.getFilename(node);
    const filePath = path.join(notesDir, filename);

    const frontmatter: NoteFrontmatter = {
      title: node.title,
      importance: node.importance,
      tags: node.tags,
      source: node.source,
      sourceSession: node.sourceSession,
      nodeType: node.nodeType,
      nodeId: node.id,
      createdAt: new Date(node.createdAt).toISOString(),
      updatedAt: new Date(node.updatedAt).toISOString(),
    };
    if (this.config.includeSummary && node.summary) {
      frontmatter.description = node.summary;
    }

    const lines: string[] = [];
    lines.push("---");
    lines.push(`title: "${frontmatter.title}"`);
    lines.push(`importance: ${frontmatter.importance}`);
    lines.push(`tags: [${frontmatter.tags.map((t) => `"${t}"`).join(", ")}]`);
    lines.push(`source: ${frontmatter.source}`);
    if (frontmatter.sourceSession) lines.push(`source_session: ${frontmatter.sourceSession}`);
    lines.push(`node_type: ${frontmatter.nodeType}`);
    lines.push(`node_id: "${frontmatter.nodeId}"`);
    lines.push(`created_at: ${frontmatter.createdAt}`);
    lines.push(`updated_at: ${frontmatter.updatedAt}`);
    if (frontmatter.description) {
      // Wrap long description
      const desc = frontmatter.description.length > 80
        ? frontmatter.description.slice(0, 77) + "..."
        : frontmatter.description;
      lines.push(`description: "${desc}"`);
    }
    lines.push("---");
    lines.push("");
    lines.push(`# ${node.title}`);
    lines.push("");

    if (this.config.includeSummary && node.summary) {
      lines.push(node.summary);
      lines.push("");
    }

    if (this.config.includeBody && node.body) {
      lines.push(node.body);
      lines.push("");
    }

    // Add backlinks section
    lines.push("---");
    lines.push("");
    lines.push(`_One Memory ID: \`${node.id}\`_`);
    lines.push(`_Importance: ${node.importance}/10_`);
    if (node.ttlDays) {
      lines.push(`_TTL: ${node.ttlDays} days_`);
    }

    const content = lines.join("\n");
    fs.writeFileSync(filePath, content, "utf-8");

    return filePath;
  }

  /** 删除 Obsidian 中的对应笔记（删除所有匹配 nodeId 的文件） */
  delete(nodeId: string): boolean {
    const notesDir = this.getNotesDir();
    if (!fs.existsSync(notesDir)) return false;

    const files = fs.readdirSync(notesDir);
    const prefix = nodeId.slice(0, 8);
    const matches = files.filter((f) => f.includes(prefix));

    if (matches.length === 0) return false;

    for (const match of matches) {
      fs.unlinkSync(path.join(notesDir, match));
    }
    return true;
  }

  /** 列出 Obsidian 中的笔记（用于一致性校验） */
  list(): Array<{ filename: string; nodeId: string | null }> {
    const notesDir = this.getNotesDir();
    if (!fs.existsSync(notesDir)) return [];

    return fs.readdirSync(notesDir)
      .filter((f) => f.startsWith("memory-") && f.endsWith(".md"))
      .map((f) => {
        // Extract nodeId from frontmatter or filename
        const filePath = path.join(notesDir, f);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const matchId = content.match(/node_id:\s*"([^"]+)"/);
          return {
            filename: f,
            nodeId: matchId ? matchId[1] : null,
          };
        } catch {
          return { filename: f, nodeId: null };
        }
      });
  }

  /** 获取笔记总数 */
  count(): number {
    return this.list().length;
  }
}
