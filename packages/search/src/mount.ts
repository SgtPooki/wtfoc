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
	/**
	 * If true, after mounting and upserting all current chunks, reconcile the
	 * backing vector index against the expected set of vector IDs derived from
	 * the mounted segments and delete any orphan vectors.
	 *
	 * Reconciliation is an opt-in O(n) operation that may scan the entire
	 * index for the mounted collection, so it is primarily intended for
	 * persisted vector backends where stale vectors can accumulate over time.
	 *
	 * Only effective when the vector index implementation exposes a
	 * `reconcile` method (e.g. QdrantVectorIndex). Defaults to false; when
	 * false, existing vectors are left untouched and only new or updated
	 * chunks are upserted.
	 */
	reconcile?: boolean;
	/**
	 * Segment IDs to skip during mount. Segments in this set will not be
	 * downloaded, parsed, or added to the vector index. Use this for
	 * incremental mounting where some segments are already indexed in a
	 * persistent vector backend.
	 */
	skipSegmentIds?: ReadonlySet<string>;
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

	const skipIds = options?.skipSegmentIds;
	for (const segRef of segmentRefs) {
		signal?.throwIfAborted();
		if (skipIds?.has(segRef)) continue;
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

		const entries: VectorEntry[] = segment.chunks.map((chunk) => {
			const metadata: Record<string, string> = {
				sourceType: chunk.sourceType,
				source: chunk.source,
				sourceUrl: chunk.sourceUrl ?? "",
				content: chunk.content,
				...chunk.metadata,
			};
			if (chunk.signalScores && Object.keys(chunk.signalScores).length > 0) {
				metadata.signalScores = JSON.stringify(chunk.signalScores);
			}
			return {
				id: chunk.id,
				vector: new Float32Array(chunk.embedding),
				storageId: chunk.storageId || segRef,
				metadata,
			};
		});
		await vectorIndex.add(entries);
	}

	// Reconcile: delete orphan vectors not in the current manifest
	if (options?.reconcile && isReconcilable(vectorIndex)) {
		signal?.throwIfAborted();
		const expectedIds = new Set<string>();
		for (const seg of segments) {
			for (const chunk of seg.chunks) {
				expectedIds.add(chunk.id);
			}
		}
		await vectorIndex.reconcile(expectedIds, signal);
	}

	return { revision, segments, vectorIndex };
}

/**
 * Type guard for vector indices that support reconciliation (e.g. QdrantVectorIndex).
 */
function isReconcilable(index: VectorIndex): index is VectorIndex & {
	reconcile(expectedIds: ReadonlySet<string>, signal?: AbortSignal): Promise<void>;
} {
	return "reconcile" in index && typeof index.reconcile === "function";
}
