import type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";

export interface LlmRerankerOptions {
	/** Base URL of an OpenAI-compatible endpoint, e.g. http://localhost:4523/v1 */
	baseUrl: string;
	/** Model name to use for scoring, e.g. "haiku" */
	model: string;
	/** Optional API key (sent as Bearer token) */
	apiKey?: string;
	/**
	 * Optional per-call telemetry hook. Maintainer-only: dogfood and the
	 * autoresearch sweep harness pass a sink to capture token usage and
	 * call duration. Consumers leave this unset.
	 */
	usageSink?: (usage: {
		requestModelId: string;
		providerResponseModelId?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		durationMs: number;
	}) => void;
}

const SYSTEM_PROMPT = `You are a relevance scoring assistant. Given a search query and a list of candidate documents, score each candidate's relevance to the query on a scale of 0.0 to 1.0.

Respond ONLY with a JSON array in this exact format, with no other text:
[{"id": "<candidate id>", "score": <0.0-1.0>}, ...]

Score 1.0 = perfectly relevant, 0.0 = completely irrelevant.`;

/**
 * LLM-based reranker using an OpenAI-compatible chat completions endpoint.
 * Slower than a cross-encoder (~2-3s per call) but requires no additional infrastructure.
 * Useful for comparison against bge-reranker; cross-encoders typically outperform LLM rerankers.
 */
export class LlmReranker implements Reranker {
	readonly #baseUrl: string;
	readonly #model: string;
	readonly #apiKey: string | undefined;
	readonly #usageSink: LlmRerankerOptions["usageSink"];

	constructor(options: LlmRerankerOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.#model = options.model;
		this.#apiKey = options.apiKey;
		this.#usageSink = options.usageSink;
	}

	async rerank(
		query: string,
		candidates: RerankCandidate[],
		options?: { topN?: number; signal?: AbortSignal },
	): Promise<RerankResult[]> {
		if (candidates.length === 0) return [];
		options?.signal?.throwIfAborted();

		// Per-candidate context window: 2000 chars (~500 tokens). Up from
		// the original 400 chars (~80 tokens) — Phase 3 audit found the
		// 400-char window left the reranker LESS-informed than the
		// embedder it was meant to refine, since bge-base-en-v1.5
		// embeds the full ~512-token chunk while the reranker was
		// scoring on the first 100 tokens. See
		// `docs/autoresearch/audits/2026-04-30-rerank-pipeline-collapse.md`.
		const PER_CANDIDATE_CHAR_LIMIT = 2000;
		const userMessage = [
			`Query: ${query}`,
			"",
			"Candidates:",
			...candidates.map(
				(c, i) => `[${i + 1}] id="${c.id}"\n${c.text.slice(0, PER_CANDIDATE_CHAR_LIMIT)}`,
			),
		].join("\n");

		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;

		const callStart = performance.now();
		const response = await fetch(`${this.#baseUrl}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: this.#model,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: userMessage },
				],
				temperature: 0,
				max_tokens: candidates.length * 30 + 50,
			}),
			signal: options?.signal,
		});

		if (!response.ok) {
			throw new Error(`LLM rerank failed: ${response.status} ${await response.text()}`);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
			usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
			model?: string;
		};
		const content = data.choices?.[0]?.message?.content ?? "";

		if (this.#usageSink) {
			this.#usageSink({
				requestModelId: this.#model,
				providerResponseModelId: data.model,
				promptTokens: data.usage?.prompt_tokens,
				completionTokens: data.usage?.completion_tokens,
				totalTokens: data.usage?.total_tokens,
				durationMs: performance.now() - callStart,
			});
		}

		let scored: RerankResult[] = this.#parseScores(content, candidates);

		// Sort descending by score
		scored = scored.sort((a, b) => b.score - a.score);

		return options?.topN != null ? scored.slice(0, options.topN) : scored;
	}

	#parseScores(content: string, candidates: RerankCandidate[]): RerankResult[] {
		try {
			// Extract JSON array from response (LLM may wrap it in markdown)
			const match = content.match(/\[[\s\S]*\]/);
			if (!match) throw new Error("no JSON array found");
			const parsed = JSON.parse(match[0]) as Array<{ id?: string; score?: number }>;

			const validIds = new Set(candidates.map((c) => c.id));
			const results = parsed
				.filter(
					(item): item is { id: string; score: number } =>
						typeof item.id === "string" && validIds.has(item.id) && typeof item.score === "number",
				)
				.map((item) => ({ id: item.id, score: item.score }));

			// Only return if we got scores for at least one candidate
			if (results.length > 0) return results;
		} catch {
			// Fall through to fallback
		}

		// Fallback: preserve original order with descending scores
		return candidates.map((c, i) => ({ id: c.id, score: candidates.length - i }));
	}
}
