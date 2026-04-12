import type { CollectionHead, DerivedEdgeLayerSummary, Segment } from "@wtfoc/common";
import { compactDerivedLayers, parseDerivedEdgeLayer } from "@wtfoc/ingest";
import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";

export function registerCompactEdgesCommand(program: Command): void {
	program
		.command("compact-edges")
		.description(
			"Compact derived edge layers into a single canonical layer, deduplicating and dropping stale edges",
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

			const layers = head.manifest.derivedEdgeLayers ?? [];
			if (layers.length === 0) {
				if (format !== "quiet") {
					console.error("No derived edge layers to compact.");
				}
				return;
			}

			if (layers.length === 1 && !opts.dryRun) {
				if (format !== "quiet") {
					console.error("Only 1 layer — nothing to compact.");
				}
				return;
			}

			if (format !== "quiet") {
				console.error(`⏳ Loading ${layers.length} derived edge layers...`);
			}

			// Load all layers
			const loadedLayers = [];
			for (const ref of layers) {
				const data = await store.storage.download(ref.id);
				loadedLayers.push(parseDerivedEdgeLayer(data));
			}

			// Build valid chunk ID set from segments
			if (format !== "quiet") {
				console.error("⏳ Loading segments to validate chunk references...");
			}
			const validChunkIds = new Set<string>();
			for (const segSummary of head.manifest.segments) {
				try {
					const segBytes = await store.storage.download(segSummary.id);
					const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					for (const c of seg.chunks) {
						validChunkIds.add(c.id);
					}
				} catch {
					// Skip undownloadable segments
				}
			}

			// Compact
			const { layer: compacted, stats } = compactDerivedLayers(
				loadedLayers,
				validChunkIds,
				head.manifest.collectionId,
			);

			if (format !== "quiet") {
				console.error(`\n📊 Compaction results:`);
				console.error(`   Input: ${stats.inputLayers} layers, ${stats.inputEdges} edges`);
				console.error(`   Output: 1 layer, ${stats.outputEdges} edges`);
				console.error(
					`   Dropped: ${stats.droppedOrphan} orphan, ${stats.droppedDuplicate} duplicate`,
				);
			}

			if (opts.dryRun) {
				console.error("   --dry-run: no changes written");
				if (format === "json") {
					console.log(JSON.stringify(stats));
				}
				return;
			}

			// Store compacted layer
			const layerBytes = new TextEncoder().encode(JSON.stringify(compacted));
			const result = await store.storage.upload(layerBytes);

			const layerSummary: DerivedEdgeLayerSummary = {
				id: result.id,
				extractorModel: compacted.extractorModel,
				edgeCount: compacted.edges.length,
				createdAt: compacted.createdAt,
				contextsProcessed: compacted.contextsProcessed,
			};

			// Replace all layers with the single compacted one
			const currentHead = await store.manifests.getHead(opts.collection);
			if (currentHead) {
				const manifest: CollectionHead = {
					...currentHead.manifest,
					derivedEdgeLayers: [layerSummary],
					updatedAt: new Date().toISOString(),
				};
				await store.manifests.putHead(opts.collection, manifest, currentHead.headId);
			}

			if (format !== "quiet") {
				console.error(`\n✅ Compacted to 1 layer: ${result.id.slice(0, 16)}...`);
			}

			if (format === "json") {
				console.log(
					JSON.stringify({
						collection: opts.collection,
						...stats,
						compactedLayerId: result.id,
					}),
				);
			}
		});
}
