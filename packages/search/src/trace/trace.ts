import type { Embedder, Reranker, Segment, TimestampKind, VectorIndex } from "@wtfoc/common";
import { buildChronologicalHopIndices } from "./chronology.js";
import { buildConclusion, type TraceConclusion } from "./conclusion.js";
import { buildChunkIndexes, buildEdgeIndex } from "./indexing.js";
import { detectInsights, type TraceInsight } from "./insights.js";
import { buildLineageChains, type LineageChain } from "./lineage.js";
import { followEdges } from "./traversal.js";

export type TraceMode = "discovery" | "analytical";
export type TraceView = "lineage" | "timeline" | "evidence";

/**
 * Select `limit` seeds with source-type diversity. Reserves one slot per
 * source type whose best-score seed meets `topScore * minScoreRatio`, then
 * fills remaining slots by score. Returns seeds in score-desc order.
 */
function applySeedDiversity(
	scored: import("@wtfoc/common").ScoredEntry[],
	limit: number,
	minScoreRatio: number,
): import("@wtfoc/common").ScoredEntry[] {
	if (scored.length === 0 || limit <= 0) return [];
	const topScore = scored[0]?.score ?? 0;
	const floor = topScore * minScoreRatio;
	const bestPerType = new Map<string, import("@wtfoc/common").ScoredEntry>();
	for (const s of scored) {
		const t = s.entry.metadata.sourceType ?? "unknown";
		if (!bestPerType.has(t) && s.score >= floor) bestPerType.set(t, s);
	}
	const reserved = [...bestPerType.values()].sort((a, b) => b.score - a.score).slice(0, limit);
	const reservedIds = new Set(reserved.map((s) => s.entry.id));
	const filler = scored
		.filter((s) => !reservedIds.has(s.entry.id))
		.slice(0, limit - reserved.length);
	return [...reserved, ...filler].sort((a, b) => b.score - a.score);
}

export interface TraceOptions {
	/** Max results per source type (default: 3) */
	maxPerSource?: number;
	/** Max total results (default: 15) */
	maxTotal?: number;
	/** Max edge hops to follow (default: 3) */
	maxHops?: number;
	/** Minimum similarity score for semantic fallback (default: 0.3) */
	minScore?: number;
	/** Source types to exclude from results (e.g. ["github-pr-comment"]) */
	excludeSourceTypes?: string[];
	/** Only include these source types in results */
	includeSourceTypes?: string[];
	/**
	 * Per-source-type score multipliers applied to seed scores (#265).
	 * Never drops — just reorders. Missing types default to 1.0. Prefer this
	 * over include/exclude for soft routing; hard filter only when you
	 * explicitly want to exclude a type.
	 */
	sourceTypeBoosts?: Record<string, number>;
	/**
	 * Per-chunk-level score multipliers applied to seed scores (#287). Keyed by
	 * `Chunk.metadata.chunkLevel` (e.g. `file` for summary chunks from
	 * `HierarchicalCodeChunker`; symbol chunks carry no level tag and are
	 * treated as `symbol`). Applied the same way as `sourceTypeBoosts` — soft
	 * reordering of seeds, never drops.
	 */
	chunkLevelBoosts?: Record<string, number>;
	/**
	 * Trace mode:
	 * - "discovery" (default): find connected results across sources
	 * - "analytical": also detect cross-source insights (convergence, evidence chains, temporal patterns)
	 */
	mode?: TraceMode;
	signal?: AbortSignal;
	/**
	 * Additional edges from an overlay (e.g. LLM-extracted via extract-edges).
	 * Merged into the edge index alongside segment-embedded edges.
	 */
	overlayEdges?: import("@wtfoc/common").Edge[];
	/** Optional reranker applied to initial seed candidates before traversal. */
	reranker?: Reranker;
	/**
	 * Enforce source-type diversity in seed selection (#161). Prevents a
	 * dominant source type (slack, doc-page) from monopolizing the seed
	 * set and starving the traversal of cross-source evidence. See
	 * `QueryOptions.diversityEnforce` for mechanics.
	 */
	diversityEnforce?: { minScoreRatio?: number };
}

export interface TraceHop {
	/** Chunk content (or snippet) */
	content: string;
	/** Source type: 'code', 'markdown', 'github-issue', etc. */
	sourceType: string;
	/** Source identifier */
	source: string;
	/** URL back to original (if available) */
	sourceUrl?: string;
	/** Storage ID for verification */
	storageId: string;
	/** Timestamp from the source chunk (ISO-8601, if available). See `timestampKind`. */
	timestamp?: string;
	/**
	 * Mirror of `Chunk.timestampKind` — which clock produced `timestamp`. Lets
	 * trace consumers interpret temporal relationships correctly when
	 * different source adapters report different semantics (`created`,
	 * `updated`, `committed`, ...). Undefined when the adapter did not record
	 * a kind. See `TimestampKind` in `@wtfoc/common`.
	 */
	timestampKind?: TimestampKind;
	/** Index of the hop that led to this one (undefined for seeds) */
	parentHopIndex?: number;
	/**
	 * Convenience mirror of this hop's position in `TraceResult.chronologicalHopIndices`.
	 * The permutation on `TraceResult` is canonical; this field is a lookup shortcut.
	 */
	chronologicalIndex?: number;
	/** How this hop was found */
	connection: {
		/** 'edge' if found via explicit edge, 'semantic' if via similarity */
		method: "edge" | "semantic";
		/** Edge type if found via edge */
		edgeType?: string;
		/** Evidence explaining the connection */
		evidence?: string;
		/** Confidence score */
		confidence: number;
		/**
		 * For `method === "edge"`: whether the indexed edge was walked in its
		 * original `sourceId → targetId` orientation (`forward`) or its flipped
		 * `targetId → sourceId` orientation (`reverse`). Lets consumers interpret
		 * `edgeType` semantics correctly — e.g. a `closes` edge walked forward
		 * (PR → issue) has opposite temporal expectations than the same edge
		 * walked reverse (issue → PR). Undefined for semantic hops. See #280.
		 */
		walkDirection?: "forward" | "reverse";
	};
}

export interface TraceResult {
	query: string;
	/** Results grouped by source type */
	groups: Record<string, TraceHop[]>;
	/** Flat list of all hops in traversal order (DFS edge walk + semantic fallback) */
	hops: TraceHop[];
	/**
	 * Permutation of `hops` indices ordered by timestamp ascending. Hops with no
	 * parseable timestamp are appended at the end in traversal order. Ties in
	 * timestamp break stably by traversal index.
	 *
	 * The canonical chronological view. `hops` retains traversal (evidence)
	 * order; this permutation lets timeline consumers (agents, `--view timeline`)
	 * read events chronologically without mutating the evidence walk. See #274.
	 */
	chronologicalHopIndices: number[];
	/** Lineage chains reconstructed from hop DFS tree (always populated) */
	lineageChains: LineageChain[];
	/** Agent-oriented conclusion block (only populated in analytical mode, omitted when no signal) */
	conclusion?: TraceConclusion;
	/** Cross-source insights (only populated in analytical mode) */
	insights: TraceInsight[];
	/** Summary of the trace */
	stats: {
		totalHops: number;
		edgeHops: number;
		semanticHops: number;
		sourceTypes: string[];
		insightCount: number;
	};
}

/**
 * Trace: the hero feature.
 *
 * 1. Embed the query
 * 2. Find seed chunks via vector search
 * 3. Follow explicit edges from seed chunks
 * 4. Fall back to semantic search for unconnected source types
 * 5. Group results by sourceType
 * 6. Annotate each hop with connection evidence
 */
export async function trace(
	query: string,
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	options?: TraceOptions,
): Promise<TraceResult> {
	const maxPerSource = options?.maxPerSource ?? 3;
	const maxTotal = options?.maxTotal ?? 15;
	const maxHops = options?.maxHops ?? 3;
	const minScore = options?.minScore ?? 0.3;
	const mode = options?.mode ?? "discovery";
	const excludeTypes = options?.excludeSourceTypes
		? new Set(options.excludeSourceTypes)
		: undefined;
	const includeTypes = options?.includeSourceTypes
		? new Set(options.includeSourceTypes)
		: undefined;
	const isAllowedType = (t: string) => {
		if (includeTypes) return includeTypes.has(t);
		if (excludeTypes) return !excludeTypes.has(t);
		return true;
	};

	options?.signal?.throwIfAborted();

	// Step 1: Embed query
	const queryVector = await embedder.embed(query, options?.signal);

	// Step 2: Find seed chunks via vector search.
	// Fan out wider when any boost is set — a dominant source type / chunk
	// level can otherwise fill the entire raw top-k and uniform scaling then
	// produces no effective reordering (#265, #287).
	const hasTypeBoosts =
		options?.sourceTypeBoosts && Object.keys(options.sourceTypeBoosts).length > 0;
	const hasLevelBoosts =
		options?.chunkLevelBoosts && Object.keys(options.chunkLevelBoosts).length > 0;
	const hasBoosts = hasTypeBoosts || hasLevelBoosts;
	const hasDiversity = Boolean(options?.diversityEnforce);
	const candidateMultiplier = options?.reranker ? 2 : hasBoosts || hasDiversity ? 5 : 1;
	const candidateCount = maxTotal * candidateMultiplier;
	const rawSeeds = await vectorIndex.search(queryVector, candidateCount);

	// Apply source-type + chunk-level boosts (#265, #287) — soft routing,
	// never drops seeds. Multiplicative composition so both axes can bias the
	// same seed; missing keys default to 1.0.
	const scoredSeeds = hasBoosts
		? rawSeeds
				.map((s): import("@wtfoc/common").ScoredEntry => {
					let boosted = s.score;
					if (hasTypeBoosts) {
						boosted *=
							(options?.sourceTypeBoosts as Record<string, number>)[
								s.entry.metadata.sourceType ?? "unknown"
							] ?? 1.0;
					}
					if (hasLevelBoosts) {
						boosted *=
							(options?.chunkLevelBoosts as Record<string, number>)[
								s.entry.metadata.chunkLevel ?? "symbol"
							] ?? 1.0;
					}
					return { entry: s.entry, score: boosted };
				})
				.sort((a, b) => b.score - a.score)
		: [...rawSeeds].sort((a, b) => b.score - a.score);

	const seedLimit = maxTotal * (options?.reranker ? 2 : 1);

	// Diversity-enforcing seed selection (#161). When enabled, reserve one
	// slot per source-type whose best seed meets the floor before filling
	// the rest by score. Prevents a dominant type (slack on v12) from
	// starving the traversal of cross-source evidence.
	const boostedSeeds = options?.diversityEnforce
		? applySeedDiversity(scoredSeeds, seedLimit, options.diversityEnforce.minScoreRatio ?? 0.65)
		: scoredSeeds.slice(0, seedLimit);

	const seeds = boostedSeeds;
	let effectiveSeeds = seeds;

	if (options?.reranker && seeds.length > 0) {
		options.signal?.throwIfAborted();
		// Do NOT pass `topN: maxTotal` — diversity-enforce already ran
		// at line 254 to produce a balanced `seeds` pool. Pre-trimming
		// the rerank output back to maxTotal undoes that diversity by
		// promoting same-source-type candidates that score highest on
		// pure relevance. See `docs/autoresearch/audits/2026-04-30-rerank-pipeline-collapse.md`.
		const reranked = await options.reranker.rerank(
			query,
			seeds.map((seed) => ({
				id: seed.entry.id,
				text: seed.entry.metadata.content ?? "",
			})),
			{ signal: options.signal },
		);
		if (reranked.length > 0) {
			const scoreMap = new Map<string, number>(reranked.map((r) => [r.id, r.score]));
			effectiveSeeds = seeds
				.filter((seed) => scoreMap.has(seed.entry.id))
				.map((seed): import("@wtfoc/common").ScoredEntry => ({
					entry: seed.entry,
					score: scoreMap.get(seed.entry.id) ?? seed.score,
				}))
				.sort((a, b) => b.score - a.score);
		}
	}

	// Build edge index from all segments + overlay edges
	const edgeIndex = buildEdgeIndex(segments, options?.overlayEdges);

	// Step 3: Follow edges from seeds + semantic fallback
	const visited = new Set<string>();
	const hops: TraceHop[] = [];

	// Build indexed chunk lookups for O(1) edge resolution
	const indexes = buildChunkIndexes(segments);

	for (const seed of effectiveSeeds) {
		if (seed.score < minScore) continue;
		if (visited.has(seed.entry.id)) continue;
		const seedType = seed.entry.metadata.sourceType ?? "unknown";
		if (!isAllowedType(seedType)) continue;

		options?.signal?.throwIfAborted();

		visited.add(seed.entry.id);

		// Add seed as a hop
		const chunkData = indexes.byId.get(seed.entry.id);
		const seedIndex = hops.length;
		hops.push({
			content: chunkData?.content ?? "",
			sourceType: seed.entry.metadata.sourceType ?? "unknown",
			source: seed.entry.metadata.source ?? "unknown",
			sourceUrl: seed.entry.metadata.sourceUrl,
			storageId: seed.entry.storageId,
			timestamp: chunkData?.timestamp,
			timestampKind: chunkData?.timestampKind,
			connection: {
				method: "semantic",
				confidence: seed.score,
			},
		});

		// Follow edges from this chunk
		followEdges(
			seed.entry.id,
			edgeIndex,
			indexes,
			visited,
			hops,
			0,
			maxHops,
			seedIndex,
			options?.signal,
			maxTotal,
			isAllowedType,
		);

		if (hops.length >= maxTotal) break;
	}

	// Step 4: Semantic fallback for underrepresented source types
	// Collect source types present in the collection
	const allSourceTypes = new Set<string>();
	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			allSourceTypes.add(chunk.sourceType);
		}
	}

	// Count hops per source type so far
	const hopsByType = new Map<string, number>();
	for (const hop of hops) {
		hopsByType.set(hop.sourceType, (hopsByType.get(hop.sourceType) ?? 0) + 1);
	}

	// Fill in source types that have fewer than maxPerSource results
	if (hops.length < maxTotal) {
		for (const sourceType of allSourceTypes) {
			const existing = hopsByType.get(sourceType) ?? 0;
			if (existing >= maxPerSource) continue;
			if (hops.length >= maxTotal) break;

			options?.signal?.throwIfAborted();

			const needed = maxPerSource - existing;
			// Search more candidates than needed to account for visited/filtered ones
			const candidates = await vectorIndex.search(queryVector, needed + visited.size);

			for (const candidate of candidates) {
				if (hops.length >= maxTotal) break;
				if (candidate.score < minScore) continue;
				if (visited.has(candidate.entry.id)) continue;
				if ((candidate.entry.metadata.sourceType ?? "unknown") !== sourceType) continue;

				visited.add(candidate.entry.id);
				const chunkData = indexes.byId.get(candidate.entry.id);
				hops.push({
					content: chunkData?.content ?? "",
					sourceType,
					source: candidate.entry.metadata.source ?? "unknown",
					sourceUrl: candidate.entry.metadata.sourceUrl,
					storageId: candidate.entry.storageId,
					timestamp: chunkData?.timestamp,
					timestampKind: chunkData?.timestampKind,
					connection: {
						method: "semantic",
						confidence: candidate.score,
					},
				});

				const count = hopsByType.get(sourceType) ?? 0;
				hopsByType.set(sourceType, count + 1);
				if ((hopsByType.get(sourceType) ?? 0) >= maxPerSource) break;
			}
		}
	}

	// Group by sourceType
	const groups: Record<string, TraceHop[]> = {};
	for (const hop of hops) {
		const key = hop.sourceType;
		if (!groups[key]) groups[key] = [];
		const group = groups[key];
		if (group && group.length < maxPerSource) {
			group.push(hop);
		}
	}

	const sourceTypes = Object.keys(groups);
	const edgeHops = hops.filter((h) => h.connection.method === "edge").length;

	// Chronological projection over `hops`. Traversal order stays untouched;
	// agents/timeline consumers read through this permutation instead. See #274.
	const chronologicalHopIndices = buildChronologicalHopIndices(hops);
	for (let i = 0; i < chronologicalHopIndices.length; i++) {
		const hopIdx = chronologicalHopIndices[i];
		if (hopIdx === undefined) continue;
		const hop = hops[hopIdx];
		if (hop) hop.chronologicalIndex = i;
	}

	// Build lineage chains from DFS tree (always, cheap)
	const lineageChains = buildLineageChains(hops);

	// Build conclusion block in analytical mode (omitted when no signal)
	const conclusion = mode === "analytical" ? buildConclusion(hops, lineageChains) : undefined;

	// Detect cross-source insights in analytical mode
	const insights = mode === "analytical" ? detectInsights(hops, segments, options?.signal) : [];

	return {
		query,
		groups,
		hops,
		chronologicalHopIndices,
		lineageChains,
		conclusion,
		insights,
		stats: {
			totalHops: hops.length,
			edgeHops,
			semanticHops: hops.length - edgeHops,
			sourceTypes,
			insightCount: insights.length,
		},
	};
}
