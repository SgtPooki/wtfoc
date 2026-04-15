import {
	archiveIndexPath,
	buildSourceKey,
	catalogFilePath,
	createEmptyArchiveIndex,
	createEmptyCatalog,
	cursorFilePath,
	DEFAULT_MAX_CHUNK_CHARS,
	getAdapter,
	getAvailableSourceTypes,
	getCursorSince,
	orchestrate,
	readArchiveIndex,
	readCatalog,
	readCursors,
	writeArchiveIndex,
	writeCatalog,
} from "@wtfoc/ingest";
import { bundleAndUpload, generateCollectionId, validateCollectionName } from "@wtfoc/store";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import { type ExtractorCliOpts, resolveExtractorConfig } from "../extractor-config.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getManifestDir,
	getStore,
	parseSinceDuration,
	resolveTreeSitterUrl,
	withEmbedderOptions,
	withExtractorOptions,
	withTreeSitterOptions,
} from "../helpers.js";
import {
	applyRepoConfig,
	applyWebsiteOptions,
	buildIngestOptions,
	createEdgeExtractorFactory,
	createPublishSegment,
	formatIngestSummary,
	persistCursor,
} from "./ingest-helpers.js";

export function registerIngestCommand(program: Command): void {
	withTreeSitterOptions(
		withExtractorOptions(
			withEmbedderOptions(
				program
					.command("ingest <sourceType> [args...]")
					.description("Ingest from a source (repo, slack, github, website)")
					.requiredOption("-c, --collection <name>", "Collection name")
					.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)")
					.option("--description <text>", "Set collection description")
					.option("--batch-size <number>", "Chunks per batch (default: 500)", "500")
					.option(
						"--max-chunk-chars <number>",
						`Max characters per chunk (default: ${DEFAULT_MAX_CHUNK_CHARS})`,
					)
					.option("--ignore <pattern...>", "Exclude files matching gitignore-style pattern")
					.option("--max-pages <number>", "[website] Limit pages to crawl (default: 100)")
					.option("--depth <number>", "[website] Limit link-following depth")
					.option("--url-pattern <glob>", "[website] Glob pattern to restrict URLs")
					.option(
						"--deny-path <patterns...>",
						"[website] Path substrings to skip (e.g. /blog /tag /archive /legal). Matches any — logical OR.",
					)
					.option("--document-ids <ids...>", "Only re-process these document IDs")
					.option("--source-paths <paths...>", "[repo] Only process matching paths")
					.option("--changed-since <iso>", "Only process documents after this timestamp")
					.option("--no-source-reuse", "Disable cross-collection source reuse")
					.option(
						"--reuse-donor-chunks",
						"Opt-in: copy donor chunk fingerprints into dedup sets. Speeds up repeat ingests of identical content but silently discards chunker improvements when donor was chunked with an older chunker.",
					),
			),
		),
	).action(
		async (
			sourceType: string,
			args: string[],
			opts: {
				collection: string;
				since?: string;
				description?: string;
				batchSize: string;
				maxChunkChars?: string;
				ignore?: string[];
				maxPages?: string;
				depth?: string;
				urlPattern?: string;
				denyPath?: string[];
				treeSitterUrl?: string;
				documentIds?: string[];
				sourcePaths?: string[];
				changedSince?: string;
				sourceReuse?: boolean;
				reuseDonorChunks?: boolean;
			} & EmbedderOpts &
				ExtractorCliOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			try {
				validateCollectionName(opts.collection);
			} catch (err) {
				console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
				process.exit(2);
			}

			const head = await store.manifests.getHead(opts.collection);
			const extractorConfig = resolveExtractorConfig(opts);
			if (format === "human") console.error("⏳ Loading embedder...");
			const { embedder, modelName } = createEmbedder(opts, getProjectConfig()?.embedder);

			if (
				head &&
				head.manifest.embeddingModel !== "pending" &&
				head.manifest.embeddingModel !== modelName
			) {
				console.error(
					`⚠️  Model mismatch: collection uses "${head.manifest.embeddingModel}" but you're using "${modelName}".`,
				);
				console.error(
					"   Mixed embeddings will produce poor search results. Use --embedder to match, or re-index.",
				);
				process.exit(1);
			}

			const adapter = getAdapter(sourceType);
			if (!adapter) {
				console.error(
					`Unknown source type: ${sourceType}\nAvailable: ${getAvailableSourceTypes().join(", ")}`,
				);
				process.exit(2);
			}
			const sourceArg = args[0];
			if (!sourceArg) {
				console.error(`Error: ${sourceType} source required`);
				process.exit(2);
			}

			// Build adapter config
			const rawConfig: Record<string, unknown> = { source: sourceArg };
			if (sourceType === "website") {
				applyWebsiteOptions(rawConfig, opts, format === "quiet");
			}

			const sourceKey = buildSourceKey(sourceType, sourceArg);
			const manifestDir = getManifestDir(store);
			const cursorPath = cursorFilePath(manifestDir, opts.collection);
			const cursorData = await readCursors(cursorPath);

			if (opts.since) {
				rawConfig.since = parseSinceDuration(opts.since);
			} else {
				const s = getCursorSince(cursorData, sourceKey);
				if (s) {
					rawConfig.since = s;
					if (format === "human") console.error(`   Resuming from cursor: ${s}`);
				}
			}

			if (format === "human") console.error(`⏳ Ingesting ${sourceType}: ${sourceArg}...`);
			const config = adapter.parseConfig(rawConfig);
			if (sourceType === "repo") {
				applyRepoConfig(
					config,
					sourceKey,
					cursorData,
					getProjectConfig()?.ignore,
					opts.ignore,
					format === "quiet",
				);
			}

			const storageType = (program.opts().storage ?? "local") as string;
			const collectionId = head?.manifest.collectionId ?? generateCollectionId(opts.collection);
			const isPartialRun = !!(opts.documentIds || opts.sourcePaths || opts.changedSince);
			const catPath = catalogFilePath(manifestDir, opts.collection);
			const arcPath = archiveIndexPath(manifestDir, opts.collection);
			const treeSitterUrl = resolveTreeSitterUrl(opts);

			const ingestOpts = buildIngestOptions({
				collection: opts.collection,
				collectionId,
				sourceType,
				sourceKey,
				config,
				batchSize: opts.batchSize,
				maxChunkChars: opts.maxChunkChars,
				embedder,
				defaultMaxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
				isPartialRun,
				documentIds: opts.documentIds,
				sourcePaths: opts.sourcePaths,
				changedSince: opts.changedSince,
				modelName,
				sourceReuse: opts.sourceReuse !== false,
				reuseDonorChunks: opts.reuseDonorChunks === true,
				sourceArg,
				extractorConfig: extractorConfig.enabled ? extractorConfig : null,
				treeSitterUrl: treeSitterUrl ?? null,
				manifestDir,
				description: opts.description,
				catalog: (await readCatalog(catPath)) ?? createEmptyCatalog(collectionId),
				archiveIndex: (await readArchiveIndex(arcPath)) ?? createEmptyArchiveIndex(collectionId),
				adapter,
				cursorData,
			});

			const result = await orchestrate(ingestOpts, {
				store,
				embedder,
				adapter,
				log: (event) => {
					if (format === "human") console.error(event.message);
				},
				publishSegment: createPublishSegment(storageType, store.storage, bundleAndUpload),
				createEdgeExtractor: createEdgeExtractorFactory(treeSitterUrl ?? null, extractorConfig),
			});

			// Persist catalog and archive
			if (result.catalogModified) {
				await writeCatalog(catPath, result.catalog);
				if (result.archivedCount > 0) await writeArchiveIndex(arcPath, result.archiveIndex);
			}
			if (result.empty) {
				if (result.archivedCount > 0) await writeArchiveIndex(arcPath, result.archiveIndex);
				if (format === "human") console.error("⚠️  No chunks produced — skipping upload");
				return;
			}

			if (format === "human") {
				console.error(formatIngestSummary(result, sourceArg, opts.collection));
			}

			// Persist cursor
			if (isPartialRun && format === "human")
				console.error("   ⚠️  Partial run — cursor not advanced");
			await persistCursor(cursorPath, cursorData, sourceKey, sourceType, result);
			if (result.cursorValue && format === "human")
				console.error(`   Saved cursor for next run: ${result.cursorValue}`);

			if (storageType === "foc") process.exit(0);
		},
	);
}
