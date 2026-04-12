import { readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { Chunk, ChunkerDocument, Edge, SourceAdapter } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { createIgnoreFilter, loadWtfocIgnore } from "@wtfoc/config";
import { type MarkdownChunkerOptions, sha256Hex } from "../../chunker.js";
import { selectChunker } from "../../chunkers/index.js";
import { acquireRepo, extractRepoName } from "./acquisition.js";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, walkFiles } from "./chunking.js";
import {
	type ChangedFile,
	commitExists,
	getChangedFiles,
	getHeadCommit,
	isGitRepo,
} from "./git-diff.js";

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
	/** Raw ignore pattern sources from .wtfoc.json and --ignore CLI flags */
	ignorePatternSources?: (string[] | undefined)[];
	/** Suppress informational messages (e.g., .wtfocignore detection) */
	quiet?: boolean;
	/** Previous commit SHA for git-diff incremental ingest */
	lastCommitSha?: string;
}

/** Metadata about the repo state after ingest, used for cursor persistence */
export interface RepoIngestMetadata {
	headCommitSha: string | null;
	renamedFiles: Array<{ oldPath: string; newPath: string }>;
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

	/** After ingest, this holds the HEAD commit SHA for cursor persistence */
	lastIngestMetadata: RepoIngestMetadata | null = null;

	async *ingest(config: RepoAdapterConfig): AsyncIterable<Chunk> {
		const opts = config;
		const repoPath = await acquireRepo(opts.source);
		const repo = extractRepoName(opts.source);

		// Load .wtfocignore from repo root, then build a single unified filter
		// with all pattern sources in precedence order:
		// builtins → .wtfocignore → .wtfoc.json → --ignore CLI
		const wtfocIgnorePatterns = loadWtfocIgnore(repoPath);
		if (wtfocIgnorePatterns.length > 0 && !opts.quiet) {
			console.error(`   .wtfocignore found: ${wtfocIgnorePatterns.length} pattern(s) loaded`);
		}
		const ignoreFilter = createIgnoreFilter(
			wtfocIgnorePatterns.length > 0 ? wtfocIgnorePatterns : undefined,
			...(opts.ignorePatternSources ?? []),
		);

		const includeExts = new Set(opts.include ?? [...DEFAULT_INCLUDE]);
		const excludeDirs = opts.exclude ?? DEFAULT_EXCLUDE;
		const maxFileSize = opts.maxFileSize ?? 100_000;

		// Try git-diff incremental ingest if we have a cursor
		const gitRepo = await isGitRepo(repoPath);
		const headSha = gitRepo ? await getHeadCommit(repoPath) : null;
		this.lastIngestMetadata = { headCommitSha: headSha, renamedFiles: [] };

		let files: string[];
		let deletedFiles: string[] = [];
		let renamedFiles: Array<{ oldPath: string; newPath: string }> = [];

		if (gitRepo && opts.lastCommitSha && headSha && opts.lastCommitSha !== headSha) {
			const cursorValid = await commitExists(repoPath, opts.lastCommitSha);
			if (cursorValid) {
				// Git-diff incremental: only process changed files
				const changes = await getChangedFiles(repoPath, opts.lastCommitSha, headSha);

				// Check if .wtfocignore changed — if so, fall back to full walk
				const ignoreChanged = changes.some(
					(c) => c.path === ".wtfocignore" || c.path === ".wtfoc.json",
				);

				if (ignoreChanged) {
					if (!opts.quiet) {
						console.error("   .wtfocignore or .wtfoc.json changed — full re-walk");
					}
					files = await walkFiles(repoPath, includeExts, excludeDirs, ignoreFilter);
				} else {
					// Filter to relevant file extensions and apply ignore patterns
					const relevantChanges = changes.filter((c) => {
						const path = c.status === "deleted" ? c.path : c.path;
						const ext = extname(path);
						if (!includeExts.has(ext)) return false;
						if (ignoreFilter && !ignoreFilter(path)) return false;
						return true;
					});

					files = relevantChanges
						.filter((c) => c.status !== "deleted")
						.map((c) => join(repoPath, c.path));

					deletedFiles = relevantChanges.filter((c) => c.status === "deleted").map((c) => c.path);

					renamedFiles = relevantChanges
						.filter(
							(c): c is ChangedFile & { oldPath: string } =>
								c.status === "renamed" && c.oldPath !== undefined,
						)
						.map((c) => ({ oldPath: c.oldPath, newPath: c.path }));

					if (!opts.quiet) {
						console.error(
							`   Git diff: ${files.length} changed, ${deletedFiles.length} deleted, ${renamedFiles.length} renamed`,
						);
					}
				}
			} else {
				// Cursor commit not found (shallow clone, branch switch) — full walk
				if (!opts.quiet) {
					console.error("   Cursor commit not found — full re-walk");
				}
				files = await walkFiles(repoPath, includeExts, excludeDirs, ignoreFilter);
			}
		} else {
			files = await walkFiles(repoPath, includeExts, excludeDirs, ignoreFilter);
		}

		// Store rename info for catalog lifecycle management
		this.lastIngestMetadata = { headCommitSha: headSha, renamedFiles };

		// Emit tombstone chunks for deleted files so the catalog can archive them
		for (const deletedPath of deletedFiles) {
			yield {
				id: sha256Hex(`tombstone:${repo}/${deletedPath}`),
				content: "",
				sourceType: "tombstone",
				source: `${repo}/${deletedPath}`,
				chunkIndex: 0,
				totalChunks: 0,
				metadata: {
					filePath: deletedPath,
					repo,
					deleted: "true",
				},
				documentId: `${repo}/${deletedPath}`,
				documentVersionId: "deleted",
				contentFingerprint: sha256Hex(""),
			};
		}

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

			// Document identity: stable key is repo/path, version is content hash
			const documentId = `${repo}/${relPath}`;
			const documentVersionId = sha256Hex(content);

			const language = isMarkdown ? "markdown" : extname(filePath).slice(1);
			const chunker = selectChunker(sourceType, relPath);

			const doc: ChunkerDocument = {
				documentId,
				documentVersionId,
				content,
				sourceType,
				source: `${repo}/${relPath}`,
				sourceUrl,
				filePath: relPath,
				metadata: {
					filePath: relPath,
					language,
					repo,
				},
			};

			const chunks = chunker.chunk(doc, opts.chunkerOptions);
			for (const chunk of chunks) {
				const yieldChunk: Chunk = {
					...chunk,
					sourceType,
					sourceUrl,
					metadata: {
						...chunk.metadata,
						filePath: relPath,
						language,
						repo,
					},
				};
				if (chunk.chunkIndex === 0) yieldChunk.rawContent = content;
				yield yieldChunk;
			}
		}
	}

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
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
