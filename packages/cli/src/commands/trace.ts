import {
	catalogFilePath,
	getSupersededChunkIds,
	loadAllOverlayEdges,
	loadDerivedEdgeLayers,
	readCatalog,
} from "@wtfoc/ingest";
import { type TraceMode, type TraceView, trace } from "@wtfoc/search";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getManifestDir,
	getStore,
	loadCollection,
	withEmbedderOptions,
} from "../helpers.js";
import { formatTrace } from "../output.js";

export function registerTraceCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("trace <query>")
			.description("Trace evidence-backed connections across sources")
			.requiredOption("-c, --collection <name>", "Collection name")
			.option(
				"--mode <mode>",
				'Trace mode: "discovery" (default) or "analytical" (adds cross-source insights)',
				"discovery",
			)
			.option("--max-total <number>", "Max total results (default: 15)")
			.option("--max-per-source <number>", "Max results per source type (default: 3)")
			.option("--max-hops <number>", "Max edge hops to follow (default: 3)")
			.option("--exclude <types...>", "Exclude source types (e.g. github-pr-comment)")
			.option("--include <types...>", "Only include these source types")
			.option(
				"--view <view>",
				'Output view: "lineage", "timeline", or "evidence" (default: lineage for analytical, evidence for discovery)',
			),
	).action(
		async (
			queryText: string,
			opts: {
				collection: string;
				mode: string;
				view?: string;
				maxTotal?: string;
				maxPerSource?: string;
				maxHops?: string;
				exclude?: string[];
				include?: string[];
			} & EmbedderOpts,
		) => {
			const validModes: TraceMode[] = ["discovery", "analytical"];
			if (!validModes.includes(opts.mode as TraceMode)) {
				console.error(
					`Error: invalid trace mode "${opts.mode}". Must be one of: ${validModes.join(", ")}`,
				);
				process.exit(2);
			}
			// Safe after validation above
			const mode: TraceMode = opts.mode === "analytical" ? "analytical" : "discovery";

			// Resolve view: explicit --view overrides mode default
			const validViews: TraceView[] = ["lineage", "timeline", "evidence"];
			if (opts.view && !validViews.includes(opts.view as TraceView)) {
				console.error(
					`Error: invalid trace view "${opts.view}". Must be one of: ${validViews.join(", ")}`,
				);
				process.exit(2);
			}
			const view: TraceView =
				(opts.view as TraceView) ?? (mode === "analytical" ? "lineage" : "evidence");

			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format === "human") console.error("⏳ Loading embedder + index...");
			const { embedder } = createEmbedder(opts, getProjectConfig()?.embedder);

			// Load document catalog — trace includes archived chunks for historical context
			// but excludes superseded chunks (replaced by newer versions)
			const manifestDir = getManifestDir(store);
			const catPath = catalogFilePath(manifestDir, opts.collection);
			const catalog = await readCatalog(catPath);
			const supersededIds = catalog ? getSupersededChunkIds(catalog) : undefined;

			const { vectorIndex, segments } = await loadCollection(store, head.manifest, {
				excludeChunkIds: supersededIds?.size ? supersededIds : undefined,
			});

			// Load derived edge layers from manifest (immutable, versioned)
			const derivedLayers = head.manifest.derivedEdgeLayers ?? [];
			let derivedEdges: import("@wtfoc/common").Edge[] = [];
			if (derivedLayers.length > 0) {
				derivedEdges = await loadDerivedEdgeLayers(derivedLayers, (id, s) =>
					store.storage.download(id, s),
				);
				if (format === "human") {
					console.error(
						`🔗 Loaded ${derivedEdges.length} edges from ${derivedLayers.length} derived layer(s)`,
					);
				}
			}

			// Fall back to extractor overlays if no derived layers exist
			if (derivedEdges.length === 0) {
				derivedEdges = await loadAllOverlayEdges(manifestDir, opts.collection);
				if (derivedEdges.length > 0 && format === "human") {
					console.error(`🔗 Loaded ${derivedEdges.length} overlay edges`);
				}
			}
			const overlayEdges = derivedEdges;

			// Check dimension compatibility before querying (skip if dimensions unknown yet)
			const collectionDims = head.manifest.embeddingDimensions;
			let embedderDims = 0;
			try {
				embedderDims = embedder.dimensions;
			} catch {
				/* dimensions auto-detected on first call */
			}
			if (collectionDims > 0 && embedderDims > 0 && collectionDims !== embedderDims) {
				console.error(
					`\n❌ Dimension mismatch: collection uses ${collectionDims}d embeddings but your embedder produces ${embedder.dimensions}d.`,
				);
				console.error(`   Collection was embedded with: ${head.manifest.embeddingModel}`);
				console.error(`\n   To query this collection, use the same embedder:`);
				console.error(
					`   ./wtfoc trace "${queryText}" -c ${opts.collection} --embedder-url lmstudio --embedder-model ${head.manifest.embeddingModel}`,
				);
				console.error(`\n   Or re-index with your current embedder (not yet supported).`);
				process.exit(1);
			}

			const maxTotal = opts.maxTotal ? Number.parseInt(opts.maxTotal, 10) : undefined;
			const maxPerSource = opts.maxPerSource ? Number.parseInt(opts.maxPerSource, 10) : undefined;
			const maxHops = opts.maxHops ? Number.parseInt(opts.maxHops, 10) : undefined;

			try {
				const result = await trace(queryText, embedder, vectorIndex, segments, {
					mode,
					overlayEdges,
					maxTotal,
					maxPerSource,
					maxHops,
					excludeSourceTypes: opts.exclude,
					includeSourceTypes: opts.include,
				});
				console.log(formatTrace(result, format, view));
			} catch (err) {
				if (
					err instanceof Error &&
					"code" in err &&
					(err as { code: string }).code === "VECTOR_DIMENSION_MISMATCH"
				) {
					console.error(`\n❌ ${err.message}`);
					console.error(
						`   Collection model: ${head.manifest.embeddingModel} (${collectionDims}d)`,
					);
					console.error(`   Use --embedder to match the collection's model.`);
					process.exit(1);
				}
				throw err;
			}
		},
	);
}
