import { createHash } from "node:crypto";
import { type Chunk, WtfocError } from "@wtfoc/common";

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 0;
/** Default max chars for rechunking oversized chunks (~1.5K tokens, safe for 2048-token models). */
export const DEFAULT_MAX_CHUNK_CHARS = 4000;

export interface MarkdownChunkerOptions {
	/** Maximum characters per chunk, measured as JavaScript string length (UTF-16 code units). Default 512. */
	chunkSize?: number;
	/** Characters from the end of the previous chunk included at the start of the next. Default 0. */
	chunkOverlap?: number;
	/** Source identifier stored on each chunk (`Chunk.source`). */
	source: string;
	sourceUrl?: string;
	timestamp?: string;
	/** Merged into each chunk's `metadata`. */
	metadata?: Record<string, string>;
	/** Stable logical key for the source document */
	documentId?: string;
	/** Version token for this specific version of the document */
	documentVersionId?: string;
}

export function sha256Hex(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Compute a chunk ID that encodes document provenance when available.
 * When document identity is present: hash(documentId + documentVersionId + chunkIndex + content).
 * documentId ensures two files with identical content get different chunk IDs.
 * Otherwise: hash(content) — backward-compatible content-based identity.
 */
function computeChunkId(
	content: string,
	chunkIndex: number,
	documentId?: string,
	documentVersionId?: string,
): string {
	if (documentId && documentVersionId) {
		return sha256Hex(`${documentId}:${documentVersionId}:${chunkIndex}:${content}`);
	}
	return sha256Hex(content);
}

function clampOverlap(overlap: number, chunkSize: number): number {
	if (overlap <= 0) return 0;
	if (chunkSize <= 1) return 0;
	return Math.min(overlap, chunkSize - 1);
}

/**
 * Finds the exclusive end index for `text.slice(start, end)` using split priority:
 * markdown header line > blank line (paragraph) > sentence punctuation > hard cap.
 */
export function findMarkdownSplitEnd(text: string, start: number, maxEnd: number): number {
	const limit = Math.min(maxEnd, text.length);
	const minEnd = start + 1;
	if (limit <= start) return start;
	if (limit <= minEnd) return limit;

	// 1) Markdown ATX header at line start (split before the # line)
	for (let pos = limit - 1; pos >= minEnd; pos--) {
		if (pos > 0 && text[pos - 1] !== "\n") continue;
		if (/^#{1,6}\s/.test(text.slice(pos, pos + 8)) && pos > start) {
			return pos;
		}
	}

	// 2) Paragraph boundary: split before \n\n (exclusive end = index of first \n)
	for (let i = limit - 2; i >= start; i--) {
		if (text[i] === "\n" && text[i + 1] === "\n" && i >= minEnd - 1) {
			if (i > start) return i;
		}
	}

	// 3) Sentence end: . ! ? followed by whitespace within the window
	for (let i = limit - 1; i >= minEnd; i--) {
		const c = text[i];
		if (c !== "." && c !== "!" && c !== "?") continue;
		if (i + 1 >= limit) continue;
		const next = text[i + 1];
		if (next === " " || next === "\n" || next === "\t") {
			// Include the punctuation; end after it (exclude following whitespace from this chunk)
			const end = i + 1;
			if (end > start) return end;
		}
	}

	return limit;
}

/**
 * Splits markdown into chunks with deterministic SHA-256 ids (hash of chunk text).
 * Split priority when a window must break: headers, then paragraphs, then sentences, then raw length.
 */
export function chunkMarkdown(markdown: string, options: MarkdownChunkerOptions): Chunk[] {
	const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
	let chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

	if (!Number.isFinite(chunkSize) || !Number.isInteger(chunkSize) || chunkSize < 1) {
		throw new WtfocError("chunkSize must be a finite integer >= 1", "INVALID_CHUNK_SIZE", {
			chunkSize,
		});
	}
	if (!Number.isFinite(chunkOverlap) || !Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
		throw new WtfocError("chunkOverlap must be a finite integer >= 0", "INVALID_CHUNK_OVERLAP", {
			chunkOverlap,
		});
	}

	chunkOverlap = clampOverlap(chunkOverlap, chunkSize);
	if (markdown.length === 0) {
		return [];
	}

	const rawChunks: string[] = [];
	let start = 0;
	let prevEnd = 0;
	const maxIterations = markdown.length + 5;
	for (let iter = 0; iter < maxIterations; iter++) {
		if (start >= markdown.length) break;

		const maxEnd = Math.min(start + chunkSize, markdown.length);
		let end: number;
		if (maxEnd >= markdown.length) {
			end = markdown.length;
		} else {
			end = findMarkdownSplitEnd(markdown, start, maxEnd);
			// When overlap is active, ensure the split advances past the previous
			// chunk boundary so every chunk contains new content beyond the overlap.
			if (chunkOverlap > 0 && end <= prevEnd && prevEnd < maxEnd) {
				end = findMarkdownSplitEnd(markdown, prevEnd, maxEnd);
			}
			if (end <= start) {
				end = maxEnd;
			}
		}

		const content = markdown.slice(start, end);
		rawChunks.push(content);

		if (end >= markdown.length) break;

		prevEnd = end;
		const nextStart = end - chunkOverlap;
		start = nextStart <= start ? end : nextStart;
	}

	const totalChunks = rawChunks.length;
	const baseMeta: Record<string, string> = {
		...(options.metadata ?? {}),
	};

	const chunks: Chunk[] = rawChunks.map((content, chunkIndex) => {
		const contentFingerprint = sha256Hex(content);
		const chunk: Chunk = {
			id: computeChunkId(content, chunkIndex, options.documentId, options.documentVersionId),
			content,
			sourceType: "markdown",
			source: options.source,
			sourceUrl: options.sourceUrl,
			timestamp: options.timestamp,
			chunkIndex,
			totalChunks,
			metadata: { ...baseMeta },
			contentFingerprint,
		};
		if (options.documentId) chunk.documentId = options.documentId;
		if (options.documentVersionId) chunk.documentVersionId = options.documentVersionId;
		return chunk;
	});

	return chunks;
}

/**
 * Split any chunk whose content exceeds `maxChars` into smaller pieces.
 * Chunks already within the limit pass through unchanged.
 *
 * Uses the same markdown-aware split logic as `chunkMarkdown()` so it
 * breaks at headers > paragraphs > sentences > hard cap.
 *
 * Split chunks get new SHA-256 IDs, updated chunkIndex/totalChunks,
 * and a `parentChunkId` metadata field pointing to the original.
 */
export function rechunkOversized(chunks: Chunk[], maxChars?: number): Chunk[] {
	const limit = maxChars ?? DEFAULT_MAX_CHUNK_CHARS;
	if (limit < 1) return chunks;

	const result: Chunk[] = [];

	for (const chunk of chunks) {
		if (chunk.content.length <= limit) {
			result.push(chunk);
			continue;
		}

		// Split the oversized content
		const pieces: string[] = [];
		let start = 0;
		const maxIterations = chunk.content.length + 5;
		for (let iter = 0; iter < maxIterations; iter++) {
			if (start >= chunk.content.length) break;
			const maxEnd = Math.min(start + limit, chunk.content.length);
			const end =
				maxEnd >= chunk.content.length
					? chunk.content.length
					: findMarkdownSplitEnd(chunk.content, start, maxEnd);
			const actualEnd = end <= start ? maxEnd : end;
			pieces.push(chunk.content.slice(start, actualEnd));
			if (actualEnd >= chunk.content.length) break;
			start = actualEnd;
		}

		const totalChunks = pieces.length;
		for (const [i, content] of pieces.entries()) {
			const contentFingerprint = sha256Hex(content);
			result.push({
				...chunk,
				id: computeChunkId(content, i, chunk.documentId, chunk.documentVersionId),
				content,
				chunkIndex: i,
				totalChunks,
				contentFingerprint,
				metadata: {
					...chunk.metadata,
					parentChunkId: chunk.id,
				},
			});
		}
	}

	return result;
}
