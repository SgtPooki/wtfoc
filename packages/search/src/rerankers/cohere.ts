import type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";

export interface CohereRerankerOptions {
	apiKey: string;
	model?: string;
	baseUrl?: string;
}

export class CohereReranker implements Reranker {
	readonly #apiKey: string;
	readonly #model: string;
	readonly #baseUrl: string;

	constructor(options: CohereRerankerOptions) {
		if (!options.apiKey) {
			throw new Error("Cohere API key is required");
		}
		this.#apiKey = options.apiKey;
		this.#model = options.model ?? "rerank-v3.5";
		this.#baseUrl = options.baseUrl ?? "https://api.cohere.com/v2";
	}

	async rerank(
		query: string,
		candidates: RerankCandidate[],
		options?: { topN?: number; signal?: AbortSignal },
	): Promise<RerankResult[]> {
		if (candidates.length === 0) return [];
		options?.signal?.throwIfAborted();

		const response = await fetch(`${this.#baseUrl.replace(/\/$/, "")}/rerank`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.#model,
				query,
				documents: candidates.map((candidate) => candidate.text),
				top_n: options?.topN ?? candidates.length,
				return_documents: false,
			}),
			signal: options?.signal,
		});

		if (!response.ok) {
			throw new Error(`Cohere rerank failed: ${response.status} ${await response.text()}`);
		}

		const data = (await response.json()) as {
			results?: Array<{ index: number; relevance_score: number }>;
		};
		const results = data.results ?? [];
		return results
			.map((result) => {
				const candidate = candidates[result.index];
				if (!candidate) return undefined;
				return { id: candidate.id, score: result.relevance_score };
			})
			.filter((result): result is RerankResult => result !== undefined);
	}
}
