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

		const { createStore, bundleAndUpload, FocStorageBackend } = await import("@wtfoc/store");

		// Load existing manifest from local store
		const localStore = createStore({ storage: "local" });
		const head = await localStore.manifests.getHead(col.name);
		if (!head) throw new Error(`No manifest found for collection "${col.name}". Was ingestion completed?`);

		// Determine resume point
		const checkpoint = col.promoteCheckpoint;

		// If already past car_built, we can skip bundling
		if (checkpoint === "on_chain_written") {
			// Already done — just mark as promoted
			await repo.updateCollectionPromotion(collectionId, { status: "promoted" });
			return;
		}

		signal?.throwIfAborted();

		// Load all segment data from local storage
		const segments = await Promise.all(
			head.manifest.segments.map(async (seg) => {
				const data = await localStore.storage.download(seg.id, signal);
				return { id: seg.id, data };
			}),
		);

		// Create FOC backend with session key
		const focBackend = new FocStorageBackend({
			sessionKey: sessionKeyDecrypted,
			walletAddress,
		});

		// Bundle and upload with buildManifest to produce a real manifest CID
		const bundleResult = await bundleAndUpload(segments, focBackend, {
			signal,
			buildManifest: ({ segmentCids, pieceCid, carRootCid }) => {
				// Update segment references with IPFS CIDs
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
							pieceCid,
							carRootCid,
							segmentIds: [...segmentCids.values()],
							createdAt: new Date().toISOString(),
						},
					],
				};
				return updatedManifest;
			},
		});

		const manifestCid = bundleResult.manifestCid ?? bundleResult.batch.carRootCid;
		const pieceCid = bundleResult.batch.pieceCid;

		// Update local manifest with IPFS CIDs + batch records
		const updatedHead: CollectionHead = {
			...head.manifest,
			updatedAt: new Date().toISOString(),
			segments: head.manifest.segments.map((seg) => ({
				...seg,
				ipfsCid: bundleResult.segmentCids.get(seg.id),
			})),
			batches: [
				...(head.manifest.batches ?? []),
				bundleResult.batch,
			],
		};
		await localStore.manifests.putHead(col.name, updatedHead, head.headId);

		await repo.logAudit(walletAddress, "used_upload", collectionId, {
			carRootCid: bundleResult.batch.carRootCid,
			pieceCid,
			manifestCid,
		});

		// Mark promotion complete
		await repo.updateCollectionPromotion(collectionId, {
			status: "promoted",
			manifestCid,
			pieceCid,
			carRootCid: bundleResult.batch.carRootCid,
			promoteCheckpoint: "on_chain_written",
			segmentCount: segments.length,
		});

		await repo.logAudit(walletAddress, "used_on_chain", collectionId, { manifestCid });

		console.error(`[promote-worker] Collection "${col.name}" promoted: manifestCid=${manifestCid}`);
	} catch (err) {
		console.error(`[promote-worker] Collection ${collectionId} failed:`, err);
		try {
			await repo.updateCollectionPromotion(collectionId, { status: "promotion_failed" });
		} catch {
			// Best effort
		}
	}
}
