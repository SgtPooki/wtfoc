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
import {
	buildEnrichedCollectionHead,
	enumeratePromotableArtifacts,
	type PromotableArtifact,
} from "@wtfoc/ingest";
import type { BundleArtifact } from "@wtfoc/store";
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

		const {
			createStore,
			bundleAndUpload,
			FocStorageBackend,
			getLocalManifestDir,
			resolveCollectionByCid,
		} = await import("@wtfoc/store");

		// Load existing manifest from local store
		const localStore = createStore({ storage: "local" });
		const head = await localStore.manifests.getHead(col.name);
		if (!head) throw new Error(`No manifest found for collection "${col.name}". Was ingestion completed?`);
		const manifestDir = getLocalManifestDir(localStore);

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
		// enrichedHead is populated on a successful upload so we can write
		// identical batch + artifactRefs to the local manifest below.
		let enrichedHead: CollectionHead | null = null;

		if (checkpoint === "uploaded" && col.manifestCid && col.pieceCid && col.carRootCid) {
			// Resume: upload already completed. Recover the enriched manifest from
			// the published CID so the local head gets stamped with artifactRefs +
			// per-artifact IPFS CIDs. Without this step, the DB would advance to
			// `on_chain_written` while the local manifest still lacks the
			// publication index — a pulled-vs-local divergence.
			console.error(`[promote-worker] Resuming "${col.name}" from checkpoint "uploaded"`);
			manifestCid = col.manifestCid;
			pieceCid = col.pieceCid;
			carRootCid = col.carRootCid;
			segmentCount = col.segmentCount ?? head.manifest.segments.length;
			const { manifest: publishedManifest } = await resolveCollectionByCid(manifestCid, signal);
			enrichedHead = publishedManifest;
		} else {
			// Full flow: enumerate every promotable artifact, bundle, upload as
			// a single CAR. Uses the same helper as the CLI `wtfoc promote`
			// command so CLI and web paths stay in sync.
			const enumerated: Array<{ artifact: PromotableArtifact; bytes: Uint8Array }> = [];
			for await (const artifact of enumeratePromotableArtifacts(
				head.manifest,
				col.name,
				manifestDir,
				(storageId) => localStore.storage.download(storageId, signal),
			)) {
				const bytes = await artifact.getBytes();
				enumerated.push({ artifact, bytes });
			}
			segmentCount = enumerated.filter((e) => e.artifact.kind === "segment").length;

			if (enumerated.length === 0) {
				throw new Error(
					`Collection "${col.name}" has no promotable artifacts — nothing to upload`,
				);
			}

			const bundleArtifacts: BundleArtifact[] = enumerated.map(({ artifact, bytes }) => ({
				id: artifact.id,
				data: bytes,
				path: artifact.carPath,
				mediaType: artifact.kind === "sidecar" ? "application/json" : undefined,
			}));

			const focBackend = new FocStorageBackend({
				sessionKey: sessionKeyDecrypted,
				walletAddress,
			});

			const existingBatches = head.manifest.batches ?? [];

			const bundleResult = await bundleAndUpload(bundleArtifacts, focBackend, {
				signal,
				buildManifest: ({ artifactCids, pieceCid: bPieceCid, carRootCid: bCarRootCid }) => {
					const built = buildEnrichedCollectionHead({
						head: head.manifest,
						enumerated,
						artifactCids,
						newBatch: {
							pieceCid: bPieceCid,
							carRootCid: bCarRootCid,
							segmentIds: bundleArtifacts.map((a) => artifactCids.get(a.id) ?? a.id),
							createdAt: new Date().toISOString(),
						},
						existingBatches,
					});
					enrichedHead = built;
					return built;
				},
			});

			manifestCid = bundleResult.manifestCid ?? bundleResult.batch.carRootCid;
			pieceCid = bundleResult.batch.pieceCid;
			carRootCid = bundleResult.batch.carRootCid;

			if (!enrichedHead) {
				// bundleAndUpload should always call buildManifest when given one,
				// so this is defensive — re-derive from the final result.
				enrichedHead = buildEnrichedCollectionHead({
					head: head.manifest,
					enumerated,
					artifactCids: bundleResult.artifactCids,
					newBatch: bundleResult.batch,
					existingBatches,
				});
			}

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

		// Update local manifest with promotion results. On a fresh upload,
		// `enrichedHead` already contains the full batch + artifactRefs + per-
		// segment/layer IPFS CIDs. On resume-from-checkpoint, enrichedHead is
		// null (we never ran buildManifest), so we preserve whatever's in the
		// existing local head — the remote side already wrote the definitive
		// version of the manifest during the prior run.
		if (enrichedHead) {
			await localStore.manifests.putHead(col.name, enrichedHead, head.headId);
		}

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
