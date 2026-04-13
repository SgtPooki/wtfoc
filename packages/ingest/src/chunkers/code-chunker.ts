import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { chunkCode, MANIFEST_FILENAMES } from "../adapters/repo/chunking.js";

/**
 * Character-window code chunker with overlap.
 * Wraps the existing chunkCode function with the Chunker interface.
 */
export class CodeWindowChunker implements Chunker {
	readonly name = "code-window";
	readonly version = "1.0.0";

	chunk(document: ChunkerDocument, options?: ChunkerOptions): ChunkerOutput[] {
		const filePath = document.filePath ?? document.source;
		const repo = document.metadata?.repo ?? "";
		const sourceUrl = document.sourceUrl ?? "";
		const chunkSz = options?.chunkSize ?? 512;
		// Clamp mirrors chunkCode's own clamping so spans stay in sync
		const overlap = Math.min(options?.chunkOverlap ?? 50, Math.max(0, chunkSz - 1));

		const chunks = chunkCode(document.content, filePath, repo, sourceUrl, {
			documentId: document.documentId,
			documentVersionId: document.documentVersionId,
			chunkSize: chunkSz,
			chunkOverlap: overlap,
		});

		// Manifest files (package.json, go.mod, etc.) are emitted as a single whole-file
		// chunk by chunkCode — no sliding window. Detect this fast path and use the full
		// file span directly instead of running the mirror loop (which would produce 0..512).
		const fileName = filePath.split("/").pop() ?? "";
		if (MANIFEST_FILENAMES.has(fileName) && chunks.length === 1) {
			const totalLines = document.content.split("\n").length;
			return [
				{
					...(chunks[0] as (typeof chunks)[0]),
					byteOffsetStart: 0,
					byteOffsetEnd: document.content.length,
					lineStart: 1,
					lineEnd: totalLines,
					chunkerName: this.name,
					chunkerVersion: this.version,
				},
			];
		}

		// Recompute byte spans by mirroring chunkCode's sliding-window logic directly.
		// indexOf() is unreliable for repetitive content — a chunk that starts at offset 462
		// may be found at 512 or later when content is uniform.
		const spans: Array<{ start: number; end: number }> = [];
		let winOffset = 0;
		let chunkIdx = 0;
		while (winOffset < document.content.length && chunkIdx < chunks.length) {
			const end = Math.min(winOffset + chunkSz, document.content.length);
			if (document.content.slice(winOffset, end).trim()) {
				spans.push({ start: winOffset, end });
				chunkIdx++;
			}
			winOffset = end - overlap;
			if (end === document.content.length) break;
		}

		return chunks.map((chunk, i) => {
			const span = spans[i];
			const effectiveStart = span?.start ?? 0;
			const effectiveEnd = span?.end ?? effectiveStart + chunk.content.length;
			const linesBeforeChunk = document.content.slice(0, effectiveStart).split("\n").length;
			const linesInChunk = chunk.content.split("\n").length;

			return {
				...chunk,
				byteOffsetStart: effectiveStart,
				byteOffsetEnd: effectiveEnd,
				lineStart: linesBeforeChunk,
				lineEnd: linesBeforeChunk + linesInChunk - 1,
				chunkerName: this.name,
				chunkerVersion: this.version,
			};
		});
	}
}
