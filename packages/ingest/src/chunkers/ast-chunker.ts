import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { sha256Hex } from "../chunker.js";
import type { TreeSitterSymbol } from "../edges/tree-sitter-client.js";
import { treeSitterParse } from "../edges/tree-sitter-client.js";
import { AstHeuristicChunker } from "./ast-heuristic-chunker.js";

/**
 * Map common file extensions to tree-sitter language identifiers understood
 * by the sidecar. Must stay aligned with docker/tree-sitter-parser language
 * aliases — extensions not listed here fall through to the heuristic
 * chunker regardless of sidecar availability.
 */
const EXT_TO_TS_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	go: "go",
	rs: "rust",
	rb: "ruby",
	java: "java",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	hpp: "cpp",
};

export interface AstChunkerOptions {
	/** Base URL of the tree-sitter parser sidecar. Required — caller supplies it. */
	sidecarUrl: string;
	/** Per-request timeout (ms). Defaults to 5000. */
	sidecarTimeoutMs?: number;
	/**
	 * Fallback chunker used when the sidecar is unreachable, returns no
	 * symbols, or the language isn't supported. Defaults to AstHeuristicChunker,
	 * which ensures we never regress below the current regex-based behaviour.
	 */
	fallback?: Chunker;
}

/**
 * AST-aware code chunker (#220).
 *
 * Calls the tree-sitter sidecar to get structural symbols (functions, classes,
 * interfaces, methods, etc.), then emits one chunk per leaf-level symbol plus
 * a preamble chunk for everything before the first symbol. On any signal of
 * trouble — sidecar miss, zero symbols, unsupported language — it delegates
 * to `AstHeuristicChunker` so ingest never regresses.
 *
 * "Leaf-level" means: if a class has methods, emit chunks for each method
 * rather than one big class chunk. Top-level functions/interfaces/types
 * (which have no child symbols) emit as single chunks. This keeps chunks
 * aligned with the smallest semantic unit a query is likely to land on.
 */
export class AstChunker implements Chunker {
	readonly name = "ast";
	readonly version = "1.0.0";

	readonly #sidecarUrl: string;
	readonly #sidecarTimeoutMs: number;
	readonly #fallback: Chunker;

	constructor(options: AstChunkerOptions) {
		this.#sidecarUrl = options.sidecarUrl;
		this.#sidecarTimeoutMs = options.sidecarTimeoutMs ?? 5000;
		this.#fallback = options.fallback ?? new AstHeuristicChunker();
	}

	async chunk(document: ChunkerDocument, options?: ChunkerOptions): Promise<ChunkerOutput[]> {
		const ext = document.filePath?.split(".").pop()?.toLowerCase() ?? "";
		const language = EXT_TO_TS_LANG[ext];

		if (!language) {
			return this.#runFallback(document, options);
		}

		const response = await treeSitterParse(
			{ language, content: document.content, path: document.filePath },
			{ baseUrl: this.#sidecarUrl, timeoutMs: this.#sidecarTimeoutMs },
		);

		const symbols = response?.symbols ?? [];
		if (symbols.length === 0) {
			// Sidecar unreachable, no grammar, or file has no extractable symbols
			// (e.g. a pure-data TS file). Heuristic chunker handles these fine.
			return this.#runFallback(document, options);
		}

		return this.#chunksFromSymbols(symbols, document, options);
	}

	async #runFallback(
		document: ChunkerDocument,
		options: ChunkerOptions | undefined,
	): Promise<ChunkerOutput[]> {
		return await this.#fallback.chunk(document, options);
	}

	/**
	 * Convert the sidecar's structural symbol list into chunks.
	 *
	 * Strategy:
	 * - A symbol is "leaf" iff no other symbol names it as parent.
	 * - Emit one chunk per leaf symbol.
	 * - Emit a preamble chunk for content before the first leaf (imports,
	 *   module-level code) when non-empty.
	 * - If the leaf chunk exceeds `maxChunkChars`, window-split it.
	 * - symbolPath is built by walking parentIndex chain, joined with ".".
	 */
	#chunksFromSymbols(
		symbols: TreeSitterSymbol[],
		document: ChunkerDocument,
		options: ChunkerOptions | undefined,
	): ChunkerOutput[] {
		const maxChunkSize = options?.maxChunkChars ?? 4000;
		const content = document.content;

		// Find leaves — symbols with no child in the symbols array.
		const hasChild = new Set<number>();
		for (const s of symbols) {
			if (s.parentIndex >= 0) hasChild.add(s.parentIndex);
		}
		const leafIndices: number[] = [];
		for (let i = 0; i < symbols.length; i++) {
			if (!hasChild.has(i)) leafIndices.push(i);
		}

		// Sort leaves by byte offset so chunk order matches source order.
		leafIndices.sort((a, b) => {
			const sa = symbols[a];
			const sb = symbols[b];
			if (!sa || !sb) return 0;
			return sa.byteStart - sb.byteStart;
		});

		const chunks: ChunkerOutput[] = [];

		// Preamble: everything before the first leaf's start
		const firstLeaf = symbols[leafIndices[0] ?? -1];
		if (firstLeaf && firstLeaf.byteStart > 0) {
			const rawPreamble = content.slice(0, firstLeaf.byteStart);
			const trimmed = rawPreamble.trim();
			if (trimmed) {
				// Adjust offsets to describe exactly the trimmed content, so the
				// contract "byteOffsetStart..byteOffsetEnd describes chunk.content"
				// stays honest even when the raw region has padding.
				const leading = rawPreamble.length - rawPreamble.trimStart().length;
				const trailing = rawPreamble.length - rawPreamble.trimEnd().length;
				const byteStart = leading + 1; // 1-indexed
				const byteEnd = firstLeaf.byteStart - trailing;
				const linesBeforeTrimmed = content.slice(0, leading).split("\n").length;
				const trimmedNewlines = trimmed.split("\n").length - 1;
				chunks.push(
					this.#buildChunk({
						document,
						content: trimmed,
						index: 0,
						byteStart,
						byteEnd,
						lineStart: linesBeforeTrimmed,
						lineEnd: linesBeforeTrimmed + trimmedNewlines,
						symbolPath: "preamble",
					}),
				);
			}
		}

		for (const leafIdx of leafIndices) {
			const leaf = symbols[leafIdx];
			if (!leaf) continue;
			const rawContent = content.slice(leaf.byteStart, leaf.byteEnd);
			const trimmed = rawContent.trim();
			if (!trimmed) continue;

			const symbolPath = buildSymbolPath(symbols, leafIdx);
			const leading = rawContent.length - rawContent.trimStart().length;
			const trailing = rawContent.length - rawContent.trimEnd().length;

			if (trimmed.length > maxChunkSize) {
				// Large symbol (e.g. generated code, long test file). Window-split it
				// while keeping symbolPath so provenance is preserved. Offsets are
				// relative to the trimmed content, then shifted by leaf.byteStart +
				// leading whitespace skipped by trim().
				const pieces = windowSplit(trimmed, maxChunkSize);
				for (const [i, piece] of pieces.entries()) {
					chunks.push(
						this.#buildChunk({
							document,
							content: piece.content,
							index: chunks.length,
							byteStart: leaf.byteStart + leading + piece.offset + 1, // 1-indexed
							byteEnd: leaf.byteStart + leading + piece.offset + piece.content.length,
							lineStart: leaf.lineStart + piece.lineOffset,
							lineEnd: leaf.lineStart + piece.lineOffset + piece.lineCount,
							symbolPath: i === 0 ? symbolPath : `${symbolPath}#${i + 1}`,
						}),
					);
				}
			} else {
				chunks.push(
					this.#buildChunk({
						document,
						content: trimmed,
						index: chunks.length,
						byteStart: leaf.byteStart + leading + 1, // 1-indexed
						byteEnd: leaf.byteEnd - trailing,
						lineStart: leaf.lineStart,
						lineEnd: leaf.lineEnd,
						symbolPath,
					}),
				);
			}
		}

		// Back-fill chunkIndex / totalChunks now that we know the final count.
		for (let i = 0; i < chunks.length; i++) {
			const c = chunks[i];
			if (!c) continue;
			c.chunkIndex = i;
			c.totalChunks = chunks.length;
		}

		return chunks;
	}

	#buildChunk(args: {
		document: ChunkerDocument;
		content: string;
		index: number;
		byteStart: number;
		byteEnd: number;
		lineStart: number;
		lineEnd: number;
		symbolPath: string;
	}): ChunkerOutput {
		const { document, content, index, byteStart, byteEnd, lineStart, lineEnd, symbolPath } = args;
		const contentFingerprint = sha256Hex(content);
		const chunkId =
			document.documentId && document.documentVersionId
				? sha256Hex(`${document.documentId}:${document.documentVersionId}:${index}:${content}`)
				: sha256Hex(content);
		return {
			id: chunkId,
			content,
			sourceType: document.sourceType,
			source: document.source,
			sourceUrl: document.sourceUrl,
			timestamp: document.timestamp,
			timestampKind: document.timestampKind,
			chunkIndex: index,
			totalChunks: 0, // back-filled
			metadata: {
				...(document.metadata ?? {}),
				filePath: document.filePath ?? "",
			},
			documentId: document.documentId,
			documentVersionId: document.documentVersionId,
			contentFingerprint,
			byteOffsetStart: byteStart,
			byteOffsetEnd: byteEnd,
			lineStart,
			lineEnd,
			chunkerName: this.name,
			chunkerVersion: this.version,
			symbolPath,
		};
	}
}

/** Build a qualified symbol path like "User.greet" by walking parent indices. */
function buildSymbolPath(symbols: TreeSitterSymbol[], index: number): string {
	const parts: string[] = [];
	let cur: number = index;
	const seen = new Set<number>();
	while (cur >= 0 && !seen.has(cur)) {
		seen.add(cur);
		const s: TreeSitterSymbol | undefined = symbols[cur];
		if (!s) break;
		parts.unshift(s.name);
		cur = s.parentIndex;
	}
	return parts.length > 0 ? parts.join(".") : "(anonymous)";
}

interface WindowPiece {
	content: string;
	offset: number;
	lineOffset: number;
	lineCount: number;
}

/** Window-split oversized content, preserving line-offset info for provenance. */
function windowSplit(content: string, maxSize: number): WindowPiece[] {
	const pieces: WindowPiece[] = [];
	let offset = 0;
	while (offset < content.length) {
		const end = Math.min(offset + maxSize, content.length);
		const piece = content.slice(offset, end);
		const precedingLines = content.slice(0, offset).split("\n").length - 1;
		const pieceLineCount = piece.split("\n").length - 1;
		pieces.push({
			content: piece,
			offset,
			lineOffset: precedingLines,
			lineCount: pieceLineCount,
		});
		if (end === content.length) break;
		offset = end;
	}
	return pieces;
}
