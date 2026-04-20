import type { Chunker } from "@wtfoc/common";
import { AstHeuristicChunker } from "./ast-heuristic-chunker.js";
import { CodeWindowChunker } from "./code-chunker.js";
import { GithubIssueChunker } from "./github-issue-chunker.js";
import { HierarchicalCodeChunker } from "./hierarchical-code-chunker.js";
import { MarkdownChunker } from "./markdown-chunker.js";

export type { AstChunkerOptions } from "./ast-chunker.js";
export { AstChunker } from "./ast-chunker.js";
export { AstHeuristicChunker } from "./ast-heuristic-chunker.js";
export { CodeWindowChunker } from "./code-chunker.js";
export { GithubIssueChunker } from "./github-issue-chunker.js";
export {
	FILE_SUMMARY_SYMBOL,
	HierarchicalCodeChunker,
} from "./hierarchical-code-chunker.js";
export { MarkdownChunker } from "./markdown-chunker.js";

const registry = new Map<string, Chunker>();

/**
 * Register a chunker implementation.
 */
export function registerChunker(chunker: Chunker): void {
	registry.set(chunker.name, chunker);
}

/**
 * Get a chunker by name, or undefined if not registered.
 */
export function getChunker(name: string): Chunker | undefined {
	return registry.get(name);
}

/**
 * Get all registered chunker names.
 */
export function getAvailableChunkers(): string[] {
	return [...registry.keys()];
}

/** Extensions supported by the AST heuristic chunker */
const AST_SUPPORTED_EXTS = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"py",
	"go",
	"rs",
	"rb",
	"java",
	"kt",
	"scala",
]);

/**
 * Select the appropriate chunker for a source type and file path.
 * Routes GitHub issues/PRs/discussions to the issue-aware chunker,
 * prefers AST-heuristic for supported languages, markdown for .md/.mdx,
 * falls back to code-window for everything else.
 */
export function selectChunker(sourceType: string, filePath?: string): Chunker {
	const ext = filePath?.split(".").pop()?.toLowerCase();

	if (
		sourceType === "github-issue" ||
		sourceType === "github-pr" ||
		sourceType === "github-discussion"
	) {
		return registry.get("github-issue") ?? new GithubIssueChunker();
	}

	const isMarkdown = ext === "md" || ext === "mdx" || sourceType === "markdown";

	if (isMarkdown) {
		return registry.get("markdown") ?? new MarkdownChunker();
	}
	if (ext && AST_SUPPORTED_EXTS.has(ext)) {
		// Prefer the hierarchical wrapper by default — wraps the best available
		// symbol chunker (AST sidecar > ast-heuristic) so callers get file-level
		// summary chunks alongside symbol-level chunks (#252). Callers can opt
		// out by re-registering `hierarchical-code` to their own implementation
		// or by picking a symbol chunker directly.
		return (
			registry.get("hierarchical-code") ??
			registry.get("ast") ??
			registry.get("ast-heuristic") ??
			new AstHeuristicChunker()
		);
	}
	return registry.get("code-window") ?? new CodeWindowChunker();
}

// Register built-in chunkers. `hierarchical-code` is registered after AST
// variants so the wrapper can pick the best inner chunker available at
// registration time; consumers can override via `registerChunker`.
registerChunker(new MarkdownChunker());
registerChunker(new CodeWindowChunker());
registerChunker(new AstHeuristicChunker());
registerChunker(new GithubIssueChunker());
registerChunker(
	new HierarchicalCodeChunker(
		registry.get("ast") ?? registry.get("ast-heuristic") ?? new AstHeuristicChunker(),
	),
);
