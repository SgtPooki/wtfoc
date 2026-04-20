import type { Edge, Segment, TimestampKind } from "@wtfoc/common";
import { normalizeRepoSource } from "../normalize-source.js";

/**
 * Edge tagged with the walk direction it was indexed under. `forward` entries
 * preserve the original `sourceId → targetId` orientation; `reverse` entries
 * swap `sourceId`/`targetId` so traversal can walk either way, while the
 * direction tag preserves the fact that `type` still refers to the *original*
 * edge. Consumers interpreting timestamps per edge type must bucket by
 * direction to avoid conflating forward `closes` (newer→older PR→issue) with
 * reverse `closes` (older→newer issue→PR). See #280.
 */
export interface TraversalEdge extends Edge {
	walkDirection: "forward" | "reverse";
}

export interface ChunkData {
	content: string;
	sourceType: string;
	source: string;
	sourceUrl?: string;
	storageId: string;
	timestamp?: string;
	timestampKind?: TimestampKind;
}

export interface ChunkIndexes {
	/** Chunk ID → data */
	byId: Map<string, ChunkData>;
	/** Lowercased source string → chunk IDs for case-insensitive resolution */
	bySource: Map<string, string[]>;
	/** Lowercased "repo#N" (without org) → chunk IDs for renamed repo resolution */
	byRepoName: Map<string, string[]>;
}

export function buildChunkIndexes(segments: Segment[]): ChunkIndexes {
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
				timestampKind: chunk.timestampKind,
				storageId: chunk.storageId,
				timestamp: chunk.timestamp,
			};
			byId.set(chunk.id, data);

			// Index by normalized source for case-insensitive, URL-normalized edge resolution
			const key = normalizeRepoSource(chunk.source);
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
 *
 * When overlayEdges are provided (e.g. from extract-edges LLM overlay),
 * they are indexed alongside segment-embedded edges.
 */
export function buildEdgeIndex(
	segments: Segment[],
	overlayEdges?: Edge[],
): Map<string, TraversalEdge[]> {
	const index = new Map<string, TraversalEdge[]>();

	const addEdge = (edge: Edge) => {
		// Forward: sourceId → target
		const fwd = index.get(edge.sourceId) ?? [];
		fwd.push({ ...edge, walkDirection: "forward" });
		index.set(edge.sourceId, fwd);

		// Reverse: targetId → source (for bidirectional traversal)
		const rev = index.get(edge.targetId) ?? [];
		rev.push({
			...edge,
			sourceId: edge.targetId,
			targetId: edge.sourceId,
			evidence: `← ${edge.evidence}`,
			walkDirection: "reverse",
		});
		index.set(edge.targetId, rev);
	};

	for (const seg of segments) {
		for (const edge of seg.edges) {
			addEdge(edge);
		}
	}

	if (overlayEdges) {
		for (const edge of overlayEdges) {
			addEdge(edge);
		}
	}

	return index;
}
