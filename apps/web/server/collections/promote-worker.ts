/**
 * Async promote worker: bundles collection segments and uploads to FOC
 * using the user's delegated session key.
 *
 * Persists promotion checkpoints for resume on failure:
 * 1. car_built — CAR is bundled, carRootCid saved
 * 2. uploaded — Uploaded to FOC, pieceCid saved
 * 3. on_chain_written — Manifest CID saved, promotion complete
 */
import type { Repository } from "../db/index.js";

export async function startPromotion(
	collectionId: string,
	sessionKeyDecrypted: string,
	walletAddress: string,
	repo: Repository,
	signal?: AbortSignal,
): Promise<void> {
	try {
		const col = await repo.getCollection(collectionId);
		if (!col) throw new Error(`Collection ${collectionId} not found`);

		await repo.updateCollectionStatus(collectionId, "promoting");

		// Determine resume point
		const checkpoint = col.promoteCheckpoint;

		// Step 1: Bundle CAR (skip if already built)
		let carRootCid = col.carRootCid;
		if (!checkpoint || checkpoint === "car_built") {
			if (!carRootCid) {
				signal?.throwIfAborted();
				const { bundleAndUpload } = await import("@wtfoc/store");
				const { FocStorageBackend } = await import("@wtfoc/store");
				const { createStore } = await import("@wtfoc/store");

				// Load segments from local storage
				const store = createStore({ storage: "local" });
				const head = await store.manifests.getHead(col.name);
				if (!head) throw new Error(`No manifest found for collection "${col.name}"`);

				const segments = await Promise.all(
					head.manifest.segments.map(async (seg) => {
						const data = await store.storage.download(seg.id, signal);
						return { id: seg.id, data };
					}),
				);

				// Create FOC backend with session key
				const focBackend = new FocStorageBackend({
					sessionKey: sessionKeyDecrypted,
					walletAddress,
				});

				// Bundle and upload
				const result = await bundleAndUpload(segments, focBackend, { signal });
				carRootCid = result.batch.carRootCid;

				await repo.updateCollectionPromotion(collectionId, {
					carRootCid,
					promoteCheckpoint: "car_built",
					segmentCount: segments.length,
				});

				await repo.logAudit(walletAddress, "used_upload", collectionId, {
					carRootCid,
					pieceCid: result.batch.pieceCid,
				});

				// Step 2: Upload is done by bundleAndUpload, save piece CID
				await repo.updateCollectionPromotion(collectionId, {
					pieceCid: result.batch.pieceCid,
					promoteCheckpoint: "uploaded",
				});
			}
		}

		// Step 3: Mark as promoted with manifest CID
		signal?.throwIfAborted();
		const manifestCid = carRootCid ?? col.carRootCid;
		await repo.updateCollectionPromotion(collectionId, {
			status: "promoted",
			manifestCid,
			promoteCheckpoint: "on_chain_written",
		});

		await repo.logAudit(walletAddress, "used_on_chain", collectionId, { manifestCid });
	} catch (err) {
		console.error(`[promote-worker] Collection ${collectionId} failed:`, err);
		try {
			await repo.updateCollectionPromotion(collectionId, { status: "promotion_failed" });
		} catch {
			// Best effort
		}
	}
}
