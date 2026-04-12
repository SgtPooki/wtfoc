import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";

export function registerDescribeCommand(program: Command): void {
	program
		.command("describe [description]")
		.description("Set or update the description of a collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--clear", "Remove the description")
		.action(
			async (description: string | undefined, opts: { collection: string; clear?: boolean }) => {
				const store = getStore(program);
				const format = getFormat(program.opts());

				if (!opts.clear) {
					const trimmed = description?.trim() ?? "";
					if (trimmed.length === 0) {
						console.error("Error: description is required unless --clear is provided");
						process.exit(1);
					}
					if (trimmed.length > 1024) {
						console.error("Error: description must be 1024 characters or fewer");
						process.exit(1);
					}
					description = trimmed;
				}

				const head = await store.manifests.getHead(opts.collection);
				if (!head) {
					console.error(`Error: collection "${opts.collection}" not found`);
					process.exit(1);
				}

				const updatedManifest = {
					...head.manifest,
					description: opts.clear ? undefined : description,
					prevHeadId: head.headId,
					updatedAt: new Date().toISOString(),
				};

				await store.manifests.putHead(opts.collection, updatedManifest, head.headId);

				if (format === "json") {
					console.log(
						JSON.stringify({
							collection: opts.collection,
							description: updatedManifest.description ?? null,
						}),
					);
				} else if (format === "human") {
					if (opts.clear) {
						console.log(`Cleared description for "${opts.collection}"`);
					} else {
						console.log(`Updated description for "${opts.collection}":\n  ${description}`);
					}
				}
			},
		);
}
