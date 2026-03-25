import { GreedyClusterer } from "@wtfoc/search";
import type { Command } from "commander";
import { getFormat, getStore, loadCollection } from "../helpers.js";
import type { OutputFormat } from "../output.js";

export function registerThemesCommand(program: Command): void {
	program
		.command("themes")
		.description("Discover theme clusters in a collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("-t, --threshold <number>", "Cosine similarity threshold", "0.85")
		.option("-e, --exemplars <number>", "Max exemplars per cluster", "3")
		.action(async (opts: { collection: string; threshold: string; exemplars: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format !== "quiet") console.error("Loading collection...");
			const { segments } = await loadCollection(store, head.manifest);

			// Build lookup maps from segments
			const idToContent = new Map<string, string>();
			const idToVector = new Map<string, Float32Array>();

			for (const segment of segments) {
				for (const chunk of segment.chunks) {
					idToContent.set(chunk.id, chunk.content);
					idToVector.set(chunk.id, new Float32Array(chunk.embedding));
				}
			}

			const ids: string[] = [];
			const vectors: Float32Array[] = [];
			const contents: string[] = [];

			for (const [id, content] of idToContent) {
				const vec = idToVector.get(id);
				if (!vec) continue;
				ids.push(id);
				vectors.push(vec);
				contents.push(content);
			}

			if (format !== "quiet") {
				console.error(`Clustering ${ids.length} chunks (threshold=${opts.threshold})...`);
			}

			const clusterer = new GreedyClusterer();
			const result = await clusterer.cluster(
				{ ids, vectors, contents },
				{
					threshold: Number.parseFloat(opts.threshold),
					maxExemplars: Number.parseInt(opts.exemplars, 10),
				},
			);

			console.log(formatThemes(result, contents, idToContent, format));
		});
}

function formatThemes(
	result: {
		clusters: Array<{
			id: string;
			label: string;
			exemplarIds: string[];
			memberIds: string[];
			size: number;
		}>;
		noise: string[];
		totalProcessed: number;
	},
	_contents: string[],
	idToContent: Map<string, string>,
	format: OutputFormat,
): string {
	if (format === "json") return JSON.stringify(result, null, "\t");
	if (format === "quiet") return "";

	const lines: string[] = [];
	lines.push(
		`Themes: ${result.clusters.length} clusters, ${result.noise.length} noise, ${result.totalProcessed} total\n`,
	);

	for (const cluster of result.clusters) {
		lines.push(`--- ${cluster.id}: ${cluster.label} (${cluster.size} chunks) ---`);

		for (const exId of cluster.exemplarIds) {
			const content = idToContent.get(exId) ?? "";
			const snippet = content.slice(0, 120).replace(/\n/g, " ");
			lines.push(`  [exemplar] ${snippet}${content.length > 120 ? "..." : ""}`);
		}
		lines.push("");
	}

	if (result.noise.length > 0) {
		lines.push(`Noise: ${result.noise.length} unclustered chunks`);
	}

	return lines.join("\n");
}
