/**
 * Per-million-token USD pricing for known models. Maintainer-only.
 *
 * Enforces "comparable units across providers, or refuse to rank by cost"
 * (peer-review consensus). When a model is missing from the table, cost
 * is reported as `null` and `costComparable.value` becomes `false` with
 * the offending model id in `reasons`. Downstream consumers (threshold
 * check, future sweep harness) refuse to rank by cost when comparable
 * is false.
 *
 * Local / proxied / free-of-charge models are pinned to 0 explicitly so
 * they participate in comparability without distorting cost ranking.
 */

export interface ModelPrice {
	/** USD per 1M prompt tokens. */
	promptPerMillion: number;
	/** USD per 1M completion tokens. Optional — embedders have no completion. */
	completionPerMillion?: number;
	/** Free-text source of the rate (e.g. dated provider docs). */
	source: string;
}

const PRICES: Record<string, ModelPrice> = {
	// OpenAI embedders — public list price as of 2026-04.
	"text-embedding-3-small": { promptPerMillion: 0.02, source: "openai 2026-04" },
	"text-embedding-3-large": { promptPerMillion: 0.13, source: "openai 2026-04" },
	"text-embedding-ada-002": { promptPerMillion: 0.1, source: "openai 2026-04" },

	// OpenRouter open-weight embedders — passthrough free tier (we pay $0).
	"baai/bge-base-en-v1.5": { promptPerMillion: 0, source: "openrouter free 2026-04" },
	"baai/bge-large-en-v1.5": { promptPerMillion: 0, source: "openrouter free 2026-04" },

	// Local proxy / vllm / ollama — pinned to zero (we pay no per-token cost).
	haiku: { promptPerMillion: 0, completionPerMillion: 0, source: "local claude-direct-proxy" },
	"qwen3.6-27b": { promptPerMillion: 0, completionPerMillion: 0, source: "local vllm" },
	"qwen3.6:27b-nvfp4": { promptPerMillion: 0, completionPerMillion: 0, source: "local ollama" },
};

export function lookupPrice(modelId: string): ModelPrice | null {
	return PRICES[modelId] ?? null;
}

export function knownModelIds(): string[] {
	return Object.keys(PRICES).sort();
}

export interface CostInputs {
	modelId: string;
	promptTokens?: number;
	completionTokens?: number;
}

export interface CostResult {
	cost_usd: number | null;
	missing: "price" | "tokens" | null;
}

/**
 * Compute USD cost for a single call. Returns `cost_usd: null` and a
 * `missing` reason when the price table or token counts are incomplete.
 * Callers must surface missing as a comparability reason — never invent
 * a cost.
 */
export function computeCost(input: CostInputs): CostResult {
	const price = lookupPrice(input.modelId);
	if (!price) return { cost_usd: null, missing: "price" };
	if (typeof input.promptTokens !== "number") {
		return { cost_usd: null, missing: "tokens" };
	}
	const promptCost = (input.promptTokens / 1_000_000) * price.promptPerMillion;
	const completion = input.completionTokens ?? 0;
	const completionRate = price.completionPerMillion ?? 0;
	const completionCost = (completion / 1_000_000) * completionRate;
	return { cost_usd: promptCost + completionCost, missing: null };
}
