#!/usr/bin/env node

import type {
	Chunk,
	Embedder,
	HeadManifest,
	Segment,
	VectorEntry,
	VectorIndex,
} from "@wtfoc/common";
import { buildSegment, chunkMarkdown, RegexEdgeExtractor, RepoAdapter } from "@wtfoc/ingest";
import {
	InMemoryVectorIndex,
	OpenAIEmbedder,
	query,
	TransformersEmbedder,
	trace,
} from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import { Command } from "commander";
import { formatQuery, formatStatus, formatTrace, type OutputFormat } from "./output.js";

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
		.option("--embedder <type>", "Embedder: transformers (default), openai, lmstudio, ollama")
		.option("--embedder-url <url>", "Embedder API URL (for openai/lmstudio)")
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

/**
 * Create an embedder based on CLI flags.
 * Supports: transformers (default, local), openai (API or LM Studio compatible).
 */
function createEmbedder(opts: {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}): { embedder: Embedder; modelName: string } {
	const type = opts.embedder ?? "transformers";

	const apiDefaults: Record<string, { url: string; key: string; model: string }> = {
		lmstudio: {
			url: "http://localhost:1234/v1",
			key: "lm-studio",
			model: "text-embedding-3-small",
		},
		ollama: { url: "http://localhost:11434/v1", key: "ollama", model: "nomic-embed-text" },
		openai: { url: "https://api.openai.com/v1", key: "", model: "text-embedding-3-small" },
	};

	if (type in apiDefaults) {
		const d = apiDefaults[type];
		if (!d) throw new Error(`Unknown embedder type: ${type}`);
		const apiKey = opts.embedderKey ?? process.env["WTFOC_OPENAI_API_KEY"] ?? d.key;
		const baseUrl = opts.embedderUrl ?? d.url;
		const model = opts.embedderModel ?? d.model;

		if (type === "openai" && !apiKey) {
			console.error("Error: OpenAI embedder requires --embedder-key or WTFOC_OPENAI_API_KEY");
			process.exit(2);
		}

		const embedder = new OpenAIEmbedder({ apiKey, baseUrl, model });
		return { embedder, modelName: model };
	}

	// Default: local transformers.js (works everywhere, but lower quality)
	try {
		console.error(
			"ℹ️  Using local MiniLM embedder (384d). For better results, use --embedder lmstudio or --embedder openai",
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

// ─── wtfoc init ──────────────────────────────────────────────────────────────
program
	.command("init <name>")
	.description("Create a new wtfoc project")
	.option("--local", "Use local storage (default)")
	.option("--foc", "Use FOC storage")
	.action(async (name: string, opts: { local?: boolean; foc?: boolean }) => {
		const store = getStore();

		// Create initial manifest
		const manifest: HeadManifest = {
			schemaVersion: 1,
			name,
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
const ingestCmd = withEmbedderOptions(
	program
		.command("ingest <sourceType> [args...]")
		.description("Ingest from a source (repo, slack, github, website)")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)"),
).action(
	async (sourceType: string, args: string[], opts: { collection: string } & EmbedderOpts) => {
		const store = getStore();
		const format = getFormat(program.opts());

		// Get or create manifest
		const head = await store.manifests.getHead(opts.collection);
		let prevHeadId: string | null = null;
		if (head) {
			prevHeadId = head.headId;
		}

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

		// Collect chunks based on source type
		const chunks: Chunk[] = [];
		if (sourceType === "repo") {
			const repoSource = args[0];
			if (!repoSource) {
				console.error("Error: repo source required (e.g. FilOzone/synapse-sdk or ./path)");
				process.exit(2);
			}
			if (format !== "quiet") console.error(`⏳ Ingesting repo: ${repoSource}...`);
			const adapter = new RepoAdapter();
			const repoConfig = adapter.parseConfig({ source: repoSource });
			for await (const chunk of adapter.ingest(repoConfig)) {
				chunks.push(chunk);
			}
			if (format !== "quiet") console.error(`   ${chunks.length} chunks extracted`);

			// Extract edges
			const edgeExtractor = new RegexEdgeExtractor();
			const edges = [...adapter.extractEdges(chunks), ...edgeExtractor.extract(chunks)];
			if (format !== "quiet") console.error(`   ${edges.length} edges extracted`);

			// Embed chunks
			if (format !== "quiet") console.error("⏳ Embedding chunks...");
			const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));

			// Build segment
			const segmentChunks = chunks.map((chunk, i) => {
				const emb = embeddings[i];
				if (!emb)
					throw new Error(
						`Missing embedding for chunk ${i} — expected ${chunks.length} embeddings`,
					);
				return { chunk, embedding: Array.from(emb) };
			});

			const segment = buildSegment(segmentChunks, edges, {
				embeddingModel: modelName,
				embeddingDimensions: embedder.dimensions,
			});

			// Store segment
			const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
			const segmentResult = await store.storage.upload(segmentBytes);
			if (format !== "quiet")
				console.error(`   Segment stored: ${segmentResult.id.slice(0, 16)}...`);

			// Update manifest
			const manifest: HeadManifest = {
				schemaVersion: 1,
				name: opts.collection,
				prevHeadId,
				segments: [
					...(head?.manifest.segments ?? []),
					{
						id: segmentResult.id,
						sourceTypes: [...new Set(chunks.map((c) => c.sourceType))],
						chunkCount: chunks.length,
					},
				],
				totalChunks: (head?.manifest.totalChunks ?? 0) + chunks.length,
				embeddingModel: modelName,
				embeddingDimensions: embedder.dimensions,
				createdAt: head?.manifest.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await store.manifests.putHead(opts.collection, manifest, prevHeadId);
			if (format !== "quiet") {
				console.error(
					`✅ Ingested ${chunks.length} chunks from ${repoSource} into "${opts.collection}"`,
				);
			}
		} else {
			console.error(`Unknown source type: ${sourceType}`);
			console.error("Available: repo");
			process.exit(2);
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

	// Check dimension compatibility before querying
	const collectionDims = head.manifest.embeddingDimensions;
	if (collectionDims > 0 && embedder.dimensions > 0 && collectionDims !== embedder.dimensions) {
		console.error(
			`\n❌ Dimension mismatch: collection uses ${collectionDims}d embeddings but your embedder produces ${embedder.dimensions}d.`,
		);
		console.error(`   Collection was embedded with: ${head.manifest.embeddingModel}`);
		console.error(`\n   To query this collection, use the same embedder:`);
		console.error(
			`   ./wtfoc trace "${queryText}" -c ${opts.collection} --embedder lmstudio --embedder-model ${head.manifest.embeddingModel}`,
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
	if (collectionDims > 0 && embedder.dimensions > 0 && collectionDims !== embedder.dimensions) {
		console.error(
			`\n❌ Dimension mismatch: collection uses ${collectionDims}d embeddings but your embedder produces ${embedder.dimensions}d.`,
		);
		console.error(`   Collection was embedded with: ${head.manifest.embeddingModel}`);
		console.error(`\n   Use --embedder to match, e.g.:`);
		console.error(
			`   ./wtfoc query "${queryText}" -c ${opts.collection} --embedder lmstudio --embedder-model ${head.manifest.embeddingModel}`,
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

// ─── Helper: load collection into embedder + vector index ────────────────────

interface LoadedCollection {
	vectorIndex: VectorIndex;
	segments: Segment[];
}

async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: HeadManifest,
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
