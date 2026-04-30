/**
 * Per-substage usage + cost aggregator. Maintainer-only.
 *
 * Receives `LlmUsage` events from instrumented LLM components, looks
 * pricing up by request model id, and produces a per-substage record
 * with totals + a top-level `costComparable` flag.
 *
 * Comparability rule: `costComparable.value = false` whenever any
 * recorded call has unknown pricing or missing token counts. The reason
 * list keeps the offending model ids so a maintainer can fix the
 * pricing table or wire usage capture without grepping the report.
 */

import type { LlmUsage } from "./llm-usage.js";
import { computeCost } from "./pricing.js";

export interface SubstageCostStats {
	callCount: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost_usd: number | null;
	requestModels: string[];
	providerResponseModels: string[];
	/** Set when at least one call had model-id drift (request != response). */
	modelDriftDetected: boolean;
}

export interface CostComparability {
	value: boolean;
	reasons: string[];
}

export class CostAggregator {
	#substages: Map<string, LlmUsage[]> = new Map();
	#missing: Set<string> = new Set();

	record(substage: string, usage: LlmUsage): void {
		const list = this.#substages.get(substage);
		if (list) list.push(usage);
		else this.#substages.set(substage, [usage]);
	}

	stats(substage: string): SubstageCostStats {
		const list = this.#substages.get(substage) ?? [];
		let promptTokens = 0;
		let completionTokens = 0;
		let totalTokens = 0;
		let cost: number | null = 0;
		const reqModels = new Set<string>();
		const respModels = new Set<string>();
		let drift = false;
		for (const u of list) {
			promptTokens += u.promptTokens ?? 0;
			completionTokens += u.completionTokens ?? 0;
			totalTokens += u.totalTokens ?? 0;
			reqModels.add(u.requestModelId);
			if (u.providerResponseModelId) {
				respModels.add(u.providerResponseModelId);
				// Case-insensitive compare — providers freely re-case (e.g.
				// "baai/bge-base-en-v1.5" → "BAAI/bge-base-en-v1.5"). Real
				// drift (alias swap, A/B routing) survives lowercase.
				if (
					u.providerResponseModelId.toLowerCase() !== u.requestModelId.toLowerCase()
				) {
					drift = true;
				}
			}
			if (cost !== null) {
				const c = computeCost({
					modelId: u.requestModelId,
					promptTokens: u.promptTokens,
					completionTokens: u.completionTokens,
				});
				if (c.cost_usd === null) {
					cost = null;
					if (c.missing === "price") this.#missing.add(`unknown-price:${u.requestModelId}`);
					else if (c.missing === "tokens") {
						this.#missing.add(`missing-tokens:${u.requestModelId}`);
					}
				} else {
					cost += c.cost_usd;
				}
			}
		}
		return {
			callCount: list.length,
			promptTokens,
			completionTokens,
			totalTokens,
			cost_usd: cost,
			requestModels: [...reqModels].sort(),
			providerResponseModels: [...respModels].sort(),
			modelDriftDetected: drift,
		};
	}

	allStats(): Record<string, SubstageCostStats> {
		const out: Record<string, SubstageCostStats> = {};
		for (const key of this.#substages.keys()) out[key] = this.stats(key);
		return out;
	}

	/**
	 * Returns whether any cost in this report is rankable. False when any
	 * recorded call had unknown pricing OR missing token counts. The
	 * reasons list contains stable string ids (`unknown-price:<model>`,
	 * `missing-tokens:<model>`) for downstream code that wants to fail
	 * rank-by-cost on specific causes.
	 */
	comparability(): CostComparability {
		// Trigger missing population by computing all stats once.
		for (const key of this.#substages.keys()) this.stats(key);
		const reasons = [...this.#missing].sort();
		return { value: reasons.length === 0, reasons };
	}
}
