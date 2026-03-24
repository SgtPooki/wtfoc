import type { Edge, Embedder, Segment, VectorIndex } from "@wtfoc/common";

export interface TraceOptions {
	/** Max results per source type (default: 3) */
	maxPerSource?: number;
	/** Max total results (default: 15) */
	maxTotal?: number;
	/** Max edge hops to follow (default: 3) */
	maxHops?: number;
	/** Minimum similarity score for semantic fallback (default: 0.3) */
	minScore?: number;
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
	/** Summary of the trace */
	stats: {
		totalHops: number;
		edgeHops: number;
		semanticHops: number;
		sourceTypes: string[];
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

	return {
		query,
		groups,
		hops,
		stats: {
			totalHops: hops.length,
			edgeHops,
			semanticHops: hops.length - edgeHops,
			sourceTypes,
		},
	};
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface ChunkData {
	content: string;
	sourceType: string;
	source: string;
	sourceUrl?: string;
	storageId: string;
}

interface ChunkIndexes {
	/** Chunk ID → data */
	byId: Map<string, ChunkData>;
	/** Lowercased source string → chunk IDs for case-insensitive resolution */
	bySource: Map<string, string[]>;
	/** Lowercased "repo#N" (without org) → chunk IDs for renamed repo resolution */
	byRepoName: Map<string, string[]>;
}

function buildChunkIndexes(segments: Segment[]): ChunkIndexes {
	const byId = new Map<string, ChunkData>();
	const bySource = new Map<string, string[]>();
	const byRepoName = new Map<string, string[]>();

	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			const data: ChunkData = {
				content: chunk.content,
				sourceType: chunk.sourceType,
				source: chunk.source,
				sourceUrl: chunk.sourceUrl,
				storageId: chunk.storageId,
			};
			byId.set(chunk.id, data);

			// Index by lowercased source for case-insensitive edge resolution
			const key = chunk.source.toLowerCase();
			const ids = bySource.get(key) ?? [];
			ids.push(chunk.id);
			bySource.set(key, ids);

			// Index by repo name only (without org) for renamed repo resolution
			// e.g. "FilOzone/pdp#24" → "pdp#24" so "FILCAT/pdp#24" can match
			const slashIdx = key.indexOf("/");
			if (slashIdx !== -1) {
				const repoKey = key.slice(slashIdx + 1);
				const repoIds = byRepoName.get(repoKey) ?? [];
				repoIds.push(chunk.id);
				byRepoName.set(repoKey, repoIds);
			}
		}
	}

	return { byId, bySource, byRepoName };
}

/**
 * Build bidirectional edge index — edges can be traversed from
 * sourceId → targetId AND targetId → sourceId.
 */
function buildEdgeIndex(segments: Segment[]): Map<string, Edge[]> {
	const index = new Map<string, Edge[]>();
	for (const seg of segments) {
		for (const edge of seg.edges) {
			// Forward: sourceId → target
			const fwd = index.get(edge.sourceId) ?? [];
			fwd.push(edge as Edge);
			index.set(edge.sourceId, fwd);

			// Reverse: targetId → source (for bidirectional traversal)
			const rev = index.get(edge.targetId) ?? [];
			rev.push({
				...edge,
				// Swap source/target for reverse traversal
				sourceId: edge.targetId,
				targetId: edge.sourceId,
				evidence: `← ${edge.evidence}`,
			} as Edge);
			index.set(edge.targetId, rev);
		}
	}
	return index;
}

function followEdges(
	chunkId: string,
	edgeIndex: Map<string, Edge[]>,
	indexes: ChunkIndexes,
	visited: Set<string>,
	hops: TraceHop[],
	depth: number,
	maxHops: number,
	signal?: AbortSignal,
	maxTotal?: number,
): void {
	if (depth >= maxHops) return;
	if (maxTotal != null && hops.length >= maxTotal) return;
	signal?.throwIfAborted();

	// Look up edges by chunk ID and by source string (reverse edges are
	// indexed by targetId which is typically a source string like "owner/repo#42")
	const chunkData = indexes.byId.get(chunkId);
	const edgesById = edgeIndex.get(chunkId) ?? [];
	// Also check lowercased source for reverse edges (handles case drift)
	const edgesBySource = chunkData?.source
		? (edgeIndex.get(chunkData.source) ?? edgeIndex.get(chunkData.source.toLowerCase()) ?? [])
		: [];

	// Merge, deduplicating by targetId
	const seen = new Set<string>();
	const edges: Edge[] = [];
	for (const e of [...edgesById, ...edgesBySource]) {
		const key = `${e.type}:${e.targetId}`;
		if (!seen.has(key)) {
			seen.add(key);
			edges.push(e);
		}
	}

	for (const edge of edges) {
		if (maxTotal != null && hops.length >= maxTotal) return;
		const targetChunks = findChunksByTarget(edge.targetId, indexes);

		for (const [targetId, targetData] of targetChunks) {
			if (maxTotal != null && hops.length >= maxTotal) return;
			if (visited.has(targetId)) continue;
			visited.add(targetId);

			hops.push({
				content: targetData.content,
				sourceType: targetData.sourceType,
				source: targetData.source,
				sourceUrl: targetData.sourceUrl,
				storageId: targetData.storageId,
				connection: {
					method: "edge",
					edgeType: edge.type,
					evidence: edge.evidence,
					confidence: edge.confidence,
				},
			});

			// Recurse — follow edges from the target
			followEdges(
				targetId,
				edgeIndex,
				indexes,
				visited,
				hops,
				depth + 1,
				maxHops,
				signal,
				maxTotal,
			);
		}
	}
}

/**
 * Resolve an edge targetId to matching chunks using indexed lookups.
 *
 * Resolution order (first match wins):
 * 1. Direct chunk ID match (O(1))
 * 2. Exact source match (O(1)) — e.g. targetId "FilOzone/synapse-sdk#142"
 *    matches chunks with source "FilOzone/synapse-sdk#142"
 * 3. Partial source match — for cross-source edges where targetId is a
 *    substring of the source (e.g. file path edges). Limited to avoid
 *    false positives.
 */
function findChunksByTarget(targetId: string, indexes: ChunkIndexes): Array<[string, ChunkData]> {
	const results: Array<[string, ChunkData]> = [];

	// 1. Direct chunk ID match
	const directMatch = indexes.byId.get(targetId);
	if (directMatch) {
		results.push([targetId, directMatch]);
		return results;
	}

	// 2. Exact source match (O(1) via lowercased source index)
	const lowerTarget = targetId.toLowerCase();
	const sourceMatches = indexes.bySource.get(lowerTarget);
	if (sourceMatches) {
		for (const id of sourceMatches) {
			const data = indexes.byId.get(id);
			if (data) results.push([id, data]);
		}
		if (results.length > 0) return results;
	}

	// 3. Partial source match — only for structured IDs (contains / or :)
	//    to avoid false positives on short targetIds like "#42"
	//    Capped at 10 results to avoid O(n) blowup on large collections
	if (targetId.includes("/") || targetId.includes(":")) {
		for (const [source, chunkIds] of indexes.bySource) {
			if (source.includes(lowerTarget)) {
				for (const id of chunkIds) {
					const data = indexes.byId.get(id);
					if (data) results.push([id, data]);
				}
				if (results.length >= 10) break;
			}
		}
		if (results.length > 0) return results;
	}

	// 4. Renamed repo fallback — strip org prefix and match by repo name only (O(1))
	//    e.g. "FILCAT/pdp#24" → look up "pdp#24" which matches "FilOzone/pdp#24"
	const slashIdx = lowerTarget.indexOf("/");
	if (slashIdx !== -1) {
		const repoKey = lowerTarget.slice(slashIdx + 1);
		const repoMatches = indexes.byRepoName.get(repoKey);
		if (repoMatches) {
			for (const id of repoMatches) {
				const data = indexes.byId.get(id);
				if (data) results.push([id, data]);
			}
		}
	}

	return results;
}
