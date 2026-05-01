/**
 * Live `RetrieveTopK` adapter for the adversarial filter (#344 step 2e).
 *
 * `applyAdversarialFilter` discards candidate queries whose `required:true`
 * artifact already appears in plain vector search top-K — those queries
 * don't exercise the trace engine and are too easy. This module wraps the
 * production `query()` from `@wtfoc/search` so the filter can run against
 * a real mounted corpus.
 *
 * `query()` returns hits with `storageId` (chunk-level) but the recipe's
 * artifact identity is `documentId` (artifact-level). The adapter builds a
 * `Map<storageId, documentId>` from the corpus segments at construction
 * time so post-query lookup is O(1).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import type { Embedder, Segment, VectorIndex } from "@wtfoc/common";
import { type RetrieveTopK, query } from "@wtfoc/search";

export interface BuildLiveRetrieverOptions {
	embedder: Embedder;
	vectorIndex: VectorIndex;
	segments: ReadonlyArray<Segment>;
}

/**
 * Build a `Map<storageId, documentId>` from the segments. Chunks without a
 * `documentId` are skipped — the adversarial filter cannot key against
 * them.
 */
export function buildStorageToDocMap(
	segments: ReadonlyArray<Segment>,
): Map<string, string> {
	const out = new Map<string, string>();
	for (const seg of segments) {
		for (const c of seg.chunks) {
			if (!c.documentId) continue;
			out.set(c.storageId, c.documentId);
		}
	}
	return out;
}

/**
 * Construct a `RetrieveTopK` over a mounted corpus. The returned function
 * is stable: subsequent calls share the storage→document map and the
 * embedder/vectorIndex references.
 */
export function buildLiveRetriever(
	opts: BuildLiveRetrieverOptions,
): RetrieveTopK {
	const storageToDoc = buildStorageToDocMap(opts.segments);
	return async (queryText: string, k: number) => {
		const result = await query(queryText, opts.embedder, opts.vectorIndex, { topK: k });
		const out: Array<{ artifactId: string }> = [];
		for (const r of result.results) {
			const documentId = storageToDoc.get(r.storageId);
			if (documentId) out.push({ artifactId: documentId });
		}
		return out;
	};
}
