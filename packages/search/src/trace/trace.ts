import type { Embedder, Segment, VectorIndex } from "@wtfoc/common";
import { buildChunkIndexes, buildEdgeIndex } from "./indexing.js";
import { detectInsights, type TraceInsight } from "./insights.js";
import { followEdges } from "./traversal.js";

export type TraceMode = "discovery" | "analytical";

export interface TraceOptions {
	/** Max results per source type (default: 3) */
	maxPerSource?: number;
	/** Max total results (default: 15) */
	maxTotal?: number;
	/** Max edge hops to follow (default: 3) */
	maxHops?: number;
	/** Minimum similarity score for semantic fallback (default: 0.3) */
	minScore?: number;
	/**
	 * Trace mode:
	 * - "discovery" (default): find connected results across sources
	 * - "analytical": also detect cross-source insights (convergence, evidence chains, temporal patterns)
	 */
	mode?: TraceMode;
	signal?: AbortSignal;
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
	/** Index of the hop that led to this one (undefined for seeds) */
	parentHopIndex?: number;
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
	};
}

export interface TraceResult {
	query: string;
	/** Results grouped by source type */
	groups: Record<string, TraceHop[]>;
	/** Flat list of all hops in traversal order */
	hops: TraceHop[];
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

	options?.signal?.throwIfAborted();

	// Step 1: Embed query
	const queryVector = await embedder.embed(query, options?.signal);

	// Step 2: Find seed chunks via vector search
	const seeds = await vectorIndex.search(queryVector, maxTotal);

	// Build edge index from all segments
	const edgeIndex = buildEdgeIndex(segments);

	// Step 3: Follow edges from seeds + semantic fallback
	const visited = new Set<string>();
	const hops: TraceHop[] = [];

	// Build indexed chunk lookups for O(1) edge resolution
	const indexes = buildChunkIndexes(segments);

	for (const seed of seeds) {
		if (seed.score < minScore) continue;
		if (visited.has(seed.entry.id)) continue;

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

	// Detect cross-source insights in analytical mode
	const insights = mode === "analytical" ? detectInsights(hops, segments, options?.signal) : [];

	return {
		query,
		groups,
		hops,
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
