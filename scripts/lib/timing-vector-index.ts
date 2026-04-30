/**
 * Pass-through `VectorIndex` decorator that records search latency.
 * Maintainer-only — used by dogfood to capture the `vector-retrieve`
 * substage without modifying the runtime evaluator.
 */

import type { ScoredEntry, VectorEntry, VectorIndex } from "@wtfoc/common";

export class TimingVectorIndex implements VectorIndex {
	readonly #inner: VectorIndex;
	readonly #onSearch: (durationMs: number) => void;

	constructor(inner: VectorIndex, onSearch: (durationMs: number) => void) {
		this.#inner = inner;
		this.#onSearch = onSearch;
	}

	add(entries: VectorEntry[]): Promise<void> {
		return this.#inner.add(entries);
	}

	async search(query: Float32Array, topK: number): Promise<ScoredEntry[]> {
		const t0 = performance.now();
		try {
			return await this.#inner.search(query, topK);
		} finally {
			this.#onSearch(performance.now() - t0);
		}
	}

	delete(ids: string[]): Promise<void> {
		return this.#inner.delete(ids);
	}

	get size(): number {
		return this.#inner.size;
	}
}
