import type { Embedder, Reranker, VectorIndex } from "@wtfoc/common";

export interface QueryOptions {
	topK?: number;
	minScore?: number;
	signal?: AbortSignal;
	/** When set, boost results that have high scores for this signal type */
	signalFilter?: string;
	/** Optional reranker applied after vector retrieval and before final slicing. */
	reranker?: Reranker;
	/**
	 * When set, restrict results to chunks whose sourceType is in this list.
	 * Empty array is treated as "no filter" (same as undefined). Applied after
	 * vector retrieval, before topK slicing, so topK reflects the filtered set.
	 * (#256)
	 */
	includeSourceTypes?: string[];
	/**
	 * When set, drop results whose sourceType is in this list. Applied after
	 * includeSourceTypes so a type in both sets is excluded. (#256)
	 */
	excludeSourceTypes?: string[];
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
	const reranker = options?.reranker;

	// Source-type filters (#256) — build sets once, applied after vector retrieval
	// but before reranking so we don't pay reranker cost on excluded candidates.
	const includeSet =
		options?.includeSourceTypes && options.includeSourceTypes.length > 0
			? new Set(options.includeSourceTypes)
			: null;
	const excludeSet =
		options?.excludeSourceTypes && options.excludeSourceTypes.length > 0
			? new Set(options.excludeSourceTypes)
			: null;
	const passesSourceFilter = (sourceType: string): boolean => {
		if (includeSet && !includeSet.has(sourceType)) return false;
		if (excludeSet?.has(sourceType)) return false;
		return true;
	};

	const queryVector = await embedder.embed(queryText, options?.signal);
	// Fetch extra results when post-search ranking may discard or reorder candidates,
	// or when source-type filters may drop matches. Source-type filters need a
	// larger fan-out than reranker because a dominant source type can occupy the
	// entire shallow top-k — dogfood hit this when doc-page chunks filled the top
	// 15 for a "discussions" query and the include filter dropped everything.
	let fetchK = topK;
	if (signalFilter || reranker) fetchK = Math.max(fetchK, topK * 3);
	if (includeSet || excludeSet) fetchK = Math.max(fetchK, topK * 10);
	const rawMatches = await vectorIndex.search(queryVector, fetchK);
	// Apply source-type filters before reranker runs (save compute) and before topK slicing.
	const matches =
		includeSet || excludeSet
			? rawMatches.filter((m) => passesSourceFilter(m.entry.metadata.sourceType ?? "unknown"))
			: rawMatches;
	let rerankedScores: Map<string, number> | undefined;

	if (reranker && matches.length > 0) {
		options?.signal?.throwIfAborted();
		const reranked = await reranker.rerank(
			queryText,
			matches.map((match) => ({
				id: match.entry.storageId,
				text: match.entry.metadata.content ?? "",
			})),
			{ topN: topK, signal: options?.signal },
		);
		if (reranked.length > 0) {
			rerankedScores = new Map(reranked.map((result) => [result.id, result.score]));
		}
	}

	let results = matches
		.filter((m) => {
			if (rerankedScores) {
				return rerankedScores.has(m.entry.storageId);
			}
			return m.score >= minScore;
		})
		.map((m) => {
			const signalScoresRaw = m.entry.metadata.signalScores;
			const signalScores: Record<string, number> | undefined = signalScoresRaw
				? (JSON.parse(signalScoresRaw) as Record<string, number>)
				: undefined;

			let boostedScore = rerankedScores?.get(m.entry.storageId) ?? m.score;
			if (signalFilter && signalScores) {
				const signalValue = signalScores[signalFilter] ?? 0;
				// Boost: up to 20% increase for max signal score
				boostedScore = boostedScore * (1 + (signalValue / 100) * 0.2);
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

	if (signalFilter || rerankedScores) {
		results.sort((a, b) => b.score - a.score);
	}
	results = results.slice(0, topK);

	return {
		query: queryText,
		results,
	};
}
