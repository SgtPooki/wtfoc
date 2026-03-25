import type { CollectionHead } from "@wtfoc/common";
import { bundleAndUpload, createStore } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat } from "../helpers.js";

export function registerPromoteCommand(program: Command): void {
	program
		.command("promote <collection>")
		.description("Promote a local collection to FOC (Filecoin Onchain Cloud) storage")
		.option("--dry-run", "Show what would be uploaded without uploading")
		.action(async (collectionName: string, opts: { dryRun?: boolean }) => {
			const format = getFormat(program.opts());
			const localStore = createStore({ storage: "local" });

			const head = await localStore.manifests.getHead(collectionName);
			if (!head) {
				console.error(`Error: collection "${collectionName}" not found`);
				process.exit(1);
			}

			// Check if already promoted (has batch records with PieceCIDs)
			// Batch segmentIds may contain either local IDs or IPFS CIDs,
			// so we check both when determining if a segment is already promoted.
			const existingBatches = head.manifest.batches ?? [];
			const alreadyPromotedIds = new Set<string>();
			for (const batch of existingBatches) {
				for (const segId of batch.segmentIds) {
					alreadyPromotedIds.add(segId);
				}
			}

			// Find segments that haven't been promoted yet
			const segmentsToPromote = head.manifest.segments.filter(
				(s) => !alreadyPromotedIds.has(s.id) && (!s.ipfsCid || !alreadyPromotedIds.has(s.ipfsCid)),
			);

			if (segmentsToPromote.length === 0) {
				// All segments already on Filecoin — just upload/re-upload the manifest
				const privateKey = process.env.WTFOC_PRIVATE_KEY;
				if (!privateKey) {
					if (format !== "quiet") {
						console.error(`✅ Collection "${collectionName}" is already fully promoted to FOC.`);
						console.error(
							"   Set WTFOC_PRIVATE_KEY to re-upload the manifest and get a shareable CID.",
						);
					}
					return;
				}

				if (format !== "quiet") {
					console.error(`✅ Segments already on Filecoin. Uploading manifest...`);
				}

				const focStore = createStore({ storage: "foc", privateKey });
				const manifestJson = JSON.stringify(head.manifest);
				const manifestBytes = new TextEncoder().encode(manifestJson);
				const manifestResult = await focStore.storage.upload(manifestBytes);
				const manifestCid = manifestResult.ipfsCid ?? manifestResult.id;

				if (format === "json") {
					console.log(
						JSON.stringify({
							collection: collectionName,
							manifestCid,
							pieceCid: existingBatches[existingBatches.length - 1]?.pieceCid,
							carRootCid: existingBatches[existingBatches.length - 1]?.carRootCid,
							segments: 0,
							chunks: head.manifest.totalChunks,
						}),
					);
				} else if (format !== "quiet") {
					console.error(`   Manifest CID: ${manifestCid}`);
					if (existingBatches.length > 0) {
						const lastBatch = existingBatches[existingBatches.length - 1];
						if (lastBatch) {
							console.error(`   PieceCID: ${lastBatch.pieceCid}`);
							console.error(`   CAR root: ${lastBatch.carRootCid}`);
						}
					}
					console.error(`\n   Share this CID to let anyone query your collection:`);
					console.error(`   ${manifestCid}`);
				}
				return;
			}

			if (format !== "quiet") {
				console.error(`📦 Promoting "${collectionName}" to FOC`);
				console.error(
					`   ${segmentsToPromote.length} segments to upload (${head.manifest.totalChunks} chunks)`,
				);
			}

			if (opts.dryRun) {
				console.error("   --dry-run: skipping upload");
				for (const seg of segmentsToPromote) {
					console.error(
						`   → ${seg.id.slice(0, 16)}... (${seg.chunkCount} chunks, ${seg.sourceTypes.join(", ")})`,
					);
				}
				return;
			}

			// Create FOC storage backend
			const privateKey = process.env.WTFOC_PRIVATE_KEY;
			if (!privateKey) {
				console.error("Error: WTFOC_PRIVATE_KEY environment variable required for FOC upload.");
				console.error("  Set it to your wallet private key (0x...)");
				process.exit(1);
			}

			const focStore = createStore({ storage: "foc", privateKey });

			// Download each segment from local storage and prepare for bundling
			const bundleSegments: import("@wtfoc/ingest").SegmentChunk[] extends never
				? { id: string; data: Uint8Array }[]
				: { id: string; data: Uint8Array }[] = [];

			for (const seg of segmentsToPromote) {
				if (format !== "quiet") {
					console.error(`   ⏳ Reading segment ${seg.id.slice(0, 16)}...`);
				}
				const data = await localStore.storage.download(seg.id);
				bundleSegments.push({ id: seg.id, data });
			}

			// Bundle and upload to FOC
			if (format !== "quiet") {
				console.error("   ⏳ Bundling into CAR and uploading to FOC...");
			}

			const bundleResult = await bundleAndUpload(bundleSegments, focStore.storage);

			// Update manifest with CID info
			const updatedSegments = head.manifest.segments.map((seg) => {
				const cid = bundleResult.segmentCids.get(seg.id);
				if (cid) {
					return { ...seg, ipfsCid: cid };
				}
				return seg;
			});

			const updatedManifest: CollectionHead = {
				...head.manifest,
				segments: updatedSegments,
				batches: [...existingBatches, bundleResult.batch],
				updatedAt: new Date().toISOString(),
			};

			// Upload manifest JSON to Filecoin so it can be resolved by CID
			if (format !== "quiet") {
				console.error("   ⏳ Uploading manifest to Filecoin...");
			}

			const manifestJson = JSON.stringify(updatedManifest);
			const manifestBytes = new TextEncoder().encode(manifestJson);
			const manifestResult = await focStore.storage.upload(manifestBytes);
			const manifestCid = manifestResult.ipfsCid ?? manifestResult.id;

			// Write updated manifest back to local store
			await localStore.manifests.putHead(collectionName, updatedManifest, head.headId);

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: collectionName,
						manifestCid,
						pieceCid: bundleResult.batch.pieceCid,
						carRootCid: bundleResult.batch.carRootCid,
						segments: segmentsToPromote.length,
						chunks: head.manifest.totalChunks,
					}),
				);
			} else if (format !== "quiet") {
				console.error(`\n✅ Promoted "${collectionName}" to FOC`);
				console.error(`   Manifest CID: ${manifestCid}`);
				console.error(`   PieceCID: ${bundleResult.batch.pieceCid}`);
				console.error(`   CAR root: ${bundleResult.batch.carRootCid}`);
				console.error(`   ${segmentsToPromote.length} segments uploaded`);
				console.error(`   Local manifest updated with IPFS CIDs`);
				console.error(`\n   Share this CID to let anyone query your collection:`);
				console.error(`   ${manifestCid}`);
			}
		});
}
