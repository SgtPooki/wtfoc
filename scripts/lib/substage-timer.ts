/**
 * Per-substage latency accumulator. Records call durations and emits
 * count + total + p50 + p95 per substage. Maintainer-only.
 *
 * Phase 0a captures these substages within the quality-queries stage:
 *   embed-call: every embedder.embed/.embedBatch call
 *   vector-retrieve: every vectorIndex.search call
 *   rerank: every reranker.rerank call
 *   per-query-total: end-to-end per-query duration via evaluator hook
 *
 * Synthesis + grader substages will plug in via the same interface
 * when 0f lands.
 */

export interface SubstageStats {
	callCount: number;
	totalMs: number;
	p50Ms: number;
	p95Ms: number;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0] ?? 0;
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo] ?? 0;
	const loVal = sorted[lo] ?? 0;
	const hiVal = sorted[hi] ?? 0;
	return loVal + (hiVal - loVal) * (idx - lo);
}

export class SubstageTimer {
	#durations: Map<string, number[]> = new Map();

	record(substage: string, durationMs: number): void {
		const list = this.#durations.get(substage);
		if (list) list.push(durationMs);
		else this.#durations.set(substage, [durationMs]);
	}

	stats(substage: string): SubstageStats {
		const list = this.#durations.get(substage) ?? [];
		const sorted = [...list].sort((a, b) => a - b);
		const total = sorted.reduce((acc, v) => acc + v, 0);
		return {
			callCount: sorted.length,
			totalMs: Math.round(total),
			p50Ms: Math.round(percentile(sorted, 50)),
			p95Ms: Math.round(percentile(sorted, 95)),
		};
	}

	allStats(): Record<string, SubstageStats> {
		const out: Record<string, SubstageStats> = {};
		for (const key of this.#durations.keys()) out[key] = this.stats(key);
		return out;
	}

	substages(): string[] {
		return [...this.#durations.keys()].sort();
	}
}
