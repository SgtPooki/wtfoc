import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { MarkdownChunker } from "./markdown-chunker.js";

/**
 * GitHub-issue-aware chunker (#251).
 *
 * Wraps MarkdownChunker but injects `#N: Title` + labels into every chunk so
 * that retrieval always includes issue identity, even when an issue is split
 * across multiple chunks.
 */
export class GithubIssueChunker implements Chunker {
	readonly name = "github-issue";
	readonly version = "1.0.0";

	readonly #markdown = new MarkdownChunker();

	chunk(document: ChunkerDocument, options?: ChunkerOptions): ChunkerOutput[] {
		const number = document.metadata?.number ?? "";
		const title = document.content.match(/^#\s+(.+)/)?.[1] ?? document.source;
		const labels = document.metadata?.labels ?? "";

		// Build a compact context header that goes into every chunk.
		// Include owner/repo so chunks from different repos don't blur together.
		// Intentionally avoid "#N" format to prevent the regex edge extractor from
		// treating the header as a cross-reference to the issue itself.
		//
		// source formats differ by type:
		//   issue/PR:   "owner/repo#N"          → split on "#"
		//   discussion: "owner/repo/discussions/N" → split on "/discussions/"
		const repo = document.source.includes("#")
			? (document.source.split("#")[0] ?? document.source)
			: (document.source.split("/discussions/")[0] ?? document.source);
		const labelLine = labels ? `Labels: ${labels}\n` : "";
		const kind =
			document.sourceType === "github-pr"
				? "PR"
				: document.sourceType === "github-discussion"
					? "discussion"
					: "issue";
		const contextHeader = `${repo} ${kind} ${number}: ${title}\n${labelLine}---\n`;

		// MarkdownChunker reads chunkSize, not maxChunkChars — map through so callers
		// using maxChunkChars (e.g. the adapter) get the intended chunk size
		const chunks = this.#markdown.chunk(document, {
			...options,
			chunkSize: options?.chunkSize ?? options?.maxChunkChars,
		});

		return chunks.map((chunk, idx) => {
			const content = contextHeader + chunk.content;
			return {
				...chunk,
				content,
				sourceType: document.sourceType,
				// rawContent only on the first chunk — full original document
				...(idx === 0 ? { rawContent: document.content } : {}),
			};
		});
	}
}
