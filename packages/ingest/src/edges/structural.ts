import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";

/**
 * File-level summary marker written by `HierarchicalCodeChunker`. Must match
 * `metadata.chunkLevel` for the extractor to recognize the summary chunk.
 * Kept as a local literal (not imported from @wtfoc/ingest's chunker barrel)
 * to avoid a circular dep between edge and chunker modules.
 */
const FILE_CHUNK_LEVEL = "file";

/**
 * Structural edge extractor — synthesizes \`contains\` edges between the
 * file-level summary chunk (#252) and the symbol chunks that share its
 * \`documentId\` + \`documentVersionId\` (#285).
 *
 * - No content inspection. Runs in O(n) over the chunk list.
 * - Confidence 1.0: the relationship is a deterministic structural fact,
 *   not a semantic guess.
 * - Emits only the forward direction. `buildEdgeIndex` materializes the
 *   reverse traversal automatically, so consumers can walk summary→symbol
 *   and symbol→summary from this one edge.
 * - \`provenance: ["structural"]\` so downstream consumers can filter these
 *   out or treat them differently from content-derived edges.
 *
 * Skips chunks without a documentId (legacy content-hash-only chunks) and
 * documents without a file summary chunk (no-op).
 */
export class StructuralEdgeExtractor implements EdgeExtractor {
	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		// Group by (documentId, documentVersionId). Anonymous chunks are
		// dropped — they can't be matched to a file summary.
		const groups = new Map<string, Chunk[]>();
		for (const chunk of chunks) {
			if (!chunk.documentId || !chunk.documentVersionId) continue;
			const key = `${chunk.documentId}@${chunk.documentVersionId}`;
			const bucket = groups.get(key) ?? [];
			bucket.push(chunk);
			groups.set(key, bucket);
		}

		const edges: Edge[] = [];
		for (const [, groupChunks] of groups) {
			signal?.throwIfAborted();
			const summary = groupChunks.find((c) => c.metadata?.chunkLevel === FILE_CHUNK_LEVEL);
			if (!summary) continue;
			for (const symbol of groupChunks) {
				if (symbol.id === summary.id) continue;
				if (symbol.metadata?.chunkLevel === FILE_CHUNK_LEVEL) continue;
				edges.push({
					type: "contains",
					sourceId: summary.id,
					targetType: chunkTargetType(symbol),
					targetId: symbol.id,
					evidence: `file summary contains ${symbol.metadata?.filePath ?? symbol.source} symbol chunk`,
					confidence: 1.0,
					provenance: ["structural"],
				});
			}
		}
		return edges;
	}
}

function chunkTargetType(chunk: Chunk): string {
	// Use the chunk's sourceType as the edge target type so trace output
	// reflects what the summary actually contains. Falls back to "chunk"
	// only for the (unreachable under current adapters) no-sourceType case.
	return chunk.sourceType ?? "chunk";
}
