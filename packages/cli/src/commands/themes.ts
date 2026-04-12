import type { ThemeSnapshot } from "@wtfoc/common";
import { GreedyClusterer } from "@wtfoc/search";
import type { Command } from "commander";
import type { ExtractorCliOpts, LlmExtractorEnabled } from "../extractor-config.js";
import { resolveExtractorConfig } from "../extractor-config.js";
import {
	type EmbedderOpts,
	getFormat,
	getStore,
	loadCollection,
	withEmbedderOptions,
	withExtractorOptions,
} from "../helpers.js";
import { labelClusters, summarizeNoise } from "../llm-labels.js";
import type { OutputFormat } from "../output.js";

const DEFAULT_DISPLAY_LIMIT = 20;
const DEFAULT_MIN_DISPLAY_SIZE = 3;

/** Source patterns that produce low-signal config/boilerplate clusters. */
const CONFIG_SOURCE_PATTERNS = [
	/package\.json$/i,
	/tsconfig[^/]*\.json$/i,
	/\.lock$/i,
	/package-lock\.json$/i,
	/yarn\.lock$/i,
	/pnpm-lock\.yaml$/i,
	/changelog\.md$/i,
	/\.eslintrc/i,
	/\.prettierrc/i,
	/biome\.json$/i,
];

function isConfigChunk(source: string, sourceType: string): boolean {
	if (sourceType === "config" || sourceType === "lockfile") return true;
	return CONFIG_SOURCE_PATTERNS.some((p) => p.test(source));
}

/** Check if a stored snapshot is still fresh for the current chunk set. */
function isSnapshotFresh(
	snapshot: ThemeSnapshot,
	totalChunks: number,
	filteredCount: number,
	threshold: number,
): boolean {
	return (
		snapshot.totalProcessed === totalChunks &&
		snapshot.filteredConfigChunks === filteredCount &&
		snapshot.threshold === threshold
	);
}

/** Display a theme snapshot in human-readable format. */
function displaySnapshot(
	snapshot: ThemeSnapshot,
	idToContent: Map<string, string>,
	opts: { minSize: number; limit: number; all?: boolean },
): void {
	const sorted = [...snapshot.clusters].sort((a, b) => b.size - a.size);
	const displayClusters = sorted.filter((c) => c.size >= opts.minSize);
	const displayLimit = opts.all ? displayClusters.length : opts.limit;
	const shown = displayClusters.slice(0, displayLimit);

	console.log(
		`Themes: ${snapshot.clusters.length} clusters (showing top ${shown.length} with ${opts.minSize}+ members), ${snapshot.noise.length} noise, ${snapshot.totalProcessed} total\n`,
	);

	for (const cluster of shown) {
		console.log(`--- ${cluster.id}: ${cluster.label} (${cluster.size} chunks) ---`);
		for (const exId of cluster.exemplarIds) {
			const content = idToContent.get(exId) ?? "";
			const snippet = content.slice(0, 120).replace(/\n/g, " ");
			console.log(`  [exemplar] ${snippet}${content.length > 120 ? "..." : ""}`);
		}
		console.log("");
	}

	if (displayClusters.length > shown.length) {
		console.log(
			`(${displayClusters.length - shown.length} more clusters not shown — use --all or -n to see more)`,
		);
	}

	if (snapshot.noiseCategories.length > 0) {
		console.log(`\nNoise breakdown (${snapshot.noise.length} unclustered chunks):`);
		for (const cat of snapshot.noiseCategories) {
			console.log(`  ~${cat.count} ${cat.name}: ${cat.description}`);
		}
	} else {
		console.log(`Noise: ${snapshot.noise.length} unclustered chunks`);
	}
}

export function registerThemesCommand(program: Command): void {
	const cmd = program
		.command("themes")
		.description("Discover theme clusters in a collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("-t, --threshold <number>", "Cosine similarity threshold", "0.72")
		.option("-e, --exemplars <number>", "Max exemplars per cluster", "3")
		.option(
			"--min-size <number>",
			"Minimum cluster size to display",
			String(DEFAULT_MIN_DISPLAY_SIZE),
		)
		.option("--all", "Show all clusters (not just top 20)")
		.option("-n, --limit <number>", "Max clusters to display", String(DEFAULT_DISPLAY_LIMIT))
		.option("--include-config", "Include config/boilerplate chunks in clustering")
		.option("--dry-run", "Compute themes without persisting to the collection manifest")
		.option("--show", "Display persisted themes without re-clustering")
		.option("--force", "Re-compute themes even if a fresh snapshot exists");

	withEmbedderOptions(withExtractorOptions(cmd)).action(
		async (
			opts: {
				collection: string;
				threshold: string;
				exemplars: string;
				minSize: string;
				all?: boolean;
				limit: string;
				includeConfig?: boolean;
				dryRun?: boolean;
				show?: boolean;
				force?: boolean;
			} & ExtractorCliOpts &
				EmbedderOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts()) as OutputFormat;

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			const minDisplaySize = Number.parseInt(opts.minSize, 10);
			const displayOpts = {
				minSize: minDisplaySize,
				limit: Number.parseInt(opts.limit, 10),
				all: opts.all,
			};

			// --show: display persisted snapshot without loading chunks or re-clustering
			if (opts.show) {
				const stored = head.manifest.themes;
				if (!stored) {
					console.error("No persisted themes found. Run without --show to compute them.");
					process.exit(1);
				}
				if (format === "json") {
					console.log(JSON.stringify(stored, null, "\t"));
					return;
				}
				if (format === "quiet") return;

				if (stored.llmModel) {
					console.error(`Themes computed at ${stored.computedAt} (LLM: ${stored.llmModel})`);
				} else {
					console.error(`Themes computed at ${stored.computedAt} (heuristic labels)`);
				}

				// Load chunks only for exemplar display
				const { segments } = await loadCollection(store, head.manifest);
				const idToContent = new Map<string, string>();
				for (const segment of segments) {
					for (const chunk of segment.chunks) {
						if (!idToContent.has(chunk.id)) {
							idToContent.set(chunk.id, chunk.content);
						}
					}
				}
				displaySnapshot(stored, idToContent, displayOpts);
				return;
			}

			if (format === "human") console.error("Loading collection...");
			const { segments } = await loadCollection(store, head.manifest);

			const idToContent = new Map<string, string>();
			const ids: string[] = [];
			const vectors: Float32Array[] = [];
			const contents: string[] = [];
			let filteredCount = 0;

			for (const segment of segments) {
				for (const chunk of segment.chunks) {
					if (idToContent.has(chunk.id)) continue;

					if (!opts.includeConfig && isConfigChunk(chunk.source, chunk.sourceType)) {
						filteredCount++;
						continue;
					}

					idToContent.set(chunk.id, chunk.content);
					ids.push(chunk.id);
					vectors.push(new Float32Array(chunk.embedding));
					contents.push(chunk.content);
				}
			}

			const threshold = Number.parseFloat(opts.threshold);

			// Check if stored snapshot is still fresh (skip expensive recompute)
			const stored = head.manifest.themes;
			if (stored && !opts.force && isSnapshotFresh(stored, ids.length, filteredCount, threshold)) {
				if (format === "human") console.error("Themes are up to date (use --force to recompute).");
				if (format === "json") {
					console.log(JSON.stringify(stored, null, "\t"));
					return;
				}
				if (format === "quiet") return;
				displaySnapshot(stored, idToContent, displayOpts);
				return;
			}

			if (format === "human") {
				const filterMsg = filteredCount > 0 ? `, ${filteredCount} config chunks filtered` : "";
				console.error(`Clustering ${ids.length} chunks (threshold=${threshold}${filterMsg})...`);
			}

			const clusterer = new GreedyClusterer();
			const result = await clusterer.cluster(
				{ ids, vectors, contents },
				{
					threshold,
					maxExemplars: Number.parseInt(opts.exemplars, 10),
				},
			);

			// Resolve extractor config for LLM labeling (auto-enabled when --extractor-url provided)
			const extractorOpts: ExtractorCliOpts = {
				...opts,
				extractorEnabled:
					opts.extractorEnabled ?? !!(opts.extractorUrl ?? process.env.WTFOC_EXTRACTOR_URL),
			};
			const llmConfig = resolveExtractorConfig(extractorOpts);
			const llmLabeled = llmConfig.enabled;

			// LLM post-processing: relabel clusters + summarize noise
			let noiseCategories: Array<{ name: string; count: number; description: string }> = [];
			if (llmConfig.enabled) {
				const enabledConfig = llmConfig as LlmExtractorEnabled;
				if (format === "human") console.error("Generating LLM labels...");

				const clusterRequests = result.clusters.map((c) => ({
					clusterId: c.id,
					exemplarContents: c.exemplarIds
						.map((id) => idToContent.get(id))
						.filter((s): s is string => s !== undefined),
				}));

				const labels = await labelClusters(clusterRequests, enabledConfig);
				for (const cluster of result.clusters) {
					const llmLabel = labels.get(cluster.id);
					if (llmLabel) cluster.label = llmLabel;
				}

				if (result.noise.length > 0) {
					if (format === "human") console.error("Summarizing noise...");
					const noiseContents = result.noise
						.map((id) => idToContent.get(id))
						.filter((s): s is string => s !== undefined);

					noiseCategories = await summarizeNoise(noiseContents, enabledConfig);
				}
			}

			// Build theme snapshot for persistence
			const llmEnabled = llmConfig.enabled ? (llmConfig as LlmExtractorEnabled) : undefined;
			const snapshot: ThemeSnapshot = {
				threshold,
				clusters: result.clusters.map((c) => ({
					id: c.id,
					label: c.label,
					exemplarIds: c.exemplarIds,
					memberIds: c.memberIds,
					size: c.size,
				})),
				noise: result.noise,
				noiseCategories,
				totalProcessed: result.totalProcessed,
				filteredConfigChunks: filteredCount,
				llmLabeled,
				llmModel: llmEnabled?.model,
				llmBaseUrl: llmEnabled?.baseUrl,
				computedAt: new Date().toISOString(),
			};

			// Persist to manifest unless --dry-run
			if (!opts.dryRun) {
				const updatedManifest = {
					...head.manifest,
					themes: snapshot,
					updatedAt: new Date().toISOString(),
				};
				await store.manifests.putHead(opts.collection, updatedManifest, head.headId);
				if (format === "human") console.error("Themes persisted to collection manifest.");
			}

			if (format === "json") {
				console.log(JSON.stringify(snapshot, null, "\t"));
				return;
			}
			if (format === "quiet") return;

			displaySnapshot(snapshot, idToContent, displayOpts);
		},
	);
}
