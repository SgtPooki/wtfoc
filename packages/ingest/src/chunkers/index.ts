import type { Chunker } from "@wtfoc/common";
import { CodeWindowChunker } from "./code-chunker.js";
import { MarkdownChunker } from "./markdown-chunker.js";

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

/**
 * Select the appropriate chunker for a source type and file path.
 */
export function selectChunker(sourceType: string, filePath?: string): Chunker {
	const ext = filePath?.split(".").pop()?.toLowerCase();
	const isMarkdown = ext === "md" || ext === "mdx" || sourceType === "markdown";

	if (isMarkdown) {
		return registry.get("markdown") ?? new MarkdownChunker();
	}
	return registry.get("code-window") ?? new CodeWindowChunker();
}

// Register built-in chunkers
registerChunker(new MarkdownChunker());
registerChunker(new CodeWindowChunker());
