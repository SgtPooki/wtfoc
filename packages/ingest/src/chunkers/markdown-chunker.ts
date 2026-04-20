import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { chunkMarkdown } from "../chunker.js";

/**
 * Markdown-aware chunker. Splits at headers > paragraphs > sentences > hard cap.
 * Wraps the existing chunkMarkdown function with the Chunker interface.
 */
export class MarkdownChunker implements Chunker {
	readonly name = "markdown";
	readonly version = "1.0.0";

	chunk(document: ChunkerDocument, options?: ChunkerOptions): ChunkerOutput[] {
		const chunks = chunkMarkdown(document.content, {
			source: document.source,
			sourceUrl: document.sourceUrl,
			timestamp: document.timestamp,
			timestampKind: document.timestampKind,
			metadata: document.metadata,
			documentId: document.documentId,
			documentVersionId: document.documentVersionId,
			chunkSize: options?.chunkSize,
			chunkOverlap: options?.chunkOverlap,
		});

		let byteOffset = 0;
		let lineNumber = 1;

		return chunks.map((chunk) => {
			const startOffset = document.content.indexOf(chunk.content, byteOffset);
			const effectiveStart = startOffset >= 0 ? startOffset : byteOffset;

			// Count lines up to this chunk
			const linesBeforeChunk =
				startOffset >= 0 ? document.content.slice(0, startOffset).split("\n").length : lineNumber;

			const linesInChunk = chunk.content.split("\n").length;

			const output: ChunkerOutput = {
				...chunk,
				sourceType: document.sourceType,
				byteOffsetStart: effectiveStart,
				byteOffsetEnd: effectiveStart + chunk.content.length,
				lineStart: linesBeforeChunk,
				lineEnd: linesBeforeChunk + linesInChunk - 1,
				chunkerName: this.name,
				chunkerVersion: this.version,
			};

			byteOffset = effectiveStart + chunk.content.length;
			lineNumber = linesBeforeChunk + linesInChunk - 1;

			return output;
		});
	}
}
