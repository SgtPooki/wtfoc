import type { Chunker } from "@wtfoc/common";
import { AstHeuristicChunker } from "./ast-heuristic-chunker.js";
import { CodeWindowChunker } from "./code-chunker.js";
import { MarkdownChunker } from "./markdown-chunker.js";

export { AstHeuristicChunker } from "./ast-heuristic-chunker.js";
export { CodeWindowChunker } from "./code-chunker.js";
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
 * Prefers AST-heuristic for supported languages, markdown for .md/.mdx,
 * falls back to code-window for everything else.
 */
export function selectChunker(sourceType: string, filePath?: string): Chunker {
	const ext = filePath?.split(".").pop()?.toLowerCase();
	const isMarkdown = ext === "md" || ext === "mdx" || sourceType === "markdown";

	if (isMarkdown) {
		return registry.get("markdown") ?? new MarkdownChunker();
	}
	if (ext && AST_SUPPORTED_EXTS.has(ext)) {
		return registry.get("ast-heuristic") ?? new AstHeuristicChunker();
	}
	return registry.get("code-window") ?? new CodeWindowChunker();
}

// Register built-in chunkers
registerChunker(new MarkdownChunker());
registerChunker(new CodeWindowChunker());
registerChunker(new AstHeuristicChunker());
