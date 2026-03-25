import type { Embedder, VectorIndex } from "@wtfoc/common";

export interface QueryOptions {
	topK?: number;
	minScore?: number;
	signal?: AbortSignal;
	/** When set, boost results that have high scores for this signal type */
	signalFilter?: string;
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
		signalScores?: Record<string, number>;
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

	const signalFilter = options?.signalFilter;

	const queryVector = await embedder.embed(queryText, options?.signal);
	// Fetch extra results when signal filtering so we have enough after re-ranking
	const fetchK = signalFilter ? topK * 3 : topK;
	const matches = await vectorIndex.search(queryVector, fetchK);

	let results = matches
		.filter((m) => m.score >= minScore)
		.map((m) => {
			const signalScoresRaw = m.entry.metadata.signalScores;
			const signalScores: Record<string, number> | undefined = signalScoresRaw
				? (JSON.parse(signalScoresRaw) as Record<string, number>)
				: undefined;

			let boostedScore = m.score;
			if (signalFilter && signalScores) {
				const signalValue = signalScores[signalFilter] ?? 0;
				// Boost: up to 20% increase for max signal score
				boostedScore = m.score * (1 + (signalValue / 100) * 0.2);
			}

			return {
				content: m.entry.metadata.content ?? "",
				sourceType: m.entry.metadata.sourceType ?? "unknown",
				source: m.entry.metadata.source ?? "unknown",
				sourceUrl: m.entry.metadata.sourceUrl,
				storageId: m.entry.storageId,
				score: boostedScore,
				signalScores,
			};
		});

	if (signalFilter) {
		results.sort((a, b) => b.score - a.score);
	}
	results = results.slice(0, topK);

	return {
		query: queryText,
		results,
	};
}
