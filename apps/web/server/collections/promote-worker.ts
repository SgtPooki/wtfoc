/**
 * Async promote worker: bundles collection segments and uploads to FOC
 * using the user's delegated session key.
 *
 * Persists promotion checkpoints for resume on failure:
 * 1. car_built — CAR is bundled with manifest, carRootCid + pieceCid saved
 * 2. uploaded — same as car_built for bundleAndUpload (upload is atomic)
 * 3. on_chain_written — manifestCid saved, promotion complete
 */
import type { CollectionHead } from "@wtfoc/common";
import type { Repository } from "../db/index.js";

/** Track active promotions so they can be cancelled on key revocation */
const activePromotions = new Map<string, AbortController>();

/** Abort all in-flight promotions for a wallet address */
export function abortPromotionsForWallet(walletAddress: string): void {
	for (const [key, controller] of activePromotions) {
		if (key.startsWith(`${walletAddress}:`)) {
			controller.abort(new Error("Session key revoked"));
			activePromotions.delete(key);
		}
	}
}

export async function startPromotion(
	collectionId: string,
	sessionKeyDecrypted: string,
	walletAddress: string,
	repo: Repository,
	externalSignal?: AbortSignal,
): Promise<void> {
	const promotionKey = `${walletAddress}:${collectionId}`;
	const controller = new AbortController();
	activePromotions.set(promotionKey, controller);

	// Link external signal (if any) to our internal controller
	if (externalSignal) {
		externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
	}
	const signal = controller.signal;

	try {
		const col = await repo.getCollection(collectionId);
		if (!col) throw new Error(`Collection ${collectionId} not found`);

		await repo.updateCollectionStatus(collectionId, "promoting");

		const { createStore, bundleAndUpload, FocStorageBackend } = await import("@wtfoc/store");

		// Load existing manifest from local store
		const localStore = createStore({ storage: "local" });
		const head = await localStore.manifests.getHead(col.name);
		if (!head) throw new Error(`No manifest found for collection "${col.name}". Was ingestion completed?`);

		// Determine resume point
		const checkpoint = col.promoteCheckpoint;

		if (checkpoint === "on_chain_written") {
			// Already done — just mark as promoted
			await repo.updateCollectionPromotion(collectionId, { status: "promoted" });
			return;
		}

		signal.throwIfAborted();

		let manifestCid: string;
		let pieceCid: string;
		let carRootCid: string;
		let segmentCount: number;

		if (checkpoint === "uploaded" && col.manifestCid && col.pieceCid && col.carRootCid) {
			// Resume: upload already completed, skip to local manifest update
			console.error(`[promote-worker] Resuming "${col.name}" from checkpoint "uploaded"`);
			manifestCid = col.manifestCid;
			pieceCid = col.pieceCid;
			carRootCid = col.carRootCid;
			segmentCount = col.segmentCount ?? head.manifest.segments.length;
		} else {
			// Full flow: load segments, bundle, and upload
			const segments = await Promise.all(
				head.manifest.segments.map(async (seg) => {
					const data = await localStore.storage.download(seg.id, signal);
					return { id: seg.id, data };
				}),
			);
			segmentCount = segments.length;

			const focBackend = new FocStorageBackend({
				sessionKey: sessionKeyDecrypted,
				walletAddress,
			});

			const bundleResult = await bundleAndUpload(segments, focBackend, {
				signal,
				buildManifest: ({ segmentCids, pieceCid: bPieceCid, carRootCid: bCarRootCid }) => {
					const updatedManifest: CollectionHead = {
						...head.manifest,
						updatedAt: new Date().toISOString(),
						segments: head.manifest.segments.map((seg) => ({
							...seg,
							ipfsCid: segmentCids.get(seg.id),
						})),
						batches: [
							...(head.manifest.batches ?? []),
							{
								pieceCid: bPieceCid,
								carRootCid: bCarRootCid,
								segmentIds: [...segmentCids.values()],
								createdAt: new Date().toISOString(),
							},
						],
					};
					return updatedManifest;
				},
			});

			manifestCid = bundleResult.manifestCid ?? bundleResult.batch.carRootCid;
			pieceCid = bundleResult.batch.pieceCid;
			carRootCid = bundleResult.batch.carRootCid;

			// Checkpoint: upload complete — retry from here skips re-bundle/re-upload
			await repo.updateCollectionPromotion(collectionId, {
				promoteCheckpoint: "uploaded",
				carRootCid,
				pieceCid,
				manifestCid,
			});

			await repo.logAudit(walletAddress, "used_upload", collectionId, {
				carRootCid,
				pieceCid,
				manifestCid,
			});
		}

		signal.throwIfAborted();

		// Update local manifest with promotion results
		// Avoid duplicate batch: buildManifest callback already appended the batch
		// to the uploaded manifest. Here we just record the CIDs and batch if not
		// already present (e.g. resume from checkpoint).
		const existingBatches = head.manifest.batches ?? [];
		const alreadyHasBatch = existingBatches.some((b) => b.carRootCid === carRootCid);
		const updatedHead: CollectionHead = {
			...head.manifest,
			updatedAt: new Date().toISOString(),
			segments: head.manifest.segments.map((seg) => ({
				...seg,
				ipfsCid: seg.ipfsCid,
			})),
			batches: alreadyHasBatch
				? existingBatches
				: [
						...existingBatches,
						{
							pieceCid,
							carRootCid,
							segmentIds: head.manifest.segments.map((s) => s.id),
							createdAt: new Date().toISOString(),
						},
					],
		};
		await localStore.manifests.putHead(col.name, updatedHead, head.headId);

		// Mark promotion complete
		await repo.updateCollectionPromotion(collectionId, {
			status: "promoted",
			manifestCid,
			pieceCid,
			carRootCid,
			promoteCheckpoint: "on_chain_written",
			segmentCount,
		});

		await repo.logAudit(walletAddress, "used_on_chain", collectionId, { manifestCid });

		console.error(`[promote-worker] Collection "${col.name}" promoted: manifestCid=${manifestCid}`);
	} catch (err) {
		const reason = signal.aborted ? "revoked" : "failed";
		console.error(`[promote-worker] Collection ${collectionId} ${reason}:`, err);
		try {
			await repo.updateCollectionPromotion(collectionId, { status: "promotion_failed" });
		} catch {
			// Best effort
		}
	} finally {
		activePromotions.delete(promotionKey);
	}
}
