import type { CollectionHead, Edge, Segment } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import {
	buildSegment,
	edgeKey,
	mergeOverlayEdges,
	overlayFilePath,
	readOverlayEdges,
	type SegmentChunk,
	writeOverlayEdges,
} from "@wtfoc/ingest";
import type { Command } from "commander";
import { getFormat, getManifestDir, getStore } from "../helpers.js";

export function registerMaterializeEdgesCommand(program: Command): void {
	program
		.command("materialize-edges")
		.description(
			"Bake overlay edges (from extract-edges) into segment data so they persist in FOC storage",
		)
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--dry-run", "Show what would change without writing")
		.action(async (opts: { collection: string; dryRun?: boolean }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			// Load overlay edges
			const manifestDir = getManifestDir(store);
			const overlayPath = overlayFilePath(manifestDir, opts.collection);
			const overlay = await readOverlayEdges(overlayPath);

			if (!overlay || overlay.edges.length === 0) {
				if (format === "human") {
					console.error(
						`No overlay edges found for "${opts.collection}". Run extract-edges first.`,
					);
				}
				return;
			}

			if (format === "human") {
				console.error(
					`🔗 Materializing ${overlay.edges.length} overlay edges into ${head.manifest.segments.length} segments`,
				);
			}

			if (opts.dryRun) {
				// Show which segments would be affected
				let affectedCount = 0;
				for (const segSummary of head.manifest.segments) {
					const segBytes = await store.storage.download(segSummary.id);
					const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					const chunkIds = new Set(segment.chunks.map((c) => c.id));
					const relevantOverlay = overlay.edges.filter((e) => chunkIds.has(e.sourceId));
					if (relevantOverlay.length > 0) {
						affectedCount++;
						console.error(
							`   Segment ${segSummary.id.slice(0, 16)}... → +${relevantOverlay.length} edges`,
						);
					}
				}
				// Also count overlay edges that don't match any segment chunk
				const allChunkIds = new Set<string>();
				for (const segSummary of head.manifest.segments) {
					const segBytes = await store.storage.download(segSummary.id);
					const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					for (const c of segment.chunks) allChunkIds.add(c.id);
				}
				const orphanEdges = overlay.edges.filter((e) => !allChunkIds.has(e.sourceId));
				if (orphanEdges.length > 0) {
					console.error(
						`   ⚠️  ${orphanEdges.length} overlay edges reference chunks not in any segment (will be preserved in overlay)`,
					);
				}
				console.error(`   ${affectedCount} segments would be rebuilt`);
				console.error("   --dry-run: no changes written");
				return;
			}

			// Rebuild each segment with overlay edges merged in
			const newSegmentRefs: CollectionHead["segments"] = [];
			let totalEdgesMerged = 0;

			// Build a map of overlay edges by sourceId for efficient matching
			const overlayBySource = new Map<string, Edge[]>();
			for (const edge of overlay.edges) {
				const list = overlayBySource.get(edge.sourceId) ?? [];
				list.push(edge);
				overlayBySource.set(edge.sourceId, list);
			}

			// Track which overlay edges were placed
			const placedEdgeKeys = new Set<string>();

			for (const segSummary of head.manifest.segments) {
				const segBytes = await store.storage.download(segSummary.id);
				const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;

				// Find overlay edges whose sourceId belongs to this segment
				const chunkIds = new Set(segment.chunks.map((c) => c.id));
				const relevantOverlay: Edge[] = [];
				for (const chunkId of chunkIds) {
					const edges = overlayBySource.get(chunkId);
					if (edges) {
						for (const e of edges) {
							relevantOverlay.push(e);
							placedEdgeKeys.add(edgeKey(e));
						}
					}
				}

				// Merge overlay edges with existing segment edges
				const mergedEdges = mergeOverlayEdges([...segment.edges], relevantOverlay);
				totalEdgesMerged += relevantOverlay.length;

				// Rebuild segment with merged edges
				const segmentChunks: SegmentChunk[] = segment.chunks.map((c) => ({
					chunk: {
						id: c.id,
						content: c.content,
						sourceType: c.sourceType,
						source: c.source,
						sourceUrl: c.sourceUrl,
						timestamp: c.timestamp,
						chunkIndex: 0,
						totalChunks: 0,
						metadata: c.metadata,
					},
					embedding: c.embedding,
					terms: c.terms,
					signalScores: c.signalScores,
				}));

				const newSegment = buildSegment(segmentChunks, mergedEdges, {
					embeddingModel: segment.embeddingModel,
					embeddingDimensions: segment.embeddingDimensions,
				});

				const newSegBytes = new TextEncoder().encode(JSON.stringify(newSegment));
				const result = await store.storage.upload(newSegBytes);

				newSegmentRefs.push({
					id: result.id,
					sourceTypes: segSummary.sourceTypes,
					chunkCount: segSummary.chunkCount,
				});

				if (format === "human") {
					console.error(
						`   ✅ Segment ${segSummary.id.slice(0, 16)}... → ${result.id.slice(0, 16)}... (+${relevantOverlay.length} edges)`,
					);
				}
			}

			// Handle orphan overlay edges (sourceId doesn't match any segment chunk)
			const orphanEdges = overlay.edges.filter((e) => !placedEdgeKeys.has(edgeKey(e)));
			if (orphanEdges.length > 0 && format === "human") {
				console.error(
					`   ⚠️  ${orphanEdges.length} overlay edges couldn't be placed (sourceId not in any segment)`,
				);
			}

			// Update manifest with new segment refs
			const currentHead = await store.manifests.getHead(opts.collection);
			const manifest: CollectionHead = {
				...head.manifest,
				schemaVersion: CURRENT_SCHEMA_VERSION,
				segments: newSegmentRefs,
				updatedAt: new Date().toISOString(),
			};

			await store.manifests.putHead(opts.collection, manifest, currentHead?.headId ?? null);

			// Preserve orphan edges in overlay; clear only successfully placed edges
			await writeOverlayEdges(overlayPath, {
				collectionId: overlay.collectionId,
				edges: orphanEdges,
				createdAt: overlay.createdAt,
				updatedAt: new Date().toISOString(),
			});

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: opts.collection,
						segmentsRebuilt: newSegmentRefs.length,
						edgesMaterialized: totalEdgesMerged,
						orphanEdges: orphanEdges.length,
					}),
				);
			} else if (format === "human") {
				console.error(`\n✅ Materialized ${totalEdgesMerged} overlay edges into segments`);
				console.error(`   ${newSegmentRefs.length} segments rebuilt with merged edges`);
				if (orphanEdges.length > 0) {
					console.error(
						`   ${orphanEdges.length} orphan edges preserved in overlay (sourceId not in any segment)`,
					);
				} else {
					console.error("   Overlay file cleared — ready for promote");
				}
			}
		});
}
