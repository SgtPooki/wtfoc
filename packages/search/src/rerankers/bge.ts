import type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";

export interface BgeRerankerOptions {
	/** Base URL of the bge-reranker sidecar, e.g. http://localhost:8385 */
	url: string;
}

/**
 * Cross-encoder reranker backed by BAAI/bge-reranker-v2-m3 via a local HTTP sidecar.
 * Much faster and more accurate than LLM reranking (~50ms vs ~2-3s per call).
 * Start the sidecar with: docker compose up bge-reranker
 */
export class BgeReranker implements Reranker {
	readonly #url: string;

	constructor(options: BgeRerankerOptions) {
		this.#url = options.url.replace(/\/+$/, "");
	}

	async rerank(
		query: string,
		candidates: RerankCandidate[],
		options?: { topN?: number; signal?: AbortSignal },
	): Promise<RerankResult[]> {
		if (candidates.length === 0) return [];
		options?.signal?.throwIfAborted();

		const response = await fetch(`${this.#url}/rerank`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				candidates,
				top_n: options?.topN,
			}),
			signal: options?.signal,
		});

		if (!response.ok) {
			throw new Error(`BGE rerank failed: ${response.status} ${await response.text()}`);
		}

		const data = (await response.json()) as { results?: Array<{ id: string; score: number }> };
		return (data.results ?? []).map((r) => ({ id: r.id, score: r.score }));
	}
}
