import { readFile, stat } from "node:fs/promises";
import { extname, relative } from "node:path";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { chunkMarkdown, type MarkdownChunkerOptions } from "../../chunker.js";
import { acquireRepo, extractRepoName } from "./acquisition.js";
import { chunkCode, DEFAULT_EXCLUDE, DEFAULT_INCLUDE, walkFiles } from "./chunking.js";

function getMatchGroup(match: RegExpMatchArray | RegExpExecArray, index: number): string | null {
	return typeof match[index] === "string" ? match[index] : null;
}

export interface RepoAdapterConfig {
	/** GitHub repo (owner/name) or local directory path */
	source: string;
	/** File extensions to include (default: .ts, .js, .md, .json, etc.) */
	include?: string[];
	/** Directory names to exclude (default: node_modules, dist, .git) */
	exclude?: string[];
	/** Chunker options */
	chunkerOptions?: MarkdownChunkerOptions;
	/** Max file size in bytes to process (default: 100KB) */
	maxFileSize?: number;
}

export class RepoAdapter implements SourceAdapter<RepoAdapterConfig> {
	readonly sourceType = "repo";

	parseConfig(raw: Record<string, unknown>): RepoAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || !source) {
			throw new WtfocError(
				"RepoAdapter requires a 'source' option (GitHub owner/repo or local path)",
				"REPO_INVALID_CONFIG",
				{ raw },
			);
		}
		return {
			source,
			include: Array.isArray(raw.include) ? (raw.include as string[]) : undefined,
			exclude: Array.isArray(raw.exclude) ? (raw.exclude as string[]) : undefined,
			maxFileSize: typeof raw.maxFileSize === "number" ? raw.maxFileSize : undefined,
		};
	}

	async *ingest(config: RepoAdapterConfig): AsyncIterable<Chunk> {
		const opts = config;
		const repoPath = await acquireRepo(opts.source);
		const repo = extractRepoName(opts.source);

		const includeExts = new Set(opts.include ?? [...DEFAULT_INCLUDE]);
		const excludeDirs = opts.exclude ?? DEFAULT_EXCLUDE;
		const maxFileSize = opts.maxFileSize ?? 100_000;

		const files = await walkFiles(repoPath, includeExts, excludeDirs);

		for (const filePath of files) {
			const fileInfo = await stat(filePath);
			if (fileInfo.size > maxFileSize) continue;

			const content = await readFile(filePath, "utf-8");
			if (!content.trim()) continue;

			const relPath = relative(repoPath, filePath);
			const ext = extname(filePath);
			const isMarkdown = ext === ".md" || ext === ".mdx";
			const sourceType = isMarkdown ? "markdown" : "code";
			const sourceUrl = `https://github.com/${repo}/blob/main/${relPath}`;

			if (isMarkdown) {
				const chunks = chunkMarkdown(content, {
					source: `${repo}/${relPath}`,
					...opts.chunkerOptions,
				});
				for (const chunk of chunks) {
					yield {
						...chunk,
						sourceType,
						sourceUrl,
						metadata: {
							...chunk.metadata,
							filePath: relPath,
							language: "markdown",
							repo,
						},
					};
				}
			} else {
				const chunks = chunkCode(content, relPath, repo, sourceUrl);
				for (const chunk of chunks) {
					yield chunk;
				}
			}
		}
	}

	extractEdges(chunks: Chunk[]): Edge[] {
		const edges: Edge[] = [];

		for (const chunk of chunks) {
			// Extract import/require references
			const imports = extractImports(chunk.content);
			for (const imp of imports) {
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "file",
					targetId: resolveImportPath(
						imp,
						chunk.metadata.filePath ?? "",
						chunk.metadata.repo ?? "",
					),
					evidence: `import from '${imp}'`,
					confidence: 1.0,
				});
			}

			// Extract issue/PR references from comments
			const issueRefs = chunk.content.match(/(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|See|Ref)?\s*#(\d+)/gi);
			if (issueRefs) {
				for (const ref of issueRefs) {
					const num = ref.match(/#(\d+)/)?.[1];
					if (num) {
						const repo = chunk.metadata.repo ?? "";
						edges.push({
							type: "references",
							sourceId: chunk.id,
							targetType: "issue",
							targetId: repo ? `${repo}#${num}` : `#${num}`,
							evidence: ref.trim(),
							confidence: 1.0,
						});
					}
				}
			}

			// Extract markdown link references
			const mdLinks = chunk.content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
			for (const match of mdLinks) {
				const url = getMatchGroup(match, 2);
				const label = getMatchGroup(match, 1);
				if (!url || !label) continue;
				if (url.startsWith("http")) {
					edges.push({
						type: "references",
						sourceId: chunk.id,
						targetType: "url",
						targetId: url,
						evidence: `[${label}](${url})`,
						confidence: 1.0,
					});
				}
			}
		}

		return edges;
	}
}

function extractImports(content: string): string[] {
	const imports: string[] = [];
	const esImports = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
	for (const match of esImports) {
		const importPath = getMatchGroup(match, 1);
		if (importPath) imports.push(importPath);
	}
	const requires = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
	for (const match of requires) {
		const importPath = getMatchGroup(match, 1);
		if (importPath) imports.push(importPath);
	}
	return imports;
}

function resolveImportPath(importPath: string, currentFile: string, repo: string): string {
	if (importPath.startsWith(".")) {
		const dir = currentFile.split("/").slice(0, -1).join("/");
		return `${repo}/${dir}/${importPath}`.replace(/\/\.\//g, "/");
	}
	return importPath;
}
