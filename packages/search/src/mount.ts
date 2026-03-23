import type {
	CollectionHead,
	CollectionRevision,
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
	/**
	 * Optional resolver for loading a CollectionRevision by ID.
	 * Required when mounting from a CollectionHead that has currentRevisionId.
	 * If not provided and the head has a currentRevisionId, falls back to
	 * loading segments directly from the head (pre-publication state).
	 */
	resolveRevision?: (revisionId: string, signal?: AbortSignal) => Promise<CollectionRevision>;
}

/**
 * Mount a collection for query/trace by hydrating segments.
 *
 * - If a CollectionRevision is passed: uses that exact pinned state (FR-013a)
 * - If a CollectionHead is passed with currentRevisionId + resolveRevision:
 *   resolves through the revision first (FR-013a "stable handle resolves to latest revision")
 * - If a CollectionHead is passed without currentRevisionId: mounts directly
 *   from head segments (pre-publication state, no revision yet)
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

	let revision: CollectionRevision | null = null;
	let segmentRefs: string[];

	if (isRevision) {
		revision = source;
		segmentRefs = source.segmentRefs;
	} else if (source.currentRevisionId && options?.resolveRevision) {
		revision = await options.resolveRevision(source.currentRevisionId, signal);
		segmentRefs = revision.segmentRefs;
	} else {
		segmentRefs = source.segments.map((s) => s.id);
	}

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
