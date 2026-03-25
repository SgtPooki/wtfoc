import { type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import { getStore } from "../helpers.js";

export function registerInitCommand(program: Command): void {
	program
		.command("init <name>")
		.description("Create a new wtfoc project")
		.option("--local", "Use local storage (default)")
		.option("--foc", "Use FOC storage")
		.action(async (name: string) => {
			const store = getStore(program);

			const manifest: CollectionHead = {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				collectionId: generateCollectionId(name),
				name,
				currentRevisionId: null,
				prevHeadId: null,
				segments: [],
				totalChunks: 0,
				embeddingModel: "pending",
				embeddingDimensions: 0,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await store.manifests.putHead(name, manifest, null);
			console.log(`✅ Project "${name}" created (${program.opts().storage} storage)`);
		});
}
