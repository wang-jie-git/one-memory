/**
 * memory-graph: AutoLinker — 自动代码符号关联
 *
 * 扫描 CodeGraph 符号库，根据记忆条目的标题/摘要/标签，
 * 自动匹配相关的代码符号并建立 links_to_code 边。
 *
 * 匹配策略（按优先级）:
 *   1. 精确匹配: 记忆标签 → 代码符号 qualified_name
 *   2. 子串匹配: 记忆关键词 → 代码符号 name
 *   3. 文件路径匹配: 记忆标签 → 文件路径
 *
 * ⚠️ 跨模块边界：AutoLinker 不直接访问 CodeGraph 内部表，
 * 通过 CodeSymbolResolver 接口解耦。如需更换符号源，
 * 只需提供新的 resolver 实现。
 */

import { MemoryDatabase } from "./database";
import type { EdgeRelation } from "./database";

export interface AutoLinkConfig {
  /** 最大关联数 per memory entry */
  maxLinksPerMemory: number;
  /** 自动关联置信度阈值 0-1 */
  minConfidence: number;
  /** 允许匹配的代码符号类型 */
  allowedKinds: string[];
}

const DEFAULT_CONFIG: AutoLinkConfig = {
  maxLinksPerMemory: 5,
  minConfidence: 0.6,
  allowedKinds: ["function", "class", "method", "variable", "interface", "type", "constant"],
};

// ===== CodeSymbolResolver — 跨模块契约接口 =====

export interface CodeSymbol {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  docstring: string | null;
}

/** 符号查询契约 — 外部调用方需实现此接口 */
export interface CodeSymbolResolver {
  /** 根据关键词列表搜索代码符号 */
  searchByKeywords(keywords: string[], allowedKinds: string[], maxResults: number): CodeSymbol[];
}

// ===== Default resolver: queries CodeGraph nodes table =====

export class DefaultCodeSymbolResolver implements CodeSymbolResolver {
  constructor(private memoryDb: MemoryDatabase) {}

  searchByKeywords(keywords: string[], allowedKinds: string[], maxResults: number): CodeSymbol[] {
    const placeholders = allowedKinds.map(() => "?").join(",");

    const rows = this.memoryDb.getRawDb()
      .prepare(`
        SELECT DISTINCT n.id, n.name, n.qualified_name, n.kind, n.file_path, n.docstring
        FROM nodes n
        WHERE n.kind IN (${placeholders})
          AND (
            ${keywords.map(() =>
              `(LOWER(n.name) LIKE ? OR LOWER(n.qualified_name) LIKE ? OR LOWER(n.file_path) LIKE ?)`
            ).join(" OR ")}
          )
        LIMIT ?
      `)
      .all(
        ...allowedKinds,
        ...keywords.flatMap((kw) => [`%${kw}%`, `%${kw}%`, `%${kw}%`]),
        maxResults,
      ) as Array<{
        id: string;
        name: string;
        qualified_name: string;
        kind: string;
        file_path: string;
        docstring: string | null;
      }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      qualifiedName: r.qualified_name,
      kind: r.kind,
      filePath: r.file_path,
      docstring: r.docstring,
    }));
  }
}

interface MatchResult {
  symbolId: string;
  confidence: number;
  matchType: "exact_tag" | "keyword" | "file_path";
  description: string;
}

export class AutoLinker {
  private config: AutoLinkConfig;
  private memoryDb: MemoryDatabase;
  private symbolResolver: CodeSymbolResolver;

  constructor(
    memoryDb: MemoryDatabase,
    config?: Partial<AutoLinkConfig>,
    symbolResolver?: CodeSymbolResolver,
  ) {
    this.memoryDb = memoryDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.symbolResolver = symbolResolver ?? new DefaultCodeSymbolResolver(memoryDb);
  }

  /**
   * 为单条记忆自动关联代码符号
   */
  autoLink(memoryId: string): MatchResult[] {
    const node = this.memoryDb.getNode(memoryId);
    if (!node) return [];

    // Build keyword set from title, summary, and tags
    const keywords = new Set<string>();
    // Tags are the strongest signal
    for (const tag of node.tags) {
      keywords.add(tag.toLowerCase());
    }
    // Extract keywords from title (Chinese + English words)
    const titleWords = node.title
      .toLowerCase()
      .split(/[\s,，、_\-:：]+/)
      .filter(Boolean);
    for (const w of titleWords) {
      if (w.length > 1) keywords.add(w);
    }
    // Extract from summary
    const summaryWords = (node.summary ?? "")
      .toLowerCase()
      .split(/[\s,，、_\-:：]+/)
      .filter(Boolean);
    for (const w of summaryWords) {
      if (w.length > 2) keywords.add(w);
    }

    if (keywords.size === 0) return [];

    // Scan code symbols — query CodeGraph's nodes table via shared DB
    const symbols = this.scanCodeSymbols(keywords);

    // Score and rank
    const results = this.scoreMatches(keywords, symbols);

    // Create edges
    for (const result of results.slice(0, this.config.maxLinksPerMemory)) {
      try {
        this.memoryDb.linkMemoryToCode(
          memoryId,
          result.symbolId,
          result.description,
        );
      } catch {
        // Skip duplicates or errors
      }
    }

    return results;
  }

  /**
   * 批量关联（全部记忆）
   */
  autoLinkAll(options?: {
    batchSize?: number;
    onProgress?: (done: number, total: number, links: number) => void;
  }): { scanned: number; linked: number } {
    const allNodes = this.memoryDb.searchByText("", 99999);
    let totalLinks = 0;

    for (let i = 0; i < allNodes.length; i++) {
      const links = this.autoLink(allNodes[i].id);
      totalLinks += links.length;

      if (options?.onProgress) {
        options.onProgress(i + 1, allNodes.length, totalLinks);
      }
    }

    return { scanned: allNodes.length, linked: totalLinks };
  }

  /**
   * 在 CodeGraph 符号库中搜索与关键词匹配的符号
   * 通过 CodeSymbolResolver 接口解耦，不直接访问内部表
   */
  private scanCodeSymbols(keywords: Set<string>): CodeSymbol[] {
    return this.symbolResolver.searchByKeywords(
      Array.from(keywords),
      this.config.allowedKinds,
      100,
    );
  }

  /**
   * 评分匹配结果
   */
  private scoreMatches(
    keywords: Set<string>,
    symbols: CodeSymbol[],
  ): MatchResult[] {
    const results: MatchResult[] = [];

    for (const sym of symbols) {
      let bestConfidence = 0;
      let bestType: MatchResult["matchType"] = "exact_tag";
      let bestDesc = "";

      // Try each keyword
      for (const kw of keywords) {
        const lowerName = sym.name.toLowerCase();
        const lowerQualified = sym.qualifiedName.toLowerCase();
        const lowerFile = sym.filePath.toLowerCase();

        // 1. Exact tag match on qualified_name
        if (lowerQualified.includes(kw) && lowerQualified.split(".").some((part) => part === kw)) {
          const confidence = 0.95;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestType = "exact_tag";
            bestDesc = `Tag "${kw}" matches symbol ${sym.name}`;
          }
        }

        // 2. Keyword in symbol name
        if (lowerName.includes(kw) && kw.length > 2) {
          const confidence = 0.75;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestType = "keyword";
            bestDesc = `Keyword "${kw}" matches symbol name ${sym.name}`;
          }
        }

        // 3. Keyword in file path
        if (lowerFile.includes(kw)) {
          const confidence = 0.6;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestType = "file_path";
            bestDesc = `Keyword "${kw}" matches file path ${sym.filePath}`;
          }
        }
      }

      if (bestConfidence >= this.config.minConfidence) {
        results.push({
          symbolId: sym.id,
          confidence: bestConfidence,
          matchType: bestType,
          description: bestDesc,
        });
      }
    }

    // Sort by confidence descending, deduplicate by symbolId
    results.sort((a, b) => b.confidence - a.confidence);
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.symbolId)) return false;
      seen.add(r.symbolId);
      return true;
    });
  }
}
