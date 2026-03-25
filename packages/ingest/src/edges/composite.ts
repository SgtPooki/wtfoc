import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";
import { mergeEdges } from "./merge.js";

const MAX_EDGES_PER_CHUNK = 100;

interface ExtractorRegistration {
	name: string;
	extractor: EdgeExtractor;
	enabled: boolean;
}

/**
 * Composite edge extractor that orchestrates multiple sub-extractors,
 * merges their results, deduplicates by canonical key, and calibrates
 * confidence with provenance tracking.
 */
export class CompositeEdgeExtractor implements EdgeExtractor {
	readonly #extractors: ExtractorRegistration[] = [];
	readonly #names = new Set<string>();
	#onError?: (extractorName: string, error: unknown) => void;

	/**
	 * Set an optional error handler for extractor failures.
	 * If not set, failures are logged to stderr.
	 */
	set onError(handler: (extractorName: string, error: unknown) => void) {
		this.#onError = handler;
	}

	register(registration: { name: string; extractor: EdgeExtractor; enabled?: boolean }): void {
		if (this.#names.has(registration.name)) {
			throw new Error(`Duplicate extractor name: "${registration.name}"`);
		}
		this.#names.add(registration.name);
		this.#extractors.push({
			name: registration.name,
			extractor: registration.extractor,
			enabled: registration.enabled ?? true,
		});
	}

	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		const enabled = this.#extractors.filter((r) => r.enabled);
		if (enabled.length === 0) return [];

		// Run all enabled extractors in parallel
		const results = await Promise.all(
			enabled.map(async (reg) => {
				signal?.throwIfAborted();
				try {
					const edges = await reg.extractor.extract(chunks, signal);
					return { extractorName: reg.name, edges };
				} catch (err) {
					if (err instanceof DOMException && err.name === "AbortError") throw err;
					if (signal?.aborted) throw signal.reason;
					// Fail-open: report via handler or stderr
					if (this.#onError) {
						this.#onError(reg.name, err);
					} else {
						console.error(`[wtfoc] Edge extractor "${reg.name}" failed:`, err);
					}
					return { extractorName: reg.name, edges: [] as Edge[] };
				}
			}),
		);

		const merged = mergeEdges(results);

		// Cap edges per chunk to prevent memory exhaustion
		if (merged.length > chunks.length * MAX_EDGES_PER_CHUNK) {
			return merged.slice(0, chunks.length * MAX_EDGES_PER_CHUNK);
		}

		return merged;
	}
}
