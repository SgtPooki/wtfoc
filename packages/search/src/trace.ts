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

	// Get chunk data lookup
	const chunkLookup = buildChunkLookup(segments);

	for (const seed of seeds) {
		if (seed.score < minScore) continue;
		if (visited.has(seed.entry.id)) continue;

		options?.signal?.throwIfAborted();

		visited.add(seed.entry.id);

		// Add seed as a hop
		const chunkData = chunkLookup.get(seed.entry.id);
		hops.push({
			content: chunkData?.content ?? "",
			sourceType: seed.entry.metadata["sourceType"] ?? "unknown",
			source: seed.entry.metadata["source"] ?? "unknown",
			sourceUrl: seed.entry.metadata["sourceUrl"],
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
			chunkLookup,
			visited,
			hops,
			0,
			maxHops,
			options?.signal,
		);

		if (hops.length >= maxTotal) break;
	}

	// Group by sourceType
	const groups: Record<string, TraceHop[]> = {};
	for (const hop of hops) {
		const key = hop.sourceType;
		if (!groups[key]) groups[key] = [];
		if (groups[key]!.length < maxPerSource) {
			groups[key]!.push(hop);
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

function buildChunkLookup(segments: Segment[]): Map<string, ChunkData> {
	const lookup = new Map<string, ChunkData>();
	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			lookup.set(chunk.id, {
				content: chunk.metadata["content"] ?? "",
				sourceType: chunk.sourceType,
				source: chunk.source,
				sourceUrl: chunk.sourceUrl,
				storageId: chunk.storageId,
			});
		}
	}
	return lookup;
}

function buildEdgeIndex(segments: Segment[]): Map<string, Edge[]> {
	const index = new Map<string, Edge[]>();
	for (const seg of segments) {
		for (const edge of seg.edges) {
			const existing = index.get(edge.sourceId) ?? [];
			existing.push(edge as Edge);
			index.set(edge.sourceId, existing);
		}
	}
	return index;
}

function followEdges(
	chunkId: string,
	edgeIndex: Map<string, Edge[]>,
	chunkLookup: Map<string, ChunkData>,
	visited: Set<string>,
	hops: TraceHop[],
	depth: number,
	maxHops: number,
	signal?: AbortSignal,
): void {
	if (depth >= maxHops) return;
	signal?.throwIfAborted();

	const edges = edgeIndex.get(chunkId) ?? [];
	for (const edge of edges) {
		// Try to find a chunk matching the edge target
		// Edge targetId might be "FilOzone/synapse-sdk#42" — look for chunks from that source
		const targetChunks = findChunksByTarget(edge.targetId, chunkLookup);

		for (const [targetId, targetData] of targetChunks) {
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
			followEdges(targetId, edgeIndex, chunkLookup, visited, hops, depth + 1, maxHops, signal);
		}
	}
}

function findChunksByTarget(
	targetId: string,
	chunkLookup: Map<string, ChunkData>,
): Array<[string, ChunkData]> {
	const results: Array<[string, ChunkData]> = [];
	for (const [id, data] of chunkLookup) {
		// Match by source containing the targetId
		if (data.source.includes(targetId) || id === targetId) {
			results.push([id, data]);
		}
	}
	return results;
}
