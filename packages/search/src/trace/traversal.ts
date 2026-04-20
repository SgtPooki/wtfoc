import type { ChunkIndexes, TraversalEdge } from "./indexing.js";
import { findChunksByTarget } from "./resolution.js";
import type { TraceHop } from "./trace.js";

export function followEdges(
	chunkId: string,
	edgeIndex: Map<string, TraversalEdge[]>,
	indexes: ChunkIndexes,
	visited: Set<string>,
	hops: TraceHop[],
	depth: number,
	maxHops: number,
	parentHopIndex: number,
	signal?: AbortSignal,
	maxTotal?: number,
	isAllowedType?: (sourceType: string) => boolean,
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
	const edges: TraversalEdge[] = [];
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
			if (isAllowedType && !isAllowedType(targetData.sourceType)) continue;
			visited.add(targetId);

			const thisHopIndex = hops.length;
			hops.push({
				content: targetData.content,
				sourceType: targetData.sourceType,
				source: targetData.source,
				sourceUrl: targetData.sourceUrl,
				storageId: targetData.storageId,
				timestamp: targetData.timestamp,
				parentHopIndex,
				connection: {
					method: "edge",
					edgeType: edge.type,
					evidence: edge.evidence,
					confidence: edge.confidence,
					walkDirection: edge.walkDirection,
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
				thisHopIndex,
				signal,
				maxTotal,
				isAllowedType,
			);
		}
	}
}
