#!/usr/bin/env node

import {
	type Chunk,
	type CollectionHead,
	CURRENT_SCHEMA_VERSION,
	type Embedder,
	type Segment,
	type VectorEntry,
	type VectorIndex,
} from "@wtfoc/common";
import {
	buildSegment,
	getAdapter,
	getAvailableSourceTypes,
	RegexEdgeExtractor,
	segmentId,
} from "@wtfoc/ingest";
import {
	analyzeEdgeResolution,
	buildSourceIndex,
	InMemoryVectorIndex,
	OpenAIEmbedder,
	query,
	TransformersEmbedder,
	trace,
} from "@wtfoc/search";
import { bundleAndUpload, createStore, generateCollectionId } from "@wtfoc/store";
import { Command } from "commander";
import {
	formatCollections,
	formatQuery,
	formatStatus,
	formatTrace,
	type OutputFormat,
} from "./output.js";

function parseSinceDuration(duration: string): string {
	const match = duration.match(/^(\d+)([dh])$/);
	if (!match?.[1] || !match[2]) {
		console.error(
			`Invalid --since format: "${duration}". Use <number>d (days) or <number>h (hours). Example: 90d`,
		);
		process.exit(2);
	}
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	const now = new Date();
	if (unit === "d") now.setDate(now.getDate() - value);
	else if (unit === "h") now.setHours(now.getHours() - value);
	return now.toISOString();
}

const program = new Command();

program
	.name("wtfoc")
	.description("What the FOC happened? Trace it.")
	.version("0.0.1")
	.option("--json", "Output as JSON")
	.option("--quiet", "Suppress output (errors only)")
	.option("--storage <type>", "Storage: local (default) or foc", "local");

interface EmbedderOpts {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}

/** Add --embedder flags to any command */
function withEmbedderOptions<T extends Command>(cmd: T): T {
	return cmd
		.option(
			"--embedder <type>",
			"Embedder: local (default), api (requires --embedder-url + --embedder-model)",
		)
		.option("--embedder-url <url>", "Embedder API URL (or shortcut: lmstudio, ollama)")
		.option("--embedder-key <key>", "Embedder API key")
		.option("--embedder-model <model>", "Embedder model name") as T;
}

function getStore() {
	const globalOpts = program.opts();
	const storageType = (globalOpts.storage ?? "local") as "local" | "foc";
	return createStore({ storage: storageType });
}

function getFormat(opts: { json?: boolean; quiet?: boolean }): OutputFormat {
	if (opts.json) return "json";
	if (opts.quiet) return "quiet";
	return "human";
}

function getFirstMatchGroup(match: RegExpMatchArray | RegExpExecArray, index = 1): string | null {
	return typeof match[index] === "string" ? match[index] : null;
}

/**
 * Create an embedder based on CLI flags.
 * Supports: transformers (default, local), openai (API or LM Studio compatible).
 */
/**
 * Create an embedder based on CLI flags.
 *
 * --embedder-url determines the API endpoint. Well-known shortcuts:
 *   "lmstudio" → http://localhost:1234/v1
 *   "ollama"   → http://localhost:11434/v1
 *   Any URL    → used directly
 *
 * --embedder-model is REQUIRED for API embedders (no guessing what model is loaded).
 * --embedder local  → use transformers.js (default, no server needed)
 */
function createEmbedder(opts: {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}): { embedder: Embedder; modelName: string } {
	const type = opts.embedder ?? "local";

	// API-based embedder (any OpenAI-compatible endpoint)
	if (type === "api" || opts.embedderUrl || opts.embedderModel) {
		// Resolve URL shortcuts
		const urlShortcuts: Record<string, string> = {
			lmstudio: "http://localhost:1234/v1",
			ollama: "http://localhost:11434/v1",
		};
		const rawUrl = opts.embedderUrl ?? type;
		const baseUrl = urlShortcuts[rawUrl] ?? rawUrl;

		if (!baseUrl.startsWith("http")) {
			console.error(
				`Error: --embedder-url must be a URL or shortcut (lmstudio, ollama). Got: "${rawUrl}"`,
			);
			process.exit(2);
		}

		const model = opts.embedderModel;
		if (!model) {
			console.error("Error: --embedder-model is required for API embedders.");
			console.error("  The model name must match what the server has loaded.");
			console.error("  Example: --embedder-url lmstudio --embedder-model mxbai-embed-large-v1");
			process.exit(2);
		}

		const apiKey = opts.embedderKey ?? process.env.WTFOC_OPENAI_API_KEY ?? "no-key";
		const embedder = new OpenAIEmbedder({ apiKey, baseUrl, model });
		return { embedder, modelName: model };
	}

	// Default: local transformers.js (works everywhere, lower quality)
	if (type === "local" || type === "transformers") {
		try {
			console.error(
				"ℹ️  Using local MiniLM embedder (384d). For better results, use --embedder-url lmstudio --embedder-model <model>",
			);
			const embedder = new TransformersEmbedder();
			return { embedder, modelName: "Xenova/all-MiniLM-L6-v2" };
		} catch {
			console.error("⚠️  TransformersEmbedder unavailable, using zero-vector fallback");
			return {
				embedder: {
					dimensions: 384,
					async embed(): Promise<Float32Array> {
						return new Float32Array(384);
					},
					async embedBatch(texts: string[]): Promise<Float32Array[]> {
						return texts.map(() => new Float32Array(384));
					},
				},
				modelName: "zero-vector-fallback",
			};
		}
	}

	console.error(
		`Unknown embedder: "${type}". Use "local" or provide --embedder-url + --embedder-model.`,
	);
	process.exit(2);
}

// ─── wtfoc init ──────────────────────────────────────────────────────────────
program
	.command("init <name>")
	.description("Create a new wtfoc project")
	.option("--local", "Use local storage (default)")
	.option("--foc", "Use FOC storage")
	.action(async (name: string) => {
		const store = getStore();

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

// ─── wtfoc ingest <source-type> ──────────────────────────────────────────────
withEmbedderOptions(
	program
		.command("ingest <sourceType> [args...]")
		.description("Ingest from a source (repo, slack, github, website)")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)")
		.option(
			"--batch-size <number>",
			"Chunks per batch (default: 500, reduces memory for large sources)",
			"500",
		),
).action(
	async (
		sourceType: string,
		args: string[],
		opts: { collection: string; since?: string; batchSize: string } & EmbedderOpts,
	) => {
		const store = getStore();
		const format = getFormat(program.opts());

		// Get or create manifest
		const head = await store.manifests.getHead(opts.collection);

		// Initialize embedder
		if (format !== "quiet") console.error("⏳ Loading embedder...");
		const { embedder, modelName } = createEmbedder(opts);

		// Detect model mismatch
		if (
			head &&
			head.manifest.embeddingModel !== "pending" &&
			head.manifest.embeddingModel !== modelName
		) {
			console.error(
				`⚠️  Model mismatch: collection uses "${head.manifest.embeddingModel}" but you're using "${modelName}".`,
			);
			console.error(
				"   Mixed embeddings will produce poor search results. Use --embedder to match, or re-index the collection.",
			);
			process.exit(1);
		}

		// Look up adapter from registry
		const maybeAdapter = getAdapter(sourceType);
		if (!maybeAdapter) {
			console.error(`Unknown source type: ${sourceType}`);
			console.error(`Available: ${getAvailableSourceTypes().join(", ")}`);
			process.exit(2);
		}
		const adapter = maybeAdapter;

		// Build raw config from CLI args
		const sourceArg = args[0];
		if (!sourceArg) {
			console.error(`Error: ${sourceType} source required`);
			process.exit(2);
		}

		const rawConfig: Record<string, unknown> = { source: sourceArg };
		if (opts.since) rawConfig.since = parseSinceDuration(opts.since);

		if (format !== "quiet") console.error(`⏳ Ingesting ${sourceType}: ${sourceArg}...`);

		const config = adapter.parseConfig(rawConfig);
		const maxBatch = Number.parseInt(opts.batchSize, 10) || 500;
		const storageType = (program.opts().storage ?? "local") as string;

		// Build dedup set from existing segments for resumability
		const knownChunkIds = new Set<string>();
		if (head) {
			for (const segSummary of head.manifest.segments) {
				try {
					const segBytes = await store.storage.download(segSummary.id);
					const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					for (const c of seg.chunks) {
						knownChunkIds.add(c.id);
					}
				} catch {
					// Segment may not be downloadable (e.g. FOC-only), skip
				}
			}
			if (knownChunkIds.size > 0 && format !== "quiet") {
				console.error(`   ${knownChunkIds.size} existing chunks found (will skip duplicates)`);
			}
		}

		// Process chunks in batches to limit memory usage
		let batch: Chunk[] = [];
		let totalChunksIngested = 0;
		let totalChunksSkipped = 0;
		let batchNumber = 0;

		async function flushBatch(batchChunks: Chunk[]): Promise<void> {
			if (batchChunks.length === 0) return;
			batchNumber++;

			// Extract edges for this batch
			const edgeExtractor = new RegexEdgeExtractor();
			const edges = [...adapter.extractEdges(batchChunks), ...edgeExtractor.extract(batchChunks)];

			// Embed this batch
			if (format !== "quiet")
				console.error(`⏳ Embedding batch ${batchNumber} (${batchChunks.length} chunks)...`);
			const embeddings = await embedder.embedBatch(batchChunks.map((c) => c.content));

			const segmentChunks = batchChunks.map((chunk, i) => {
				const emb = embeddings[i];
				if (!emb)
					throw new Error(
						`Missing embedding for chunk ${i} — expected ${batchChunks.length} embeddings`,
					);
				return { chunk, embedding: Array.from(emb) };
			});

			const segment = buildSegment(segmentChunks, edges, {
				embeddingModel: modelName,
				embeddingDimensions: embedder.dimensions,
			});

			const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
			const segId = segmentId(segment);

			let resultId: string;
			let batchForManifest: import("@wtfoc/common").BatchRecord | undefined;

			if (storageType === "foc") {
				if (format !== "quiet") console.error("⏳ Bundling into CAR...");
				const bundleResult = await bundleAndUpload(
					[{ id: segId, data: segmentBytes }],
					store.storage,
				);
				resultId = bundleResult.segmentCids.get(segId) ?? segId;
				batchForManifest = bundleResult.batch;
				if (format !== "quiet")
					console.error(
						`   Segment bundled: ${resultId.slice(0, 16)}... (PieceCID: ${bundleResult.batch.pieceCid.slice(0, 16)}...)`,
					);
			} else {
				const segmentResult = await store.storage.upload(segmentBytes);
				resultId = segmentResult.id;
				if (format !== "quiet") console.error(`   Segment stored: ${resultId.slice(0, 16)}...`);
			}

			// Re-read head for each batch to avoid manifest conflicts
			const currentHead = await store.manifests.getHead(opts.collection);
			const currentPrevHeadId = currentHead ? currentHead.headId : null;

			const manifest: CollectionHead = {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(opts.collection),
				name: opts.collection,
				currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
				prevHeadId: currentPrevHeadId,
				segments: [
					...(currentHead?.manifest.segments ?? []),
					{
						id: resultId,
						sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
						chunkCount: batchChunks.length,
					},
				],
				totalChunks: (currentHead?.manifest.totalChunks ?? 0) + batchChunks.length,
				embeddingModel: modelName,
				embeddingDimensions: embedder.dimensions,
				createdAt: currentHead?.manifest.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			if (batchForManifest || currentHead?.manifest.batches) {
				manifest.batches = [
					...(currentHead?.manifest.batches ?? []),
					...(batchForManifest ? [batchForManifest] : []),
				];
			}

			await store.manifests.putHead(opts.collection, manifest, currentPrevHeadId);
			totalChunksIngested += batchChunks.length;
		}

		// Stream chunks from adapter, flushing each batch
		for await (const chunk of adapter.ingest(config)) {
			if (knownChunkIds.has(chunk.id)) {
				totalChunksSkipped++;
				continue;
			}
			batch.push(chunk);
			if (batch.length >= maxBatch) {
				if (format !== "quiet")
					console.error(`   ${totalChunksIngested + batch.length} chunks so far...`);
				await flushBatch(batch);
				batch = [];
			}
		}
		// Flush remaining chunks
		await flushBatch(batch);
		batch = [];

		if (totalChunksIngested === 0 && totalChunksSkipped === 0) {
			if (format !== "quiet") console.error("⚠️  No chunks produced — skipping upload");
			return;
		}

		if (format !== "quiet") {
			const parts = [`${totalChunksIngested} chunks`];
			if (batchNumber > 1) parts[0] += ` (${batchNumber} batches)`;
			if (totalChunksSkipped > 0) parts.push(`${totalChunksSkipped} skipped as duplicates`);
			console.error(`✅ Ingested ${parts.join(", ")} from ${sourceArg} into "${opts.collection}"`);
		}
	},
);

// ─── wtfoc trace ─────────────────────────────────────────────────────────────
withEmbedderOptions(
	program
		.command("trace <query>")
		.description("Trace evidence-backed connections across sources")
		.requiredOption("-c, --collection <name>", "Collection name"),
).action(async (queryText: string, opts: { collection: string } & EmbedderOpts) => {
	const store = getStore();
	const format = getFormat(program.opts());

	const head = await store.manifests.getHead(opts.collection);
	if (!head) {
		console.error(`Error: collection "${opts.collection}" not found`);
		process.exit(1);
	}

	if (format !== "quiet") console.error("⏳ Loading embedder + index...");
	const { embedder } = createEmbedder(opts);
	const { vectorIndex, segments } = await loadCollection(store, head.manifest);

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
		const result = await trace(queryText, embedder, vectorIndex, segments);
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

// ─── wtfoc query ─────────────────────────────────────────────────────────────
program;
withEmbedderOptions(
	program
		.command("query <queryText>")
		.description("Semantic search across collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("-k, --top-k <number>", "Number of results", "10"),
).action(async (queryText: string, opts: { collection: string; topK: string } & EmbedderOpts) => {
	const store = getStore();
	const format = getFormat(program.opts());

	const head = await store.manifests.getHead(opts.collection);
	if (!head) {
		console.error(`Error: collection "${opts.collection}" not found`);
		process.exit(1);
	}

	if (format !== "quiet") console.error("⏳ Loading embedder + index...");
	const { embedder } = createEmbedder(opts);
	const { vectorIndex } = await loadCollection(store, head.manifest);

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

	try {
		const result = await query(queryText, embedder, vectorIndex, {
			topK: Number.parseInt(opts.topK, 10),
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
});

// ─── wtfoc status ────────────────────────────────────────────────────────────
program
	.command("status")
	.description("Show collection status")
	.requiredOption("-c, --collection <name>", "Collection name")
	.action(async (opts: { collection: string }) => {
		const store = getStore();
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

// ─── wtfoc collections ──────────────────────────────────────────────────────
program
	.command("collections")
	.description("List all collections")
	.action(async () => {
		const store = getStore();
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

// ─── wtfoc verify ────────────────────────────────────────────────────────────
program
	.command("verify <id>")
	.description("Verify an artifact exists in storage")
	.action(async (id: string) => {
		const store = getStore();
		const format = getFormat(program.opts());

		if (!store.storage.verify) {
			console.error("Verify not supported by current storage backend");
			process.exit(1);
		}

		const result = await store.storage.verify(id);
		if (format === "json") {
			console.log(JSON.stringify(result));
		} else {
			if (result.exists) {
				console.log(`✅ Artifact exists (${result.size} bytes)`);
			} else {
				console.log("❌ Artifact not found");
				process.exit(1);
			}
		}
	});

// ─── wtfoc unresolved-edges ──────────────────────────────────────────────────
program
	.command("unresolved-edges")
	.description("Show edge targets that don't resolve to any chunk in the collection")
	.requiredOption("-c, --collection <name>", "Collection name")
	.option("--limit <number>", "Max repos to show", "20")
	.action(async (opts: { collection: string; limit: string }) => {
		const store = getStore();
		const format = getFormat(program.opts());

		const head = await store.manifests.getHead(opts.collection);
		if (!head) {
			console.error(`Error: collection "${opts.collection}" not found`);
			process.exit(1);
		}

		if (format !== "quiet") console.error("⏳ Loading segments...");

		const allSegments: Segment[] = [];
		for (const segSummary of head.manifest.segments) {
			const segBytes = await store.storage.download(segSummary.id);
			const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
			allSegments.push(segment);
		}

		// Use shared edge resolution logic (same as trace engine)
		const sourceIndex = buildSourceIndex(allSegments);
		const stats = analyzeEdgeResolution(allSegments, sourceIndex);
		const {
			totalEdges,
			resolvedEdges,
			bareRefs,
			unresolvedEdges: unresolvedCount,
			unresolvedByRepo,
		} = stats;
		const sorted = [...unresolvedByRepo.entries()].sort((a, b) => b[1] - a[1]);
		const maxShow = Number.parseInt(opts.limit, 10) || 20;

		if (format === "json") {
			console.log(
				JSON.stringify({
					totalEdges,
					resolvedEdges,
					bareRefs,
					unresolvedEdges: unresolvedCount,
					unresolvedByRepo: Object.fromEntries(unresolvedByRepo),
				}),
			);
		} else {
			console.log(`\n📊 Edge resolution for "${opts.collection}"`);
			console.log(`   Total edges: ${totalEdges}`);
			console.log(
				`   Resolved:    ${resolvedEdges} (${Math.round((resolvedEdges / totalEdges) * 100)}%)`,
			);
			console.log(`   Bare #N:     ${bareRefs} (no repo context)`);
			console.log(`   Unresolved:  ${unresolvedCount}`);

			if (sorted.length > 0) {
				console.log(`\n⚠️  Unresolved edge targets by repo:`);
				for (const [repo, count] of sorted.slice(0, maxShow)) {
					console.log(`   ${String(count).padStart(4)}  ${repo}`);
				}
				if (sorted.length > maxShow) {
					console.log(`   ... and ${sorted.length - maxShow} more repos`);
				}
				console.log(`\n   Run \`wtfoc ingest github <repo> -c ${opts.collection}\` to add them.`);
			}
		}
	});

// ─── wtfoc suggest-sources ───────────────────────────────────────────────────
program
	.command("suggest-sources")
	.description("Discover repos and websites referenced in content that could be ingested")
	.requiredOption("-c, --collection <name>", "Collection name")
	.option("--limit <number>", "Max suggestions to show", "30")
	.action(async (opts: { collection: string; limit: string }) => {
		const store = getStore();
		const format = getFormat(program.opts());

		const head = await store.manifests.getHead(opts.collection);
		if (!head) {
			console.error(`Error: collection "${opts.collection}" not found`);
			process.exit(1);
		}

		if (format !== "quiet") console.error("⏳ Scanning collection for external references...");

		// Track what's already ingested
		const ingestedRepos = new Set<string>();
		const ingestedSites = new Set<string>();
		const allSegments: Segment[] = [];

		for (const segSummary of head.manifest.segments) {
			const segBytes = await store.storage.download(segSummary.id);
			const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
			allSegments.push(segment);
			for (const c of segment.chunks) {
				// Track ingested GitHub repos (from source field like "owner/repo#N" or "owner/repo/path")
				const repoMatch = c.source.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
				const repoId = repoMatch ? getFirstMatchGroup(repoMatch) : null;
				if (repoId && c.sourceType.startsWith("github-")) ingestedRepos.add(repoId.toLowerCase());
				if (c.sourceType === "code" || c.sourceType === "markdown") {
					const codeRepo = c.source.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
					const codeRepoId = codeRepo ? getFirstMatchGroup(codeRepo) : null;
					if (codeRepoId) ingestedRepos.add(codeRepoId.toLowerCase());
				}
				// Track ingested websites
				if (c.sourceUrl?.startsWith("http")) {
					try {
						const host = new URL(c.sourceUrl).hostname;
						ingestedSites.add(host);
					} catch {}
				}
			}
		}

		// Scan content and edges for external references
		const GITHUB_REPO_URL = /https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/g;
		const DOCS_SITE_URL =
			/https?:\/\/((?:docs\.[a-z0-9.-]+|[a-z0-9.-]+\.(?:dev|io|cloud|org|com)))\//g;

		const repoRefs = new Map<string, number>();
		const siteRefs = new Map<string, number>();

		for (const seg of allSegments) {
			for (const chunk of seg.chunks) {
				// GitHub repo references in content
				for (const match of chunk.content.matchAll(GITHUB_REPO_URL)) {
					const repo = getFirstMatchGroup(match);
					if (!repo) continue;
					if (!ingestedRepos.has(repo.toLowerCase())) {
						repoRefs.set(repo, (repoRefs.get(repo) ?? 0) + 1);
					}
				}
				// Docs site references in content
				for (const match of chunk.content.matchAll(DOCS_SITE_URL)) {
					const host = getFirstMatchGroup(match);
					if (!host) continue;
					if (!ingestedSites.has(host)) {
						siteRefs.set(host, (siteRefs.get(host) ?? 0) + 1);
					}
				}
			}
			// Also check edge targetIds for unresolved repos
			for (const edge of seg.edges) {
				const repoMatch = edge.targetId.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)#/);
				const repo = repoMatch ? getFirstMatchGroup(repoMatch) : null;
				if (!repo || ingestedRepos.has(repo.toLowerCase())) continue;
				repoRefs.set(repo, (repoRefs.get(repo) ?? 0) + 1);
			}
		}

		const maxShow = Number.parseInt(opts.limit, 10) || 30;
		const sortedRepos = [...repoRefs.entries()].sort((a, b) => b[1] - a[1]);
		const sortedSites = [...siteRefs.entries()].sort((a, b) => b[1] - a[1]);

		if (format === "json") {
			console.log(
				JSON.stringify({
					ingestedRepos: [...ingestedRepos],
					ingestedSites: [...ingestedSites],
					suggestedRepos: Object.fromEntries(sortedRepos),
					suggestedSites: Object.fromEntries(sortedSites),
				}),
			);
		} else {
			console.log(`\n📦 Collection "${opts.collection}" — already ingested:`);
			console.log(`   ${ingestedRepos.size} GitHub repos, ${ingestedSites.size} websites`);

			if (sortedRepos.length > 0) {
				console.log(`\n🔍 GitHub repos referenced but not ingested (${sortedRepos.length} found):`);
				for (const [repo, count] of sortedRepos.slice(0, maxShow)) {
					console.log(`   ${String(count).padStart(4)} refs  ${repo}`);
				}
				if (sortedRepos.length > maxShow) {
					console.log(`   ... and ${sortedRepos.length - maxShow} more`);
				}
			}

			if (sortedSites.length > 0) {
				console.log(`\n🌐 Websites referenced but not ingested (${sortedSites.length} found):`);
				for (const [site, count] of sortedSites.slice(0, 10)) {
					console.log(`   ${String(count).padStart(4)} refs  ${site}`);
				}
			}

			if (sortedRepos.length > 0) {
				console.log(
					`\n   To ingest a repo:    wtfoc ingest github <owner/repo> -c ${opts.collection}`,
				);
				console.log(`   To ingest a website: wtfoc ingest website <url> -c ${opts.collection}`);
			}
		}
	});

// ─── wtfoc serve ─────────────────────────────────────────────────────────────
withEmbedderOptions(
	program
		.command("serve")
		.description("Start HTTP server with web UI for exploring a collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("-p, --port <number>", "Port to listen on", "3577"),
).action(async (opts: { collection: string; port: string } & EmbedderOpts) => {
	const store = getStore();
	const { embedder } = createEmbedder(opts);

	// Load UI HTML at startup (bundled alongside the CLI)
	const { readFile } = await import("node:fs/promises");
	const { fileURLToPath } = await import("node:url");
	const { join, dirname } = await import("node:path");
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const uiHtml = await readFile(join(__dirname, "ui.html"), "utf-8");

	const { startServer } = await import("./serve.js");
	await startServer({
		store,
		collection: opts.collection,
		embedder,
		port: Number.parseInt(opts.port, 10),
		html: uiHtml,
	});
});

// ─── Helper: load collection into embedder + vector index ────────────────────

interface LoadedCollection {
	vectorIndex: VectorIndex;
	segments: Segment[];
}

async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	const segments: Segment[] = [];

	for (const segSummary of manifest.segments) {
		const segBytes = await store.storage.download(segSummary.id);
		const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
		segments.push(segment);

		// Add chunks to vector index
		const entries: VectorEntry[] = segment.chunks.map((c) => ({
			id: c.id,
			vector: new Float32Array(c.embedding),
			storageId: c.storageId || segSummary.id,
			metadata: {
				sourceType: c.sourceType,
				source: c.source,
				sourceUrl: c.sourceUrl ?? "",
				content: c.content,
				...c.metadata,
			},
		}));
		await vectorIndex.add(entries);
	}

	return { vectorIndex, segments };
}

// ─── Run ─────────────────────────────────────────────────────────────────────
program.parse();
