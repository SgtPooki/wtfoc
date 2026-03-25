import { GreedyClusterer } from "@wtfoc/search";
import type { Command } from "commander";
import { getFormat, getStore, loadCollection } from "../helpers.js";

const DEFAULT_DISPLAY_LIMIT = 20;
const DEFAULT_MIN_DISPLAY_SIZE = 3;

export function registerThemesCommand(program: Command): void {
	program
		.command("themes")
		.description("Discover theme clusters in a collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("-t, --threshold <number>", "Cosine similarity threshold", "0.85")
		.option("-e, --exemplars <number>", "Max exemplars per cluster", "3")
		.option(
			"--min-size <number>",
			"Minimum cluster size to display",
			String(DEFAULT_MIN_DISPLAY_SIZE),
		)
		.option("--all", "Show all clusters (not just top 20)")
		.option("-n, --limit <number>", "Max clusters to display", String(DEFAULT_DISPLAY_LIMIT))
		.action(
			async (opts: {
				collection: string;
				threshold: string;
				exemplars: string;
				minSize: string;
				all?: boolean;
				limit: string;
			}) => {
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

				for (const segment of segments) {
					for (const chunk of segment.chunks) {
						if (!idToContent.has(chunk.id)) {
							idToContent.set(chunk.id, chunk.content);
							ids.push(chunk.id);
							vectors.push(new Float32Array(chunk.embedding));
							contents.push(chunk.content);
						}
					}
				}

				const threshold = Number.parseFloat(opts.threshold);
				const minDisplaySize = Number.parseInt(opts.minSize, 10);

				if (format !== "quiet") {
					console.error(`Clustering ${ids.length} chunks (threshold=${threshold})...`);
				}

				const clusterer = new GreedyClusterer();
				const result = await clusterer.cluster(
					{ ids, vectors, contents },
					{
						threshold,
						maxExemplars: Number.parseInt(opts.exemplars, 10),
					},
				);

				// JSON always returns the full, unfiltered result
				if (format === "json") {
					console.log(JSON.stringify(result, null, "\t"));
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
				console.log(`Noise: ${result.noise.length} unclustered chunks`);
			},
		);
}
