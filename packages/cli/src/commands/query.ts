import {
	catalogFilePath,
	getChunkIdsByState,
	getSupersededChunkIds,
	readCatalog,
} from "@wtfoc/ingest";
import { classifyQueryPersona, query } from "@wtfoc/search";
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
import { formatQuery } from "../output.js";

export function registerQueryCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("query <queryText>")
			.description("Semantic search across collection")
			.requiredOption("-c, --collection <name>", "Collection name")
			.option("-k, --top-k <number>", "Number of results", "10")
			.option(
				"--include-types <types...>",
				"Only include these source types (e.g. code markdown github-issue)",
			)
			.option(
				"--exclude-types <types...>",
				"Exclude these source types (e.g. doc-page github-pr-comment)",
			)
			.option(
				"--auto-route",
				"Auto-classify the query into a persona (technical/discussion/changes/docs/open-ended) and apply matching source-type filters. Manual --include-types / --exclude-types take precedence.",
			),
	).action(
		async (
			queryText: string,
			opts: {
				collection: string;
				topK: string;
				includeTypes?: string[];
				excludeTypes?: string[];
				autoRoute?: boolean;
			} & EmbedderOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format === "human") console.error("⏳ Loading embedder + index...");
			const { embedder } = createEmbedder(opts, getProjectConfig()?.embedder);

			// Load document catalog to exclude archived/superseded chunks from search
			const manifestDir = getManifestDir(store);
			const catPath = catalogFilePath(manifestDir, opts.collection);
			const catalog = await readCatalog(catPath);
			const archivedIds = catalog ? getChunkIdsByState(catalog, "archived") : undefined;
			const supersededIds = catalog ? getSupersededChunkIds(catalog) : undefined;
			const excludeChunkIds =
				archivedIds?.size || supersededIds?.size
					? new Set([...(archivedIds ?? []), ...(supersededIds ?? [])])
					: undefined;

			const { vectorIndex } = await loadCollection(store, head.manifest, { excludeChunkIds });

			const collectionDims = head.manifest.embeddingDimensions;
			let traceDims = 0;
			try {
				traceDims = embedder.dimensions;
			} catch {
				/* dimensions auto-detected on first call */
			}
			if (collectionDims > 0 && traceDims > 0 && collectionDims !== traceDims) {
				console.error(
					`\n❌ Dimension mismatch: collection uses ${collectionDims}d embeddings but your embedder produces ${traceDims}d.`,
				);
				console.error(`   Collection was embedded with: ${head.manifest.embeddingModel}`);
				console.error(`\n   Use --embedder to match, e.g.:`);
				console.error(
					`   ./wtfoc query "${queryText}" -c ${opts.collection} --embedder-url lmstudio --embedder-model ${head.manifest.embeddingModel}`,
				);
				process.exit(1);
			}

			// Resolve filters: explicit flags win over auto-route classification.
			let includeSourceTypes = opts.includeTypes;
			let excludeSourceTypes = opts.excludeTypes;
			if (opts.autoRoute && !includeSourceTypes && !excludeSourceTypes) {
				const classification = classifyQueryPersona(queryText);
				includeSourceTypes = classification.includeSourceTypes;
				excludeSourceTypes = classification.excludeSourceTypes;
				if (format === "human") {
					console.error(`   🧭 persona=${classification.persona} (${classification.reason})`);
				}
			}

			try {
				const result = await query(queryText, embedder, vectorIndex, {
					topK: Number.parseInt(opts.topK, 10),
					includeSourceTypes,
					excludeSourceTypes,
				});
				console.log(formatQuery(result, format));
			} catch (err) {
				if (
					err instanceof Error &&
					"code" in err &&
					(err as { code: string }).code === "VECTOR_DIMENSION_MISMATCH"
				) {
					console.error(`\n❌ ${err.message}`);
					console.error(`   Use --embedder to match the collection's model.`);
					process.exit(1);
				}
				throw err;
			}
		},
	);
}
