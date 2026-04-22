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
	/**
	 * Per-source-type score multipliers. Applied AFTER vector similarity and
	 * reranker, BEFORE the final topK slice. Unlike include/exclude filters,
	 * boosting never drops results — it just reorders the top-k. Missing
	 * source types default to 1.0. (#265)
	 *
	 * Example: `{ "code": 1.3, "doc-page": 0.5 }` pushes code up and doc-page
	 * down without ever removing a genuinely-great doc-page result if its
	 * raw score is high enough to survive the multiplier.
	 */
	sourceTypeBoosts?: Record<string, number>;
	/**
	 * Per-chunk-level score multipliers, keyed by `metadata.chunkLevel`.
	 * Applied the same way as `sourceTypeBoosts` — soft reordering, never
	 * drops. Missing levels default to 1.0. (#287)
	 *
	 * Example: `{ "file": 1.4 }` boosts file-level summary chunks emitted by
	 * `HierarchicalCodeChunker` so abstract/file-scoped queries surface them
	 * above rich prose chunks. Symbol-level chunks (no `chunkLevel` tag) are
	 * unaffected.
	 */
	chunkLevelBoosts?: Record<string, number>;
	/**
	 * Enforce source-type diversity in the returned top-K (#161). When set,
	 * after scoring + boosting, reserve one slot for the best candidate of
	 * each distinct source type whose best-candidate score meets the floor
	 * (`bestScoreOfType >= topScore * minScoreRatio`). Remaining slots fill
	 * by score. Prevents a single over-represented type (slack, doc-page,
	 * etc.) from monopolizing top-K after boosts compress the score band.
	 *
	 * Default off — does not activate unless this option is set. The floor
	 * guards against surfacing weak candidates just to satisfy diversity.
	 */
	diversityEnforce?: {
		/**
		 * Minimum score ratio (0–1) a type's best candidate must meet relative
		 * to the overall top score to get a reserved slot. Default 0.65.
		 */
		minScoreRatio?: number;
	};
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
	/**
	 * Observability (#265): populated only when sourceTypeBoosts is set.
	 * Codex review flagged "type hijacking" and "silent misrouting" as risks
	 * — this surfaces what actually happened so callers can detect drift.
	 */
	diagnostics?: {
		/** source-type counts in the fetched candidate set (pre-boost, pre-topK) */
		candidateTypeCounts: Record<string, number>;
		/** source-type counts in the returned topK (post-boost, post-slice) */
		returnedTypeCounts: Record<string, number>;
		/** types boosted (value != 1.0) */
		boostedTypes: string[];
		/** chunk-level counts in the fetched candidate set (#287) */
		candidateChunkLevelCounts?: Record<string, number>;
		/** chunk-level counts in the returned topK (#287) */
		returnedChunkLevelCounts?: Record<string, number>;
		/** chunk levels boosted (value != 1.0) (#287) */
		boostedChunkLevels?: string[];
		/**
		 * Source types that got a reserved slot via `diversityEnforce` (#161).
		 * Empty/absent means either diversity was off or no type needed
		 * promotion beyond score-order.
		 */
		diversityReservedTypes?: string[];
	};
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
	// Source-type boost needs a wider fan-out because a dominant source type can
	// fill the raw top-k entirely — without more candidates, the boost just
	// uniformly scales a single-type result set and re-sort does nothing (#265).
	if (options?.sourceTypeBoosts && Object.keys(options.sourceTypeBoosts).length > 0) {
		fetchK = Math.max(fetchK, topK * 10);
	}
	// Chunk-level boost needs the same wider fan-out as sourceTypeBoosts: file
	// summary chunks are ~1/11 of code chunks, so a narrow top-k may contain
	// zero candidates for the boost to reorder. (#287)
	if (options?.chunkLevelBoosts && Object.keys(options.chunkLevelBoosts).length > 0) {
		fetchK = Math.max(fetchK, topK * 10);
	}
	if (includeSet || excludeSet) fetchK = Math.max(fetchK, topK * 10);
	// Diversity reservation needs a wide candidate pool — if fetchK ~= topK,
	// dominant types fill the entire fetched set and diversity has no long
	// tail to pull a reserved candidate from (#161).
	if (options?.diversityEnforce) fetchK = Math.max(fetchK, topK * 10);
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
			// Source-type boost (#265) — soft routing, never drops
			if (options?.sourceTypeBoosts) {
				const sourceType = m.entry.metadata.sourceType ?? "unknown";
				const typeBoost = options.sourceTypeBoosts[sourceType] ?? 1.0;
				if (typeBoost !== 1.0) boostedScore = boostedScore * typeBoost;
			}
			// Chunk-level boost (#287) — soft routing on chunkLevel metadata
			if (options?.chunkLevelBoosts) {
				const level = m.entry.metadata.chunkLevel ?? "symbol";
				const levelBoost = options.chunkLevelBoosts[level] ?? 1.0;
				if (levelBoost !== 1.0) boostedScore = boostedScore * levelBoost;
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

	if (signalFilter || rerankedScores || options?.sourceTypeBoosts || options?.chunkLevelBoosts) {
		results.sort((a, b) => b.score - a.score);
	}

	// Diversity-enforcing top-K (#161). Applied AFTER all scoring but BEFORE
	// slicing. Reserves one slot per source-type whose best candidate
	// meets the floor, then fills remaining topK slots by score. Guards
	// against a dominant source type monopolizing top-K after boost
	// compression — slack-heavy corpora triggered this on v12 for queries
	// where required cross-source evidence was available but ranked below
	// a slack flood.
	let diversityReservedTypes: string[] | undefined;
	if (options?.diversityEnforce && results.length > 0) {
		const { minScoreRatio = 0.65 } = options.diversityEnforce;
		const topScore = results[0]?.score ?? 0;
		const floor = topScore * minScoreRatio;

		const bestPerType = new Map<string, (typeof results)[number]>();
		for (const r of results) {
			if (!bestPerType.has(r.sourceType) && r.score >= floor) {
				bestPerType.set(r.sourceType, r);
			}
		}

		const reserved = [...bestPerType.values()].sort((a, b) => b.score - a.score).slice(0, topK);
		const reservedIds = new Set(reserved.map((r) => r.storageId));

		if (reserved.length > 0 && reserved.length <= topK) {
			const filler = results
				.filter((r) => !reservedIds.has(r.storageId))
				.slice(0, topK - reserved.length);
			const merged = [...reserved, ...filler].sort((a, b) => b.score - a.score);
			// Only mark types as "reserved" when the rescue actually changed
			// top-K membership vs pure score order. A pure-score top-K that
			// already had diversity needs no diagnostic entry.
			const pureScoreTopIds = new Set(results.slice(0, topK).map((r) => r.storageId));
			const promotedIds = reservedIds.size
				? [...reservedIds].filter((id) => !pureScoreTopIds.has(id))
				: [];
			if (promotedIds.length > 0) {
				diversityReservedTypes = reserved
					.filter((r) => promotedIds.includes(r.storageId))
					.map((r) => r.sourceType);
			}
			results = merged;
		}
	}

	// Diagnostics (#265 + #287 telemetry) — compute counts BEFORE slicing so we
	// can compare candidate distribution vs what actually made it into topK.
	const hasTypeBoosts =
		options?.sourceTypeBoosts && Object.keys(options.sourceTypeBoosts).length > 0;
	const hasChunkLevelBoosts =
		options?.chunkLevelBoosts && Object.keys(options.chunkLevelBoosts).length > 0;
	const hasDiversity = Boolean(options?.diversityEnforce);
	const diagnostics =
		hasTypeBoosts || hasChunkLevelBoosts || hasDiversity
			? (() => {
					const chunkLevelByStorageId = new Map<string, string>();
					for (const m of matches) {
						const level = m.entry.metadata.chunkLevel ?? "symbol";
						chunkLevelByStorageId.set(m.entry.storageId, level);
					}
					const candidateTypeCounts: Record<string, number> = {};
					const candidateChunkLevelCounts: Record<string, number> = {};
					for (const r of results) {
						candidateTypeCounts[r.sourceType] = (candidateTypeCounts[r.sourceType] ?? 0) + 1;
						const level = chunkLevelByStorageId.get(r.storageId) ?? "symbol";
						candidateChunkLevelCounts[level] = (candidateChunkLevelCounts[level] ?? 0) + 1;
					}
					const sliced = results.slice(0, topK);
					const returnedTypeCounts: Record<string, number> = {};
					const returnedChunkLevelCounts: Record<string, number> = {};
					for (const r of sliced) {
						returnedTypeCounts[r.sourceType] = (returnedTypeCounts[r.sourceType] ?? 0) + 1;
						const level = chunkLevelByStorageId.get(r.storageId) ?? "symbol";
						returnedChunkLevelCounts[level] = (returnedChunkLevelCounts[level] ?? 0) + 1;
					}
					const boostedTypes = Object.entries(options?.sourceTypeBoosts ?? {})
						.filter(([, v]) => v !== 1.0)
						.map(([k]) => k);
					const boostedChunkLevels = Object.entries(options?.chunkLevelBoosts ?? {})
						.filter(([, v]) => v !== 1.0)
						.map(([k]) => k);
					return {
						candidateTypeCounts,
						returnedTypeCounts,
						boostedTypes,
						...(diversityReservedTypes ? { diversityReservedTypes } : {}),
						...(hasChunkLevelBoosts
							? {
									candidateChunkLevelCounts,
									returnedChunkLevelCounts,
									boostedChunkLevels,
								}
							: {}),
					};
				})()
			: undefined;

	results = results.slice(0, topK);

	return {
		query: queryText,
		results,
		...(diagnostics ? { diagnostics } : {}),
	};
}
