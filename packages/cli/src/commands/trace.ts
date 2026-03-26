import { overlayFilePath, readOverlayEdges } from "@wtfoc/ingest";
import { type TraceMode, trace } from "@wtfoc/search";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getManifestDir,
	getStore,
	loadCollection,
	withEmbedderOptions,
} from "../helpers.js";
import { formatTrace } from "../output.js";

export function registerTraceCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("trace <query>")
			.description("Trace evidence-backed connections across sources")
			.requiredOption("-c, --collection <name>", "Collection name")
			.option(
				"--mode <mode>",
				'Trace mode: "discovery" (default) or "analytical" (adds cross-source insights)',
				"discovery",
			),
	).action(async (queryText: string, opts: { collection: string; mode: string } & EmbedderOpts) => {
		const validModes: TraceMode[] = ["discovery", "analytical"];
		if (!validModes.includes(opts.mode as TraceMode)) {
			console.error(
				`Error: invalid trace mode "${opts.mode}". Must be one of: ${validModes.join(", ")}`,
			);
			process.exit(2);
		}
		// Safe after validation above
		const mode: TraceMode = opts.mode === "analytical" ? "analytical" : "discovery";
		const store = getStore(program);
		const format = getFormat(program.opts());

		const head = await store.manifests.getHead(opts.collection);
		if (!head) {
			console.error(`Error: collection "${opts.collection}" not found`);
			process.exit(1);
		}

		if (format !== "quiet") console.error("⏳ Loading embedder + index...");
		const { embedder } = createEmbedder(opts, getProjectConfig()?.embedder);
		const { vectorIndex, segments } = await loadCollection(store, head.manifest);

		// Load overlay edges (from extract-edges) if available
		const manifestDir = getManifestDir(store);
		const overlay = await readOverlayEdges(overlayFilePath(manifestDir, opts.collection));
		const overlayEdges = overlay?.edges ?? [];
		if (overlayEdges.length > 0 && format !== "quiet") {
			console.error(`🔗 Loaded ${overlayEdges.length} overlay edges from extract-edges`);
		}

		// Check dimension compatibility before querying (skip if dimensions unknown yet)
		const collectionDims = head.manifest.embeddingDimensions;
		let embedderDims = 0;
		try {
			embedderDims = embedder.dimensions;
		} catch {
			/* dimensions auto-detected on first call */
		}
		if (collectionDims > 0 && embedderDims > 0 && collectionDims !== embedderDims) {
			console.error(
				`\n❌ Dimension mismatch: collection uses ${collectionDims}d embeddings but your embedder produces ${embedder.dimensions}d.`,
			);
			console.error(`   Collection was embedded with: ${head.manifest.embeddingModel}`);
			console.error(`\n   To query this collection, use the same embedder:`);
			console.error(
				`   ./wtfoc trace "${queryText}" -c ${opts.collection} --embedder-url lmstudio --embedder-model ${head.manifest.embeddingModel}`,
			);
			console.error(`\n   Or re-index with your current embedder (not yet supported).`);
			process.exit(1);
		}

		try {
			const result = await trace(queryText, embedder, vectorIndex, segments, {
				mode,
				overlayEdges,
			});
			console.log(formatTrace(result, format));
		} catch (err) {
			if (
				err instanceof Error &&
				"code" in err &&
				(err as { code: string }).code === "VECTOR_DIMENSION_MISMATCH"
			) {
				console.error(`\n❌ ${err.message}`);
				console.error(`   Collection model: ${head.manifest.embeddingModel} (${collectionDims}d)`);
				console.error(`   Use --embedder to match the collection's model.`);
				process.exit(1);
			}
			throw err;
		}
	});
}
