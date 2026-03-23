import type {
	CollectionHead,
	CollectionRevision,
	Embedder,
	Segment,
	StorageBackend,
	VectorEntry,
	VectorIndex,
} from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";

export interface MountedCollection {
	revision: CollectionRevision | null;
	segments: Segment[];
	vectorIndex: VectorIndex;
}

export interface MountOptions {
	signal?: AbortSignal;
}

/**
 * Mount a collection for query/trace by hydrating segments from a revision.
 *
 * Supports two modes:
 * - Latest: pass a CollectionHead → resolves current revision's segments
 * - Pinned: pass a CollectionRevision directly → uses that exact state
 *
 * Reuses stored corpus embeddings from segments — only query-time
 * embedding requires an embedder. No full re-embedding needed.
 */
export async function mountCollection(
	source: CollectionHead | CollectionRevision,
	storage: StorageBackend,
	vectorIndex: VectorIndex,
	options?: MountOptions,
): Promise<MountedCollection> {
	const signal = options?.signal;
	signal?.throwIfAborted();

	const isRevision = "revisionId" in source;
	const segmentRefs = isRevision ? source.segmentRefs : source.segments.map((s) => s.id);

	const revision = isRevision ? source : null;
	const segments: Segment[] = [];

	for (const segRef of segmentRefs) {
		signal?.throwIfAborted();
		const data = await storage.download(segRef, signal);
		const text = new TextDecoder().decode(data);
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new WtfocError(`Failed to parse segment ${segRef}`, "SCHEMA_INVALID", {
				segmentRef: segRef,
			});
		}
		const segment = parsed as Segment;
		segments.push(segment);

		const entries: VectorEntry[] = segment.chunks.map((chunk) => ({
			id: chunk.id,
			vector: new Float32Array(chunk.embedding),
			storageId: chunk.storageId,
			metadata: {
				content: chunk.content,
				source: chunk.source,
				sourceType: chunk.sourceType,
				sourceUrl: chunk.sourceUrl ?? "",
			},
		}));
		await vectorIndex.add(entries);
	}

	return { revision, segments, vectorIndex };
}
