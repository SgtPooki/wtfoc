import type { Chunk } from "../schemas/chunk.js";

/**
 * Input document for chunking — carries identity, version, and raw content.
 */
export interface ChunkerDocument {
	/** Stable logical key for the source document */
	documentId: string;
	/** Version token for this specific version */
	documentVersionId: string;
	/** Complete raw content to chunk */
	content: string;
	/** Source type (e.g. "code", "markdown", "github-issue") */
	sourceType: string;
	/** Source identifier (e.g. "owner/repo/path/to/file.ts") */
	source: string;
	/** URL back to the original source */
	sourceUrl?: string;
	/** When the source was created/modified */
	timestamp?: string;
	/** Additional metadata to propagate to chunks */
	metadata?: Record<string, string>;
	/** File path relative to repo root (for language detection) */
	filePath?: string;
}

/**
 * A chunk with span information for provenance back to the raw source.
 */
export interface ChunkerOutput extends Chunk {
	/** Byte offset of this chunk's start in the raw source */
	byteOffsetStart?: number;
	/** Byte offset of this chunk's end in the raw source */
	byteOffsetEnd?: number;
	/** Line number (1-based) where this chunk starts in the raw source */
	lineStart?: number;
	/** Line number (1-based) where this chunk ends in the raw source */
	lineEnd?: number;
	/** Name of the chunker that produced this chunk */
	chunkerName?: string;
	/** Version of the chunker that produced this chunk */
	chunkerVersion?: string;
	/** For code chunkers: symbol path (e.g. "MyClass.myMethod") */
	symbolPath?: string;
}

/**
 * Pluggable chunker interface.
 *
 * Implementations split a document into chunks with identity, spans, and
 * chunker provenance. The interface accepts a full document object so
 * chunkers have access to identity, version, and raw content metadata.
 *
 * Built-in implementations:
 * - MarkdownChunker: header/paragraph/sentence-aware splitting
 * - CodeChunker: character-window splitting with overlap
 *
 * Future implementations:
 * - TreeSitterChunker: AST-aware splitting by function/class boundaries
 */
export interface Chunker {
	/** Unique name for this chunker (e.g. "markdown", "code-window", "tree-sitter") */
	readonly name: string;
	/** Semantic version of this chunker implementation */
	readonly version: string;
	/**
	 * Chunk a document into pieces with spans and provenance.
	 *
	 * Returns either a synchronous array (pure-local chunkers like markdown,
	 * code-window, ast-heuristic) or a Promise (chunkers that consult an
	 * external service — e.g. the tree-sitter sidecar for AST-aware
	 * chunking, #220). Callers should always `await` the result so both
	 * cases are handled uniformly.
	 */
	chunk(
		document: ChunkerDocument,
		options?: ChunkerOptions,
	): ChunkerOutput[] | Promise<ChunkerOutput[]>;
}

export interface ChunkerOptions {
	/** Maximum characters per chunk */
	chunkSize?: number;
	/** Characters of overlap between adjacent chunks */
	chunkOverlap?: number;
	/** Maximum characters before a chunk is force-split */
	maxChunkChars?: number;
}
