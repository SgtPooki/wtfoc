import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { sha256Hex } from "../chunker.js";
import { CodeWindowChunker } from "./code-chunker.js";

/**
 * Language-specific patterns for detecting function/class/method boundaries.
 */
const BOUNDARY_PATTERNS: Record<string, RegExp[]> = {
	ts: [
		/^(?:export\s+)?(?:async\s+)?function\s+\w+/m,
		/^(?:export\s+)?(?:abstract\s+)?class\s+\w+/m,
		/^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(/m,
		/^(?:export\s+)?interface\s+\w+/m,
		/^(?:export\s+)?type\s+\w+/m,
		/^(?:export\s+)?enum\s+\w+/m,
		/^\s+(?:async\s+)?(?:get\s+|set\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/m,
	],
	js: [
		/^(?:export\s+)?(?:async\s+)?function\s+\w+/m,
		/^(?:export\s+)?class\s+\w+/m,
		/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/m,
		/^\s+(?:async\s+)?(?:get\s+|set\s+)?\w+\s*\([^)]*\)\s*\{/m,
	],
	py: [
		/^(?:async\s+)?def\s+\w+/m,
		/^class\s+\w+/m,
		/^@\w+/m, // decorators often precede function/class defs
	],
	go: [/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+/m, /^type\s+\w+\s+(?:struct|interface)/m],
	rs: [
		/^(?:pub\s+)?(?:async\s+)?fn\s+\w+/m,
		/^(?:pub\s+)?struct\s+\w+/m,
		/^(?:pub\s+)?enum\s+\w+/m,
		/^(?:pub\s+)?trait\s+\w+/m,
		/^impl\s+/m,
	],
	rb: [/^(?:\s+)?def\s+\w+/m, /^class\s+\w+/m, /^module\s+\w+/m],
	java: [
		/^(?:\s+)?(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+\w+/m,
		/^(?:\s+)?(?:public|private|protected)?\s*(?:static\s+)?(?:synchronized\s+)?(?:\w+(?:<[^>]+>)?)\s+\w+\s*\(/m,
	],
};

const EXT_TO_LANG: Record<string, string> = {
	ts: "ts",
	tsx: "ts",
	js: "js",
	jsx: "js",
	mjs: "js",
	cjs: "js",
	py: "py",
	go: "go",
	rs: "rs",
	rb: "rb",
	java: "java",
	kt: "java",
	scala: "java",
};

/**
 * Find line indices where code boundaries (function/class/method declarations) occur.
 */
function findBoundaryLines(lines: string[], lang: string): number[] {
	const patterns = BOUNDARY_PATTERNS[lang];
	if (!patterns) return [];

	const boundaries: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (patterns.some((p) => p.test(line))) {
			boundaries.push(i);
		}
	}
	return boundaries;
}

/**
 * Extract a symbol name from a boundary line.
 */
function extractSymbolName(line: string): string {
	// Try to match common declaration patterns
	const match = line.match(
		/(?:function|class|interface|type|enum|struct|trait|impl|def|func|module)\s+(\w+)/,
	);
	if (match?.[1]) return match[1];
	// Const/let arrow function
	const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
	if (arrowMatch?.[1]) return arrowMatch[1];
	// Method name
	const methodMatch = line.match(/^\s+(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/);
	if (methodMatch?.[1]) return methodMatch[1];
	return "unknown";
}

/**
 * AST-heuristic code chunker.
 *
 * Splits code at function/class/method boundaries using language-specific
 * regex patterns. Falls back to fixed-size windowing for unsupported
 * languages or when no boundaries are found.
 *
 * This is a practical 80% solution before full tree-sitter integration.
 * For supported languages (TS, JS, Python, Go, Rust, Ruby, Java), chunks
 * align to meaningful code units instead of arbitrary character boundaries.
 */
export class AstHeuristicChunker implements Chunker {
	readonly name = "ast-heuristic";
	readonly version = "1.0.0";

	chunk(document: ChunkerDocument, options?: ChunkerOptions): ChunkerOutput[] {
		const ext = document.filePath?.split(".").pop()?.toLowerCase() ?? "";
		const lang = EXT_TO_LANG[ext];
		const maxChunkSize = options?.maxChunkChars ?? 4000;

		if (!lang) {
			return this.#fallbackChunk(document, options);
		}

		const lines = document.content.split("\n");
		const boundaries = findBoundaryLines(lines, lang);

		if (boundaries.length === 0) {
			return this.#fallbackChunk(document, options);
		}

		const chunks: ChunkerOutput[] = [];

		// Split content at boundary lines
		for (let i = 0; i < boundaries.length; i++) {
			const startLine = boundaries[i] as number;
			const endLine = i + 1 < boundaries.length ? (boundaries[i + 1] as number) : lines.length;
			const chunkLines = lines.slice(startLine, endLine);
			const content = chunkLines.join("\n").trim();

			if (!content) continue;

			// If chunk is too large, split it further
			if (content.length > maxChunkSize) {
				const subChunks = this.#splitLargeChunk(
					content,
					document,
					chunks.length,
					startLine + 1,
					maxChunkSize,
				);
				chunks.push(...subChunks);
				continue;
			}

			const contentFingerprint = sha256Hex(content);
			const chunkId =
				document.documentId && document.documentVersionId
					? sha256Hex(
							`${document.documentId}:${document.documentVersionId}:${chunks.length}:${content}`,
						)
					: sha256Hex(content);

			const symbolName = extractSymbolName(chunkLines[0] ?? "");

			chunks.push({
				id: chunkId,
				content,
				sourceType: document.sourceType,
				source: document.source,
				sourceUrl: document.sourceUrl,
				timestamp: document.timestamp,
				chunkIndex: chunks.length,
				totalChunks: 0, // filled in after
				metadata: {
					...(document.metadata ?? {}),
					filePath: document.filePath ?? "",
				},
				documentId: document.documentId,
				documentVersionId: document.documentVersionId,
				contentFingerprint,
				byteOffsetStart: lines.slice(0, startLine).join("\n").length + 1,
				byteOffsetEnd: lines.slice(0, endLine).join("\n").length,
				lineStart: startLine + 1,
				lineEnd: endLine,
				chunkerName: this.name,
				chunkerVersion: this.version,
				symbolPath: symbolName,
			});
		}

		// Handle content before first boundary
		if (boundaries.length > 0 && (boundaries[0] as number) > 0) {
			const preamble = lines.slice(0, boundaries[0]).join("\n").trim();
			if (preamble) {
				const contentFingerprint = sha256Hex(preamble);
				const chunkId =
					document.documentId && document.documentVersionId
						? sha256Hex(`${document.documentId}:${document.documentVersionId}:preamble:${preamble}`)
						: sha256Hex(preamble);

				chunks.unshift({
					id: chunkId,
					content: preamble,
					sourceType: document.sourceType,
					source: document.source,
					sourceUrl: document.sourceUrl,
					timestamp: document.timestamp,
					chunkIndex: 0,
					totalChunks: 0,
					metadata: {
						...(document.metadata ?? {}),
						filePath: document.filePath ?? "",
					},
					documentId: document.documentId,
					documentVersionId: document.documentVersionId,
					contentFingerprint,
					lineStart: 1,
					lineEnd: boundaries[0] as number,
					chunkerName: this.name,
					chunkerVersion: this.version,
					symbolPath: "preamble",
				});
			}
		}

		// Fix indices and totalChunks
		for (let i = 0; i < chunks.length; i++) {
			(chunks[i] as ChunkerOutput).chunkIndex = i;
			(chunks[i] as ChunkerOutput).totalChunks = chunks.length;
		}

		return chunks;
	}

	#splitLargeChunk(
		content: string,
		document: ChunkerDocument,
		baseIndex: number,
		lineOffset: number,
		maxSize: number,
	): ChunkerOutput[] {
		const pieces: ChunkerOutput[] = [];
		let offset = 0;

		while (offset < content.length) {
			const end = Math.min(offset + maxSize, content.length);
			const piece = content.slice(offset, end);
			const contentFingerprint = sha256Hex(piece);
			const chunkId =
				document.documentId && document.documentVersionId
					? sha256Hex(
							`${document.documentId}:${document.documentVersionId}:${baseIndex + pieces.length}:${piece}`,
						)
					: sha256Hex(piece);

			pieces.push({
				id: chunkId,
				content: piece,
				sourceType: document.sourceType,
				source: document.source,
				sourceUrl: document.sourceUrl,
				timestamp: document.timestamp,
				chunkIndex: baseIndex + pieces.length,
				totalChunks: 0,
				metadata: {
					...(document.metadata ?? {}),
					filePath: document.filePath ?? "",
				},
				documentId: document.documentId,
				documentVersionId: document.documentVersionId,
				contentFingerprint,
				lineStart: lineOffset,
				chunkerName: this.name,
				chunkerVersion: this.version,
			});

			offset = end;
		}

		return pieces;
	}

	#fallbackChunk(document: ChunkerDocument, options?: ChunkerOptions): ChunkerOutput[] {
		return new CodeWindowChunker().chunk(document, options);
	}
}
