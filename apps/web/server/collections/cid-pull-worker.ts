/**
 * CID pull job handler (#288 Phase 2). Resolves a manifest CID over
 * verified-fetch, downloads each referenced segment to local storage with
 * per-segment progress reporting, then writes the local manifest head.
 *
 * Contract:
 *  - The caller creates the `collections` row (status=`importing`) and
 *    enqueues the job with `collectionId` + payload `{ manifestCid,
 *    collectionName }`. The handler does NOT create the row — keeps the
 *    "one active mutating job per collection" unique-index invariant honest.
 *  - On success: `putHead` runs last, collection flips to `ready`, manifestCid
 *    + segmentCount populated.
 *  - On cancel/failure: no head is written, collection flips to
 *    `import_failed`. Content-addressed segment blobs are left in place —
 *    shared across collections, deletion is not reference-safe. Retry on the
 *    same CID resumes cheaply via `store.storage.verify`.
 */
import type { CollectionHead, StorageBackend } from "@wtfoc/common";
import type { Repository } from "../db/index.js";
import type { JobQueue } from "../jobs/queue.js";
import type { CidPullPayload, JobContext } from "../jobs/types.js";

/**
 * Minimal surface the handler needs from `@wtfoc/store`. Injected so tests
 * can substitute in-memory fakes without mocking ESM modules.
 */
export interface CidPullDeps {
	resolveCollectionByCid(
		cid: string,
		signal?: AbortSignal,
	): Promise<{ manifest: CollectionHead; storage: StorageBackend }>;
	verifyLocal(id: string): Promise<boolean>;
	uploadLocal(bytes: Uint8Array): Promise<void>;
	/** Returns the `headId` currently pointed at by `collectionName`, or null. */
	currentLocalHeadId(collectionName: string): Promise<string | null>;
	putLocalHead(
		collectionName: string,
		manifest: CollectionHead,
		prevHeadId: string | null,
	): Promise<void>;
}

export async function defaultCidPullDeps(): Promise<CidPullDeps> {
	const { createStore, resolveCollectionByCid } = await import("@wtfoc/store");
	const store = createStore({ storage: "local" });
	return {
		resolveCollectionByCid,
		verifyLocal: async (id) => {
			const verify = store.storage.verify?.bind(store.storage);
			if (!verify) return false;
			const r = await verify(id);
			return r.exists;
		},
		uploadLocal: async (bytes) => {
			await store.storage.upload(bytes);
		},
		currentLocalHeadId: async (name) => {
			const head = await store.manifests.getHead(name).catch(() => null);
			return head?.headId ?? null;
		},
		putLocalHead: async (name, manifest, prev) => {
			await store.manifests.putHead(name, manifest, prev);
		},
	};
}

export interface CidPullParams {
	collectionId: string;
	manifestCid: string;
	collectionName: string;
	repo: Repository;
	ctx: JobContext;
	deps?: CidPullDeps;
}

export function registerCidPullHandler(
	queue: JobQueue,
	repo: Repository,
	depsFactory: () => Promise<CidPullDeps> = defaultCidPullDeps,
): void {
	queue.register<CidPullPayload>("cid-pull", async (payload, ctx) => {
		const target = await repo.getCollection(payload.collectionId);
		if (!target) {
			throw new Error(`collection row missing for cid-pull job ${ctx.jobId}`);
		}
		const deps = await depsFactory();
		await runCidPullJob({
			collectionId: target.id,
			manifestCid: payload.manifestCid,
			collectionName: payload.collectionName,
			repo,
			ctx,
			deps,
		});
	});
}

/**
 * Handler body. Exported so tests can invoke it directly with an
 * InMemoryJobQueue context without rebuilding the registration shim.
 */
export async function runCidPullJob({
	collectionId,
	manifestCid,
	collectionName,
	repo,
	ctx,
	deps,
}: CidPullParams): Promise<void> {
	const d = deps ?? (await defaultCidPullDeps());
	const { signal } = ctx;
	try {
		await ctx.reportProgress({
			phase: "resolving manifest",
			current: 0,
			total: 0,
			message: manifestCid,
		});
		signal.throwIfAborted();

		const { manifest, storage } = await d.resolveCollectionByCid(manifestCid, signal);
		signal.throwIfAborted();

		const total = manifest.segments.length;
		await ctx.reportProgress({
			phase: "downloading segments",
			current: 0,
			total,
		});

		for (let i = 0; i < manifest.segments.length; i++) {
			signal.throwIfAborted();
			const seg = manifest.segments[i];
			if (!seg) continue;
			await ctx.reportProgress({
				phase: "downloading segments",
				current: i,
				total,
				message: seg.id,
			});
			if (await d.verifyLocal(seg.id)) continue;
			const bytes = await storage.download(seg.id, signal);
			signal.throwIfAborted();
			await d.uploadLocal(bytes);
		}

		signal.throwIfAborted();
		await ctx.reportProgress({
			phase: "persisting manifest",
			current: total,
			total,
		});

		const prev = await d.currentLocalHeadId(collectionName);
		await d.putLocalHead(collectionName, manifest, prev);

		await repo.updateCollectionPromotion(collectionId, {
			status: "ready",
			manifestCid,
			segmentCount: manifest.segments.length,
		});
	} catch (err) {
		if (signal.aborted) {
			await repo.updateCollectionStatus(collectionId, "import_failed").catch(() => {});
			throw err;
		}
		console.error(`[cid-pull-worker] collection ${collectionId} import failed:`, err);
		await repo.updateCollectionStatus(collectionId, "import_failed").catch(() => {});
		throw err;
	}
}


