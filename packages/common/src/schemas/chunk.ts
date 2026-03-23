/**
 * A chunk of content extracted from a source, with provenance metadata.
 */
export interface Chunk {
	/** Deterministic content hash (SHA-256 of content) — used as dedup key */
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
}
