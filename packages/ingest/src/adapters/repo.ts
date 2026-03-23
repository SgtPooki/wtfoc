import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { Chunk, Edge, SourceAdapter, SourceConfig } from "@wtfoc/common";
import { chunkMarkdown, type MarkdownChunkerOptions } from "../chunker.js";

const execFileAsync = promisify(execFile);

const DEFAULT_INCLUDE = new Set([
	".ts",
	".js",
	".tsx",
	".jsx",
	".md",
	".mdx",
	".json",
	".yaml",
	".yml",
	".toml",
]);

const DEFAULT_EXCLUDE = [
	"node_modules",
	"dist",
	".git",
	".next",
	"__pycache__",
	"coverage",
	".turbo",
];

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

/**
 * Repo/code source adapter. Clones a GitHub repo (or uses a local path)
 * and walks the file tree to produce typed chunks.
 *
 * sourceType: 'code' for code files, 'markdown' for .md files
 */
export class RepoAdapter implements SourceAdapter {
	readonly sourceType = "repo";

	async *ingest(config: SourceConfig): AsyncIterable<Chunk> {
		const opts = config.options as RepoAdapterConfig;
		const repoPath = await resolveRepoPath(opts.source);
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
				const chunks = chunkMarkdown(content, `${repo}/${relPath}`, opts.chunkerOptions);
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
						chunk.metadata["filePath"] ?? "",
						chunk.metadata["repo"] ?? "",
					),
					evidence: `import from '${imp}'`,
					confidence: 1.0,
				});
			}

			// Extract issue/PR references from comments
			const issueRefs = chunk.content.match(
				/(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|See|Ref)?\s*#(\d+)/gi,
			);
			if (issueRefs) {
				for (const ref of issueRefs) {
					const num = ref.match(/#(\d+)/)?.[1];
					if (num) {
						const repo = chunk.metadata["repo"] ?? "";
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
				const url = match[2]!;
				if (url.startsWith("http")) {
					edges.push({
						type: "references",
						sourceId: chunk.id,
						targetType: "url",
						targetId: url,
						evidence: `[${match[1]}](${url})`,
						confidence: 1.0,
					});
				}
			}
		}

		return edges;
	}
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function resolveRepoPath(source: string): Promise<string> {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		const tmpDir = `/tmp/wtfoc-repo-${source.replace("/", "-")}`;
		try {
			await stat(tmpDir);
			// Already cloned — pull latest
			await execFileAsync("git", ["pull", "--ff-only"], { cwd: tmpDir }).catch(() => {});
		} catch {
			// Clone fresh — use execFile to prevent injection
			await execFileAsync("git", [
				"clone",
				"--depth",
				"1",
				`https://github.com/${source}.git`,
				tmpDir,
			]);
		}
		return tmpDir;
	}
	return source;
}

function extractRepoName(source: string): string {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		return source;
	}
	return source.split("/").pop() ?? source;
}

async function walkFiles(
	dir: string,
	includeExts: Set<string>,
	excludeDirs: string[],
): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				if (!excludeDirs.includes(entry.name) && !entry.name.startsWith(".")) {
					await walk(fullPath);
				}
			} else if (entry.isFile()) {
				if (includeExts.has(extname(entry.name))) {
					files.push(fullPath);
				}
			}
		}
	}

	await walk(dir);
	return files.sort();
}

function chunkCode(
	content: string,
	filePath: string,
	repo: string,
	sourceUrl: string,
): Chunk[] {
	const chunkSize = 512;
	const overlap = 50;
	const chunks: Chunk[] = [];
	let offset = 0;
	let chunkIndex = 0;

	while (offset < content.length) {
		const end = Math.min(offset + chunkSize, content.length);
		const chunkContent = content.slice(offset, end);

		if (chunkContent.trim()) {
			const id = createHash("sha256").update(chunkContent).digest("hex");

			chunks.push({
				id,
				content: chunkContent,
				sourceType: "code",
				source: `${repo}/${filePath}`,
				sourceUrl,
				chunkIndex,
				totalChunks: 0,
				metadata: {
					filePath,
					language: extname(filePath).slice(1),
					repo,
				},
			});
			chunkIndex++;
		}

		offset = end - overlap;
		if (end === content.length) break;
	}

	for (const chunk of chunks) {
		chunk.totalChunks = chunks.length;
	}

	return chunks;
}

function extractImports(content: string): string[] {
	const imports: string[] = [];
	const esImports = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
	for (const match of esImports) {
		imports.push(match[1]!);
	}
	const requires = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
	for (const match of requires) {
		imports.push(match[1]!);
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
