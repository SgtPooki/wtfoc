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
	 * If true, delete orphan vectors from the vector index after upserting
	 * all current chunks. Only effective when the vector index supports
	 * reconciliation (e.g. QdrantVectorIndex). Defaults to false.
	 */
	reconcile?: boolean;
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
	return typeof (index as Record<string, unknown>).reconcile === "function";
}
