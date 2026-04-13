import type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";

/**
 * Test/helper reranker that preserves input order.
 */
export class PassthroughReranker implements Reranker {
	async rerank(
		_query: string,
		candidates: RerankCandidate[],
		options?: { topN?: number; signal?: AbortSignal },
	): Promise<RerankResult[]> {
		options?.signal?.throwIfAborted();
		const results = candidates.map((candidate, index) => ({
			id: candidate.id,
			score: candidates.length - index,
		}));
		return options?.topN == null ? results : results.slice(0, options.topN);
	}
}
