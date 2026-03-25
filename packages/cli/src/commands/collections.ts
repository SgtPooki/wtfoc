import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";
import { formatCollections } from "../output.js";

export function registerCollectionsCommand(program: Command): void {
	program
		.command("collections")
		.description("List all collections")
		.action(async () => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const names = await store.manifests.listProjects();

			if (names.length === 0) {
				if (format === "json") {
					console.log(JSON.stringify([]));
				} else if (format !== "quiet") {
					console.log("No collections found.");
				}
				return;
			}

			const collections = await Promise.all(
				names.map(async (name) => {
					const head = await store.manifests.getHead(name);
					if (!head) return null;
					const m = head.manifest;
					return {
						name: m.name,
						chunks: m.totalChunks,
						segments: m.segments.length,
						model: m.embeddingModel,
						updated: m.updatedAt,
					};
				}),
			);

			const valid = collections.filter((c): c is NonNullable<typeof c> => c !== null);

			console.log(formatCollections(valid, format));
		});
}
