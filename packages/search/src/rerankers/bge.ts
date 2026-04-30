import type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";

export interface BgeRerankerOptions {
	/** Base URL of the bge-reranker sidecar, e.g. http://localhost:8385 */
	url: string;
}

/**
 * Cross-encoder reranker speaking the {query, candidates, top_n} → {results}
 * protocol. Compatible with the wtfoc-shipped local sidecar (BAAI/bge-reranker-v2-m3
 * by default, see `services/bge-reranker/`) AND any other server implementing
 * the same contract. Much faster than LLM reranking when GPU-accelerated;
 * the local sidecar runs natively on host so PyTorch can use Metal/CUDA.
 *
 * Start the local sidecar with: `./services/bge-reranker/run-native.sh`.
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
