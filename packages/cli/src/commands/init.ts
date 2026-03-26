import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import { getStore } from "../helpers.js";

const DEFAULT_CONFIG = {
	embedder: {
		profiles: {
			minilm: {
				model: "Xenova/all-MiniLM-L6-v2",
				dimensions: 384,
				pooling: "mean",
			},
			nomic: {
				model: "nomic-embed-text",
				dimensions: 768,
				pooling: "mean",
				prefix: {
					query: "search_query: ",
					document: "search_document: ",
				},
			},
			"qwen3-0.6b": {
				model: "qwen3-embedding:0.6b",
				dimensions: 1024,
				pooling: "last_token",
				prefix: {
					query: "Instruct: Given a query, retrieve relevant passages\nQuery: ",
					document: "",
				},
			},
		},
	},
};

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

			// Write default .wtfoc.json if it doesn't exist
			const configPath = join(process.cwd(), ".wtfoc.json");
			if (!existsSync(configPath)) {
				writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, "\t")}\n`);
				console.log(`📝 Created .wtfoc.json with default embedder profiles`);
			}

			console.log(`✅ Project "${name}" created (${program.opts().storage} storage)`);
		});
}
