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
			const existingBatches = head.manifest.batches ?? [];
			const alreadyPromotedSegments = new Set<string>();
			for (const batch of existingBatches) {
				for (const segId of batch.segmentIds) {
					alreadyPromotedSegments.add(segId);
				}
			}

			// Find segments that haven't been promoted yet
			const segmentsToPromote = head.manifest.segments.filter(
				(s) => !s.ipfsCid || !alreadyPromotedSegments.has(s.ipfsCid),
			);

			if (segmentsToPromote.length === 0) {
				if (format !== "quiet") {
					console.error(`✅ Collection "${collectionName}" is already fully promoted to FOC.`);
					if (existingBatches.length > 0) {
						const lastBatch = existingBatches[existingBatches.length - 1];
						if (lastBatch) {
							console.error(`   PieceCID: ${lastBatch.pieceCid}`);
							console.error(`   CAR root: ${lastBatch.carRootCid}`);
						}
					}
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

			// Write updated manifest back to local store
			await localStore.manifests.putHead(collectionName, updatedManifest, head.headId);

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: collectionName,
						pieceCid: bundleResult.batch.pieceCid,
						carRootCid: bundleResult.batch.carRootCid,
						segments: segmentsToPromote.length,
						chunks: head.manifest.totalChunks,
					}),
				);
			} else if (format !== "quiet") {
				console.error(`\n✅ Promoted "${collectionName}" to FOC`);
				console.error(`   PieceCID: ${bundleResult.batch.pieceCid}`);
				console.error(`   CAR root: ${bundleResult.batch.carRootCid}`);
				console.error(`   ${segmentsToPromote.length} segments uploaded`);
				console.error(`   Local manifest updated with IPFS CIDs`);
			}
		});
}
