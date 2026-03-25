import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";
import { formatStatus } from "../output.js";

export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show collection status")
		.requiredOption("-c, --collection <name>", "Collection name")
		.action(async (opts: { collection: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			console.log(
				formatStatus(
					opts.collection,
					{
						totalChunks: head.manifest.totalChunks,
						segments: head.manifest.segments.length,
						embeddingModel: head.manifest.embeddingModel,
						updatedAt: head.manifest.updatedAt,
					},
					format,
				),
			);
		});
}
