import type { CollectionHead } from "@wtfoc/common";
import { loadAllOverlayEdges } from "@wtfoc/ingest";
import { bundleAndUpload, createStore, validateIpniIndexing } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat, getManifestDir } from "../helpers.js";

const DEFAULT_COPIES = 2;

export function registerPromoteCommand(program: Command): void {
	program
		.command("promote <collection>")
		.description("Promote a local collection to FOC (Filecoin Onchain Cloud) storage")
		.option("--dry-run", "Show what would be uploaded without uploading")
		.option("--copies <n>", "Number of storage copies for redundancy", String(DEFAULT_COPIES))
		.action(async (collectionName: string, opts: { dryRun?: boolean; copies?: string }) => {
			const format = getFormat(program.opts());
			const rawCopies = Number(opts.copies ?? DEFAULT_COPIES);
			if (!Number.isFinite(rawCopies) || rawCopies < 1 || !Number.isInteger(rawCopies)) {
				console.error(`Error: --copies must be a positive integer, got "${opts.copies}"`);
				process.exit(2);
			}
			const copies = rawCopies;
			const localStore = createStore({ storage: "local" });

			const head = await localStore.manifests.getHead(collectionName);
			if (!head) {
				console.error(`Error: collection "${collectionName}" not found`);
				process.exit(1);
			}

			// Check for pending overlay edges that should be materialized before promote
			const manifestDir = getManifestDir(localStore);
			const allOverlayEdges = await loadAllOverlayEdges(manifestDir, collectionName);
			if (allOverlayEdges.length > 0) {
				console.error(
					`⚠️  ${allOverlayEdges.length} overlay edges from extract-edges have not been materialized.`,
				);
				console.error(
					"   These edges will NOT be included in the promoted data unless you materialize first:",
				);
				console.error(`   wtfoc materialize-edges -c ${collectionName}`);
				console.error("");
				console.error("   Proceeding with promote without overlay edges...");
				console.error("");
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
					if (format === "human") {
						console.error(`✅ Collection "${collectionName}" is already fully promoted to FOC.`);
						console.error(
							"   Set WTFOC_PRIVATE_KEY to re-upload the manifest and get a shareable CID.",
						);
					}
					return;
				}

				if (format === "human") {
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
				} else if (format === "human") {
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
				// synapse-sdk keeps HTTP connections alive with no cleanup method
				process.exit(0);
			}

			if (format === "human") {
				console.error(`📦 Promoting "${collectionName}" to FOC`);
				console.error(
					`   ${segmentsToPromote.length} segments to upload (${head.manifest.totalChunks} chunks)`,
				);
				console.error(`   ${copies} storage copies for redundancy`);
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
			const bundleSegments: { id: string; data: Uint8Array }[] = [];

			for (const seg of segmentsToPromote) {
				if (format === "human") {
					console.error(`   ⏳ Reading segment ${seg.id.slice(0, 16)}...`);
				}
				const data = await localStore.storage.download(seg.id);
				bundleSegments.push({ id: seg.id, data });
			}

			if (format === "human") {
				console.error("   ⏳ Bundling segments + manifest into CAR and uploading to FOC...");
			}

			const bundleResult = await bundleAndUpload(bundleSegments, focStore.storage, {
				copies,
				buildManifest({ segmentCids, pieceCid, carRootCid }) {
					const updatedSegments = head.manifest.segments.map((seg) => {
						const cid = segmentCids.get(seg.id);
						if (cid) {
							return { ...seg, ipfsCid: cid };
						}
						return seg;
					});

					return {
						...head.manifest,
						segments: updatedSegments,
						batches: [
							...existingBatches,
							{
								pieceCid,
								carRootCid,
								segmentIds: bundleSegments.map((s) => {
									const cid = segmentCids.get(s.id);
									return cid ?? s.id;
								}),
								createdAt: new Date().toISOString(),
							},
						],
						updatedAt: new Date().toISOString(),
					};
				},
			});

			const manifestCid = bundleResult.manifestCid;

			// Build local manifest using the same data as the CAR manifest.
			// bundleResult.batch has the same pieceCid/carRootCid that
			// buildManifest received, so local and CAR manifests stay in sync.
			const finalManifest: CollectionHead = {
				...head.manifest,
				segments: head.manifest.segments.map((seg) => {
					const cid = bundleResult.segmentCids.get(seg.id);
					if (cid) return { ...seg, ipfsCid: cid };
					return seg;
				}),
				batches: [...existingBatches, bundleResult.batch],
				updatedAt: bundleResult.batch.createdAt,
			};

			// Write updated manifest back to local store
			await localStore.manifests.putHead(collectionName, finalManifest, head.headId);

			// Post-upload IPNI validation
			if (format === "human") {
				console.error("   ⏳ Validating IPNI indexing...");
			}

			const cidsToValidate = bundleResult.childBlockCids;
			const ipniResults = await validateIpniIndexing(cidsToValidate);
			const indexed = ipniResults.filter((r) => r.indexed).length;
			const notIndexed = ipniResults.filter((r) => !r.indexed);

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: collectionName,
						manifestCid,
						pieceCid: bundleResult.batch.pieceCid,
						carRootCid: bundleResult.batch.carRootCid,
						segments: segmentsToPromote.length,
						chunks: head.manifest.totalChunks,
						copies,
						ipniValidation: {
							total: cidsToValidate.length,
							indexed,
							notIndexed: notIndexed.length,
						},
					}),
				);
			} else if (format === "human") {
				console.error(`\n✅ Promoted "${collectionName}" to FOC`);
				if (manifestCid) {
					console.error(`   Manifest CID: ${manifestCid}`);
				}
				console.error(`   PieceCID: ${bundleResult.batch.pieceCid}`);
				console.error(`   CAR root: ${bundleResult.batch.carRootCid}`);
				console.error(`   ${segmentsToPromote.length} segments uploaded (${copies} copies)`);
				console.error(`   IPNI: ${indexed}/${cidsToValidate.length} CIDs indexed`);
				if (notIndexed.length > 0) {
					console.error(
						`   ⚠️  ${notIndexed.length} CIDs not yet indexed on IPNI (may take time to propagate)`,
					);
				}
				console.error(`   Local manifest updated with IPFS CIDs`);
				if (manifestCid) {
					console.error(`\n   Share this CID to let anyone query your collection:`);
					console.error(`   ${manifestCid}`);
				}
			}

			// synapse-sdk keeps HTTP connections alive with no cleanup method
			process.exit(0);
		});
}
