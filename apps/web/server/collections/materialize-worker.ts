/**
 * Materialize job handler (#288 Phase 2 Slice C). Takes a segment artifact
 * produced by the `ingest` parent job and makes it collection-visible by
 * appending it to the manifest head and flipping the collection row to
 * `ready`.
 *
 * Contract:
 *  - Handler is idempotent. Re-running with the same `segmentId` is a
 *    no-op once the segment is already present in the current head.
 *  - `putHead` is conditional on `prevHeadId` (CAS). If another writer
 *    landed a newer head between our read and write, we reload and
 *    re-check for the segment — duplicates are skipped.
 *  - Handler does NOT read segment bytes; everything it needs is on the
 *    payload. Segment bytes live in local storage, content-addressed by
 *    `segmentId` — readers (query/trace) fetch them on demand.
 *  - Does NOT write `manifestCid` on the collection row (that's a CID-pull
 *    concern). Just flips to `ready` and updates `segmentCount`.
 */
import type { CollectionHead } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import type { Repository } from "../db/index.js";
import type { JobQueue } from "../jobs/queue.js";
import type { JobContext, MaterializePayload } from "../jobs/types.js";

/** Minimal store surface the handler needs. Injected for tests. */
export interface MaterializeDeps {
	/** Return current head + its headId so CAS can chain off prevHeadId. */
	getHead(
		collectionName: string,
	): Promise<{ manifest: CollectionHead; headId: string } | null>;
	/** Write new head with prev-pointer. Throws on CAS conflict. */
	putHead(
		collectionName: string,
		manifest: CollectionHead,
		prevHeadId: string | null,
	): Promise<void>;
	/** Generate a deterministic collectionId for first-time materialization. */
	generateCollectionId(collectionName: string): string;
}

async function defaultMaterializeDeps(): Promise<MaterializeDeps> {
	const { createStore, generateCollectionId } = await import("@wtfoc/store");
	const store = createStore({ storage: "local" });
	return {
		getHead: async (name) => {
			const head = await store.manifests.getHead(name).catch(() => null);
			return head ? { manifest: head.manifest, headId: head.headId } : null;
		},
		putHead: async (name, manifest, prev) => {
			await store.manifests.putHead(name, manifest, prev);
		},
		generateCollectionId,
	};
}

export interface MaterializeParams {
	payload: MaterializePayload;
	repo: Repository;
	ctx: JobContext;
	deps?: MaterializeDeps;
}

export function registerMaterializeHandler(
	queue: JobQueue,
	repo: Repository,
	depsFactory: () => Promise<MaterializeDeps> = defaultMaterializeDeps,
): void {
	queue.register<MaterializePayload>("materialize", async (payload, ctx) => {
		const deps = await depsFactory();
		await runMaterializeJob({ payload, repo, ctx, deps });
	});
}

/** Retry budget for CAS conflicts (another materializer raced us). */
const CAS_RETRIES = 3;

export async function runMaterializeJob({
	payload,
	repo,
	ctx,
	deps,
}: MaterializeParams): Promise<void> {
	const d = deps ?? (await defaultMaterializeDeps());
	const { signal } = ctx;
	try {
		await ctx.reportProgress({
			phase: "materializing",
			current: 0,
			total: 1,
			message: payload.segmentId,
		});

		for (let attempt = 1; attempt <= CAS_RETRIES; attempt++) {
			signal.throwIfAborted();
			const head = await d.getHead(payload.collectionName);

			// Dedupe: segment already present in the current head → nothing to do.
			if (head && head.manifest.segments.some((s) => s.id === payload.segmentId)) {
				await repo.updateCollectionPromotion(payload.collectionId, {
					status: "ready",
					segmentCount: head.manifest.segments.length,
				});
				await ctx.reportProgress({ current: 1, total: 1 });
				return;
			}

			const next = appendSegmentToManifest(head?.manifest ?? null, payload, d);
			try {
				await d.putHead(payload.collectionName, next, head?.headId ?? null);
			} catch (err) {
				if (attempt >= CAS_RETRIES) throw err;
				// Retry: another writer probably landed a newer head. Re-read on
				// the next loop iteration and see if our segment is already there.
				await ctx.reportProgress({
					phase: "retrying after CAS conflict",
					message: `attempt ${attempt + 1}/${CAS_RETRIES}`,
				});
				continue;
			}

			await repo.updateCollectionPromotion(payload.collectionId, {
				status: "ready",
				segmentCount: next.segments.length,
			});
			await ctx.reportProgress({ current: 1, total: 1 });
			return;
		}
	} catch (err) {
		if (signal.aborted) throw err;
		console.error(
			`[materialize-worker] collection ${payload.collectionId} materialize failed:`,
			err,
		);
		// Materialize failure leaves the segment blob orphaned (content-addressed,
		// harmless) and the collection marked failed so retries are obvious.
		await repo
			.updateCollectionStatus(payload.collectionId, "ingestion_failed")
			.catch(() => {});
		throw err;
	}
}

function appendSegmentToManifest(
	current: CollectionHead | null,
	payload: MaterializePayload,
	deps: MaterializeDeps,
): CollectionHead {
	const now = new Date().toISOString();
	const newSummary = {
		id: payload.segmentId,
		sourceTypes: payload.sourceTypes,
		chunkCount: payload.chunkCount,
	};

	if (!current) {
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: deps.generateCollectionId(payload.collectionName),
			name: payload.collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [newSummary],
			totalChunks: payload.chunkCount,
			embeddingModel: payload.embeddingModel,
			embeddingDimensions: payload.embeddingDimensions,
			createdAt: now,
			updatedAt: now,
		};
	}

	return {
		...current,
		segments: [...current.segments, newSummary],
		totalChunks: current.totalChunks + payload.chunkCount,
		updatedAt: now,
	};
}
