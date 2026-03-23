import type { Embedder, VectorIndex } from "@wtfoc/common";

export interface QueryOptions {
	topK?: number;
	minScore?: number;
	signal?: AbortSignal;
}

export interface QueryResult {
	query: string;
	results: Array<{
		content: string;
		sourceType: string;
		source: string;
		sourceUrl?: string;
		storageId: string;
		score: number;
	}>;
}

/**
 * Simple semantic search — embed query, find nearest chunks, return ranked.
 * No edge following (use trace() for that).
 */
export async function query(
	queryText: string,
	embedder: Embedder,
	vectorIndex: VectorIndex,
	options?: QueryOptions,
): Promise<QueryResult> {
	const topK = options?.topK ?? 10;
	const minScore = options?.minScore ?? 0.0;

	options?.signal?.throwIfAborted();

	const queryVector = await embedder.embed(queryText, options?.signal);
	const matches = await vectorIndex.search(queryVector, topK);

	return {
		query: queryText,
		results: matches
			.filter((m) => m.score >= minScore)
			.map((m) => ({
				content: m.entry.metadata["content"] ?? "",
				sourceType: m.entry.metadata["sourceType"] ?? "unknown",
				source: m.entry.metadata["source"] ?? "unknown",
				sourceUrl: m.entry.metadata["sourceUrl"],
				storageId: m.entry.storageId,
				score: m.score,
			})),
	};
}
