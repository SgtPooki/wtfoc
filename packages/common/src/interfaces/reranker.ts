/**
 * Candidate text passed to a query-time reranker.
 */
export interface RerankCandidate {
	/** Opaque identifier used to correlate reranked outputs back to inputs. */
	id: string;
	/** Plain text content for the candidate chunk. */
	text: string;
}

/**
 * Reranker output for a single candidate.
 */
export interface RerankResult {
	/** Same identifier as the input candidate. */
	id: string;
	/** Provider-specific relevance score. Higher means more relevant. */
	score: number;
}

/**
 * Optional query-time reranker applied after vector retrieval.
 */
export interface Reranker {
	rerank(
		query: string,
		candidates: RerankCandidate[],
		options?: { topN?: number; signal?: AbortSignal },
	): Promise<RerankResult[]>;
}
