import type { ThemeSnapshot } from "@wtfoc/common";
import { GreedyClusterer } from "@wtfoc/search";
import type { Command } from "commander";
import type { ExtractorCliOpts, LlmExtractorEnabled } from "../extractor-config.js";
import { resolveExtractorConfig } from "../extractor-config.js";
import { getFormat, getStore, loadCollection, withExtractorOptions } from "../helpers.js";
import { labelClusters, summarizeNoise } from "../llm-labels.js";

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
		.option("--dry-run", "Compute themes without persisting to the collection manifest");

	withExtractorOptions(cmd).action(
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
			} & ExtractorCliOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format !== "quiet") console.error("Loading collection...");
			const { segments } = await loadCollection(store, head.manifest);

			const idToContent = new Map<string, string>();
			const ids: string[] = [];
			const vectors: Float32Array[] = [];
			const contents: string[] = [];
			let filteredCount = 0;

			for (const segment of segments) {
				for (const chunk of segment.chunks) {
					if (idToContent.has(chunk.id)) continue;

					// Filter config/boilerplate unless --include-config
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
			const minDisplaySize = Number.parseInt(opts.minSize, 10);

			if (format !== "quiet") {
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
				if (format !== "quiet") console.error("Generating LLM labels...");

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

				// Noise summarization
				if (result.noise.length > 0) {
					if (format !== "quiet") console.error("Summarizing noise...");
					const noiseContents = result.noise
						.map((id) => idToContent.get(id))
						.filter((s): s is string => s !== undefined);

					noiseCategories = await summarizeNoise(noiseContents, enabledConfig);
				}
			}

			// Build theme snapshot for persistence
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
				if (format !== "quiet") console.error("Themes persisted to collection manifest.");
			}

			// JSON always returns the full result
			if (format === "json") {
				console.log(JSON.stringify(snapshot, null, "\t"));
				return;
			}

			// Human output: sort by size, filter by min-size, limit display count
			const sorted = [...result.clusters].sort((a, b) => b.size - a.size);
			const displayClusters = sorted.filter((c) => c.size >= minDisplaySize);
			const displayLimit = opts.all ? displayClusters.length : Number.parseInt(opts.limit, 10);
			const shown = displayClusters.slice(0, displayLimit);

			if (format === "quiet") return;

			console.log(
				`Themes: ${result.clusters.length} clusters (showing top ${shown.length} with ${minDisplaySize}+ members), ${result.noise.length} noise, ${result.totalProcessed} total\n`,
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

			// Noise summary output
			if (noiseCategories.length > 0) {
				console.log(`\nNoise breakdown (${result.noise.length} unclustered chunks):`);
				for (const cat of noiseCategories) {
					console.log(`  ~${cat.count} ${cat.name}: ${cat.description}`);
				}
			} else {
				console.log(`Noise: ${result.noise.length} unclustered chunks`);
			}
		},
	);
}
