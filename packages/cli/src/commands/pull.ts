import type { Segment } from "@wtfoc/common";
import { resolveCollectionByCid } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";

export function registerPullCommand(program: Command): void {
	program
		.command("pull <cid>")
		.description("Pull a collection from FOC/IPFS by manifest CID into local storage")
		.option("-n, --name <name>", "Local collection name (default: derived from manifest)")
		.action(async (cid: string, opts: { name?: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			if (format === "human") console.error(`⏳ Fetching manifest from CID ${cid}...`);

			const { manifest, storage: remoteStorage } = await resolveCollectionByCid(cid);
			const name = opts.name ?? manifest.name;

			if (format === "human") {
				console.error(`📦 Collection: "${manifest.name}"`);
				console.error(
					`   ${manifest.totalChunks} chunks, ${manifest.segments.length} segments, ${manifest.embeddingModel} (${manifest.embeddingDimensions}d)`,
				);
			}

			// Check if collection already exists locally
			const existing = await store.manifests.getHead(name);
			if (existing) {
				console.error(
					`⚠️  Collection "${name}" already exists locally (${existing.manifest.totalChunks} chunks).`,
				);
				console.error(
					`   Use --name <other-name> to pull under a different name, or delete the existing collection first.`,
				);
				process.exit(1);
			}

			// Download all segments to local storage
			let downloaded = 0;
			for (const segRef of manifest.segments) {
				const segBytes = await remoteStorage.download(segRef.id);

				// Validate it's a valid segment
				const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
				if (!seg.chunks || !Array.isArray(seg.chunks)) {
					console.error(`⚠️  Skipping invalid segment ${segRef.id}`);
					continue;
				}

				const result = await store.storage.upload(segBytes);
				if (result.id !== segRef.id) {
					console.error(`⚠️  Hash mismatch for segment: expected ${segRef.id}, got ${result.id}`);
				}
				downloaded++;

				if (format === "human" && downloaded % 50 === 0) {
					console.error(`   ${downloaded}/${manifest.segments.length} segments downloaded...`);
				}
			}

			// Save manifest locally
			await store.manifests.putHead(name, manifest, null);

			if (format === "human") {
				console.error(
					`\n✅ Pulled "${name}" — ${manifest.totalChunks} chunks in ${downloaded} segments`,
				);
				console.error(
					`   Embedding model: ${manifest.embeddingModel} (${manifest.embeddingDimensions}d)`,
				);
				console.error(`\n   Query with:`);
				console.error(
					`   wtfoc query "your question" -c ${name} --embedder api --embedder-url ollama --embedder-model ${manifest.embeddingModel}`,
				);
			}

			if (format === "json") {
				console.log(
					JSON.stringify({
						name,
						cid,
						chunks: manifest.totalChunks,
						segments: downloaded,
						model: manifest.embeddingModel,
						dimensions: manifest.embeddingDimensions,
					}),
				);
			}
		});
}
