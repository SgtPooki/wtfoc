import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { chunkCode } from "../adapters/repo/chunking.js";

/**
 * Character-window code chunker with overlap.
 * Wraps the existing chunkCode function with the Chunker interface.
 */
export class CodeWindowChunker implements Chunker {
	readonly name = "code-window";
	readonly version = "1.0.0";

	chunk(document: ChunkerDocument, _options?: ChunkerOptions): ChunkerOutput[] {
		const filePath = document.filePath ?? document.source;
		const repo = document.metadata?.repo ?? "";
		const sourceUrl = document.sourceUrl ?? "";

		const chunks = chunkCode(document.content, filePath, repo, sourceUrl, {
			documentId: document.documentId,
			documentVersionId: document.documentVersionId,
		});

		let byteOffset = 0;

		return chunks.map((chunk) => {
			const startOffset = document.content.indexOf(chunk.content, byteOffset);
			const effectiveStart = startOffset >= 0 ? startOffset : byteOffset;
			const linesBeforeChunk =
				startOffset >= 0 ? document.content.slice(0, startOffset).split("\n").length : 1;
			const linesInChunk = chunk.content.split("\n").length;

			const output: ChunkerOutput = {
				...chunk,
				byteOffsetStart: effectiveStart,
				byteOffsetEnd: effectiveStart + chunk.content.length,
				lineStart: linesBeforeChunk,
				lineEnd: linesBeforeChunk + linesInChunk - 1,
				chunkerName: this.name,
				chunkerVersion: this.version,
			};

			byteOffset = effectiveStart + chunk.content.length;
			return output;
		});
	}
}
