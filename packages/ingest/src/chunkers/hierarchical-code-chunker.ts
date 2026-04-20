import type { Chunker, ChunkerDocument, ChunkerOptions, ChunkerOutput } from "@wtfoc/common";
import { sha256Hex } from "../chunker.js";
import { AstHeuristicChunker, EXT_TO_LANG, findBoundaryLines } from "./ast-heuristic-chunker.js";

/**
 * Symbol path used on the file-level summary chunk. Distinguishes it from
 * symbol chunks (function/class names) in trace output, lineage analysis,
 * and retrieval ranking.
 */
export const FILE_SUMMARY_SYMBOL = "__file_summary__";

/**
 * Patterns that match top-of-file import/use/require statements per language.
 * Lines matching these are pulled into the file-level summary so retrieval
 * has a single chunk with the file's full dependency surface.
 */
const IMPORT_PATTERNS: Record<string, RegExp> = {
	ts: /^\s*import\b|^\s*export\s+.*\bfrom\b/,
	js: /^\s*import\b|^\s*(?:const|let|var)\s+\w+\s*=\s*require\(/,
	py: /^\s*(?:from\s+\S+\s+)?import\b/,
	go: /^\s*(?:import\s+["(]|\s+"[^"]+")/,
	rs: /^\s*use\s+/,
	rb: /^\s*require\b/,
	java: /^\s*import\s+/,
};

/**
 * Hierarchical code chunker (#252).
 *
 * Wraps an inner symbol-level code chunker (default: AstHeuristicChunker) and
 * emits one **file-level summary chunk** per document in addition to the
 * symbol chunks. The summary gives retrieval a single entry point that
 * answers "what does this file do overall?" — imports + docstring + symbol
 * index — which previously required aggregating across every symbol chunk.
 *
 * Scope of the summary content:
 * - Top-of-file comment block (JSDoc, `"""..."""`, `// …`, `/* … *\/` up to
 *   the first non-comment line).
 * - All import/use/require statements detected by language.
 * - Enumeration of symbol names detected by the inner chunker.
 *
 * The summary chunk carries `symbolPath = FILE_SUMMARY_SYMBOL` and is emitted
 * as the first chunk (chunkIndex=0). When the inner chunker yields no symbol
 * chunks (empty file, unsupported language with no boundaries), only the
 * inner output is returned — no summary chunk is synthesized from nothing.
 */
export class HierarchicalCodeChunker implements Chunker {
	readonly name = "hierarchical-code";
	readonly version = "1.0.0";

	readonly #inner: Chunker;

	constructor(inner: Chunker = new AstHeuristicChunker()) {
		this.#inner = inner;
	}

	async chunk(document: ChunkerDocument, options?: ChunkerOptions): Promise<ChunkerOutput[]> {
		const symbolChunks = await this.#inner.chunk(document, options);
		if (symbolChunks.length === 0) return symbolChunks;

		const summary = buildFileSummary(document, symbolChunks);
		if (!summary) return symbolChunks;

		// Prepend summary and reindex so chunkIndex reflects the final order.
		const reindexed: ChunkerOutput[] = symbolChunks.map((c, idx) => ({
			...c,
			chunkIndex: idx + 1,
			totalChunks: symbolChunks.length + 1,
		}));
		summary.totalChunks = symbolChunks.length + 1;
		return [summary, ...reindexed];
	}
}

function buildFileSummary(
	document: ChunkerDocument,
	symbolChunks: ChunkerOutput[],
): ChunkerOutput | null {
	const ext = document.filePath?.split(".").pop()?.toLowerCase() ?? "";
	const lang = EXT_TO_LANG[ext];
	if (!lang) return null;

	const lines = document.content.split("\n");
	const header = extractHeaderComment(lines);
	const imports = extractImports(lines, lang);
	const symbolNames = collectSymbolNames(document.content, lang, symbolChunks);

	// Without any of the three signals, a summary adds no information.
	if (!header && imports.length === 0 && symbolNames.length === 0) return null;

	const parts: string[] = [];
	parts.push(`File: ${document.source}`);
	if (header) parts.push(`\n${header}`);
	if (imports.length > 0) parts.push(`\nImports:\n${imports.join("\n")}`);
	if (symbolNames.length > 0)
		parts.push(`\nSymbols:\n${symbolNames.map((s) => `- ${s}`).join("\n")}`);

	const content = parts.join("\n");
	const contentFingerprint = sha256Hex(content);
	const chunkId =
		document.documentId && document.documentVersionId
			? sha256Hex(`${document.documentId}:${document.documentVersionId}:summary:${content}`)
			: sha256Hex(`summary:${content}`);

	return {
		id: chunkId,
		content,
		sourceType: document.sourceType,
		source: document.source,
		sourceUrl: document.sourceUrl,
		timestamp: document.timestamp,
		timestampKind: document.timestampKind,
		chunkIndex: 0,
		totalChunks: 0, // set by caller
		metadata: {
			...(document.metadata ?? {}),
			filePath: document.filePath ?? "",
			chunkLevel: "file",
		},
		documentId: document.documentId,
		documentVersionId: document.documentVersionId,
		contentFingerprint,
		chunkerName: "hierarchical-code",
		chunkerVersion: "1.0.0",
		symbolPath: FILE_SUMMARY_SYMBOL,
	};
}

/**
 * Pull a top-of-file comment block. Stops at the first non-comment, non-blank
 * line. Handles `/* … *\/`, `///`, `//`, `#`, and Python triple-quote strings.
 */
function extractHeaderComment(lines: string[]): string | null {
	const out: string[] = [];
	let inBlock = false;
	let inTripleQuote = false;
	let tripleQuoteChar: '"""' | "'''" | "" = "";

	for (const raw of lines) {
		const line = raw.trimEnd();
		const trimmed = line.trimStart();

		if (inBlock) {
			out.push(line);
			if (trimmed.endsWith("*/")) inBlock = false;
			continue;
		}
		if (inTripleQuote) {
			out.push(line);
			if (trimmed.includes(tripleQuoteChar)) {
				inTripleQuote = false;
				tripleQuoteChar = "";
			}
			continue;
		}

		if (trimmed === "") {
			if (out.length > 0) out.push("");
			continue;
		}

		if (trimmed.startsWith("/*")) {
			out.push(line);
			if (!trimmed.endsWith("*/")) inBlock = true;
			continue;
		}
		if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
			out.push(line);
			continue;
		}
		if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
			tripleQuoteChar = trimmed.startsWith('"""') ? '"""' : "'''";
			out.push(line);
			// Same-line close (e.g. """one-liner""")
			if (trimmed.length > 3 && trimmed.slice(3).includes(tripleQuoteChar)) {
				tripleQuoteChar = "";
			} else {
				inTripleQuote = true;
			}
			continue;
		}

		break;
	}

	const text = out.join("\n").trim();
	return text.length > 0 ? text : null;
}

function extractImports(lines: string[], lang: string): string[] {
	const pattern = IMPORT_PATTERNS[lang];
	if (!pattern) return [];
	const out: string[] = [];
	for (const line of lines) {
		if (pattern.test(line)) out.push(line.trimEnd());
	}
	return out;
}

/**
 * Collect symbol names from the inner chunker's `symbolPath` field AND from
 * a boundary scan of the full content. Merging both covers gaps: AST variants
 * that omit `symbolPath` on some sub-chunks (historically oversized symbols
 * — see AstHeuristicChunker) and boundaries the inner chunker merged away.
 * Dedupe preserves the order of first appearance, inner paths first.
 */
function collectSymbolNames(
	content: string,
	lang: string,
	symbolChunks: ChunkerOutput[],
): string[] {
	const fromInner = symbolChunks
		.map((c) => c.symbolPath)
		.filter((s): s is string => typeof s === "string" && s.length > 0 && s !== "preamble");

	const lines = content.split("\n");
	const boundaries = findBoundaryLines(lines, lang);
	const fromScan: string[] = [];
	for (const b of boundaries) {
		const line = lines[b];
		if (!line) continue;
		const match = line.match(
			/(?:function|class|interface|type|enum|struct|trait|impl|def|func|module)\s+(\w+)/,
		);
		if (match?.[1]) fromScan.push(match[1]);
	}

	return dedupeStable([...fromInner, ...fromScan]);
}

function dedupeStable<T>(items: T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const it of items) {
		if (seen.has(it)) continue;
		seen.add(it);
		out.push(it);
	}
	return out;
}
