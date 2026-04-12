/** Lifecycle state for a document version within a collection */
export type DocumentLifecycleState = "active" | "archived" | "superseded";

/** How a source handles content updates */
export type DocumentMutability = "mutable-state" | "append-only";

/**
 * A chunk of content extracted from a source, with provenance metadata.
 */
export interface Chunk {
	/** Chunk identity — hash(documentVersionId + chunkIndex + content) when document identity is available, otherwise hash(content) for backward compat */
	id: string;
	/** The text content of this chunk */
	content: string;
	/** Source type: 'slack-message', 'github-issue', 'github-pr', 'code', 'markdown', 'doc' */
	sourceType: string;
	/** Source identifier: "#foc-support", "FilOzone/synapse-sdk#142", etc. */
	source: string;
	/** URL back to the original source (if available) */
	sourceUrl?: string;
	/** When the original source was created/modified */
	timestamp?: string;
	/** Position within the source document */
	chunkIndex: number;
	/** Total chunks from this source document */
	totalChunks: number;
	/** Additional source-specific metadata */
	metadata: Record<string, string>;
	/** Stable logical key for the source document (e.g. "owner/repo/path/to/file.ts", "owner/repo#42", "channel:message_ts") */
	documentId?: string;
	/** Version token for this specific version of the document (e.g. git blob SHA, updated_at timestamp, content hash) */
	documentVersionId?: string;
	/** SHA-256 of content text — used for compute dedup (skip re-embedding unchanged text) */
	contentFingerprint?: string;
	/** Complete raw source content before chunking. Carried on chunkIndex=0 only, not persisted in segments. Used by ingest to archive raw sources. */
	rawContent?: string;
}

/**
 * An entry in the collection-level document catalog.
 * Tracks the lifecycle of each logical document across ingest runs.
 */
export interface DocumentCatalogEntry {
	/** Stable logical key matching Chunk.documentId */
	documentId: string;
	/** Current version token */
	currentVersionId: string;
	/** Previous version tokens (most recent first) for version chain navigation */
	previousVersionIds: string[];
	/** Chunk IDs belonging to the current version */
	chunkIds: string[];
	/** Chunk IDs from superseded versions (should be excluded from search) */
	supersededChunkIds: string[];
	/** Current lifecycle state */
	state: DocumentLifecycleState;
	/** How this source handles updates */
	mutability: DocumentMutability;
	/** Source type of the document */
	sourceType: string;
	/** When this entry was last updated */
	updatedAt: string;
}

/**
 * Collection-level document catalog — the filter layer for lifecycle management.
 * Stored as a sidecar file, NOT inside immutable segments.
 */
export interface DocumentCatalog {
	schemaVersion: 1;
	/** collectionId this catalog belongs to */
	collectionId: string;
	/** Map of documentId → catalog entry */
	documents: Record<string, DocumentCatalogEntry>;
}

/**
 * Structured evidence for an edge — PROV-lite lineage.
 * Replaces flat evidence strings for richer provenance.
 */
export interface StructuredEvidence {
	/** Human-readable explanation */
	text: string;
	/** Raw source artifact reference (documentId or URL) */
	sourceArtifactId?: string;
	/** Which document version this evidence comes from */
	documentVersionId?: string;
	/** Byte/line range within the source */
	chunkSpan?: string;
	/** Which extractor produced this */
	extractor?: string;
	/** LLM model if applicable */
	model?: string;
	/** When this evidence was observed */
	observedAt?: string;
	/** Confidence score for this specific piece of evidence */
	confidence?: number;
}
