import { createHash } from "node:crypto";
import type { CollectionHead, PublishedArtifactRef } from "@wtfoc/common";
import {
	buildEnrichedCollectionHead,
	enumeratePromotableArtifacts,
	loadAllOverlayEdges,
	type PromotableArtifact,
} from "@wtfoc/ingest";
import {
	type BundleArtifact,
	bundleAndUpload,
	createStore,
	validateIpniIndexing,
} from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat, getManifestDir } from "../helpers.js";

const DEFAULT_COPIES = 2;

interface PromoteOptions {
	dryRun?: boolean;
	copies?: string;
	force?: boolean;
}

export function registerPromoteCommand(program: Command): void {
	program
		.command("promote <collection>")
		.description("Promote a local collection to FOC (Filecoin Onchain Cloud) storage")
		.option("--dry-run", "Show what would be uploaded without uploading")
		.option("--copies <n>", "Number of storage copies for redundancy", String(DEFAULT_COPIES))
		.option(
			"--force",
			"Re-publish even when existing artifactRefs[] already cover every current artifact.",
		)
		.action(async (collectionName: string, opts: PromoteOptions) => {
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

			// Overlay edges must be materialized before promote — otherwise they
			// don't exist as a blob to ship.
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

			// Enumerate every artifact that must travel with the collection.
			// Includes: segments, derived edge layers, raw-source-index sidecar,
			// raw-source blobs, document-catalog sidecar. Enumeration is the
			// single source of truth — same helper is used by the web promote
			// worker.
			const enumerated: Array<{ artifact: PromotableArtifact; bytes: Uint8Array }> = [];
			let totalArtifactBytes = 0;
			for await (const artifact of enumeratePromotableArtifacts(
				head.manifest,
				collectionName,
				manifestDir,
				(storageId) => localStore.storage.download(storageId),
			)) {
				const bytes = await artifact.getBytes();
				totalArtifactBytes += bytes.length;
				enumerated.push({ artifact, bytes });
			}

			if (enumerated.length === 0) {
				console.error(`Error: collection "${collectionName}" has no artifacts to promote`);
				process.exit(1);
			}

			// Self-containment-aware short-circuit: if the local manifest already
			// carries `artifactRefs[]` covering every currently-enumerated artifact
			// with matching identity, skip upload entirely — we'd just re-publish
			// the same bytes and bump a batch timestamp for no content change.
			// User can still force a re-publish with --force.
			const coverage = computeArtifactCoverage(head.manifest.artifactRefs, enumerated);
			if (coverage.fullyCovered && !opts.force) {
				const lastManifestCid = head.manifest.batches?.at(-1)?.carRootCid;
				if (format === "human") {
					console.error(`✅ Collection "${collectionName}" is already fully promoted.`);
					console.error(
						`   ${enumerated.length} artifacts covered by existing artifactRefs[] with matching content.`,
					);
					if (lastManifestCid) {
						console.error(`   Last CAR root: ${lastManifestCid}`);
					}
					console.error(`   Re-run with --force to re-publish anyway.`);
				}
				if (format === "json") {
					console.log(
						JSON.stringify({
							collection: collectionName,
							skipped: true,
							reason: "already-promoted",
							artifacts: enumerated.length,
							lastCarRootCid: lastManifestCid,
						}),
					);
				}
				return;
			}

			if (format === "human") {
				const kindCounts = countKinds(enumerated.map((e) => e.artifact));
				console.error(`📦 Promoting "${collectionName}" to FOC`);
				console.error(
					`   ${enumerated.length} artifacts (${formatBytes(totalArtifactBytes)}): ${describeKindCounts(kindCounts)}`,
				);
				if (coverage.partialCount > 0 && !coverage.fullyCovered) {
					console.error(
						`   ${coverage.partialCount}/${enumerated.length} already covered by existing artifactRefs — re-uploading full set (content-addressed, so identical blobs dedupe at the storage layer).`,
					);
				}
				console.error(`   ${copies} storage copies for redundancy`);
			}

			if (opts.dryRun) {
				console.error("   --dry-run: skipping upload");
				for (const { artifact, bytes } of enumerated) {
					console.error(
						`   → ${artifact.kind.padEnd(18)} ${artifact.id.slice(0, 24).padEnd(24)} (${formatBytes(bytes.length)}) [${artifact.carPath}]`,
					);
				}
				return;
			}

			// FOC credentials
			const privateKey = process.env.WTFOC_PRIVATE_KEY;
			if (!privateKey) {
				console.error("Error: WTFOC_PRIVATE_KEY environment variable required for FOC upload.");
				console.error("  Set it to your wallet private key (0x...)");
				process.exit(1);
			}

			const focStore = createStore({ storage: "foc", privateKey });

			const bundleArtifacts: BundleArtifact[] = enumerated.map(({ artifact, bytes }) => ({
				id: artifact.id,
				data: bytes,
				path: artifact.carPath,
				mediaType: artifact.kind === "sidecar" ? "application/json" : undefined,
			}));

			if (format === "human") {
				console.error("   ⏳ Bundling + uploading to FOC (single CAR)...");
			}

			const existingBatches = head.manifest.batches ?? [];

			// Capture the exact manifest built inside `buildManifest` — the one
			// that gets uploaded inside the CAR — so the local manifest is
			// byte-identical. Rebuilding after bundleAndUpload uses a different
			// `batch.createdAt` (the bundler's internal timestamp) which would
			// make the two manifests diverge.
			let enrichedHead: CollectionHead | null = null;

			const bundleResult = await bundleAndUpload(bundleArtifacts, focStore.storage, {
				copies,
				buildManifest({ artifactCids, pieceCid, carRootCid }) {
					const built = buildEnrichedCollectionHead({
						head: head.manifest,
						enumerated,
						artifactCids,
						newBatch: {
							pieceCid,
							carRootCid,
							segmentIds: bundleArtifacts.map((a) => artifactCids.get(a.id) ?? a.id),
							createdAt: new Date().toISOString(),
						},
						existingBatches,
					});
					enrichedHead = built;
					return built;
				},
			});

			const manifestCid = bundleResult.manifestCid;
			if (!enrichedHead) {
				throw new Error(
					"BUG: bundleAndUpload did not invoke buildManifest — cannot write local manifest",
				);
			}

			await localStore.manifests.putHead(collectionName, enrichedHead, head.headId);

			// IPNI indexing check — how many of the published CIDs have propagated
			// to the IPNI (InterPlanetary Network Indexer)?
			if (format === "human") {
				console.error("   ⏳ Validating IPNI indexing...");
			}

			const cidsToValidate = bundleResult.childBlockCids;
			const ipniResults = await validateIpniIndexing(cidsToValidate);
			const indexed = ipniResults.filter((r) => r.indexed).length;
			const notIndexed = ipniResults.filter((r) => !r.indexed);

			const artifactKindCounts = countKinds(enumerated.map((e) => e.artifact));

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: collectionName,
						manifestCid,
						pieceCid: bundleResult.batch.pieceCid,
						carRootCid: bundleResult.batch.carRootCid,
						artifacts: enumerated.length,
						artifactBytes: totalArtifactBytes,
						artifactKinds: artifactKindCounts,
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
				console.error(
					`   ${enumerated.length} artifacts uploaded (${describeKindCounts(artifactKindCounts)}, ${copies} copies)`,
				);
				console.error(`   IPNI: ${indexed}/${cidsToValidate.length} CIDs indexed`);
				if (notIndexed.length > 0) {
					console.error(
						`   ⚠️  ${notIndexed.length} CIDs not yet indexed on IPNI (may take time to propagate)`,
					);
				}
				console.error(`   Local manifest updated with artifact refs + IPFS CIDs`);
				if (manifestCid) {
					console.error(`\n   Share this CID to let anyone query your collection:`);
					console.error(`   ${manifestCid}`);
				}
			}

			// synapse-sdk keeps HTTP connections alive with no cleanup method
			process.exit(0);
		});
}

function countKinds(artifacts: PromotableArtifact[]): Record<PromotableArtifact["kind"], number> {
	const counts = {
		segment: 0,
		"derived-edge-layer": 0,
		"raw-source-blob": 0,
		sidecar: 0,
	} as Record<PromotableArtifact["kind"], number>;
	for (const a of artifacts) counts[a.kind] += 1;
	return counts;
}

function describeKindCounts(counts: Record<string, number>): string {
	return Object.entries(counts)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
		.join(", ");
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

interface ArtifactCoverage {
	/** True when every currently-enumerated artifact is already in artifactRefs[] with matching identity. */
	fullyCovered: boolean;
	/** Number of enumerated artifacts that match an existing ref. */
	partialCount: number;
}

/**
 * Check whether the local manifest's existing `artifactRefs[]` (from a prior
 * promote) already cover every artifact we'd publish now.
 *
 * Coverage rules:
 * - For blob kinds (segment / derived-edge-layer / raw-source-blob), match on
 *   `storageId` — if the same storageId is in artifactRefs[] as the same kind,
 *   the blob is already published (content-addressed identity guarantees
 *   bytes are the same).
 * - For sidecars, match on `role` + matching `sha256` against the current
 *   artifact bytes. A sidecar changes whenever its source JSON changes.
 *
 * Returns `fullyCovered: true` only when every enumerated artifact is matched
 * AND there are no stale refs in artifactRefs[] that don't correspond to a
 * current artifact. Without the second check, a collection that shrinks
 * (segment removed, sidecar deleted, etc.) would short-circuit incorrectly
 * because old refs form a superset of the new artifact set.
 */
function computeArtifactCoverage(
	existingRefs: PublishedArtifactRef[] | undefined,
	enumerated: Array<{ artifact: PromotableArtifact; bytes: Uint8Array }>,
): ArtifactCoverage {
	if (!existingRefs || existingRefs.length === 0) {
		return { fullyCovered: false, partialCount: 0 };
	}

	const blobStorageIdsByKind = new Map<
		Exclude<PublishedArtifactRef["kind"], "sidecar">,
		Set<string>
	>();
	const sidecarShaByRole = new Map<string, string>();

	for (const ref of existingRefs) {
		switch (ref.kind) {
			case "segment":
			case "derived-edge-layer":
			case "raw-source-blob": {
				const set = blobStorageIdsByKind.get(ref.kind) ?? new Set<string>();
				set.add(ref.storageId);
				blobStorageIdsByKind.set(ref.kind, set);
				break;
			}
			case "sidecar":
				sidecarShaByRole.set(ref.role, ref.sha256);
				break;
		}
	}

	let partialCount = 0;
	for (const { artifact, bytes } of enumerated) {
		if (artifact.kind === "sidecar") {
			const role = artifact.metadata.kind === "sidecar" ? artifact.metadata.role : undefined;
			if (!role) continue;
			const expected = sidecarShaByRole.get(role);
			if (expected && expected === sha256Hex(bytes)) partialCount += 1;
		} else {
			const ids = blobStorageIdsByKind.get(artifact.kind);
			if (ids?.has(artifact.id)) partialCount += 1;
		}
	}

	// Exact-set coverage: every enumerated artifact is matched AND there are
	// no extra refs in the existing manifest. Counts equal rules out the
	// shrinking-set case where refs are a superset.
	const fullyCovered =
		partialCount === enumerated.length && existingRefs.length === enumerated.length;

	return {
		fullyCovered,
		partialCount,
	};
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
