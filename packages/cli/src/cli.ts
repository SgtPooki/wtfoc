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
import { InMemoryVectorIndex, query, TransformersEmbedder, trace } from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import { Command } from "commander";
import { formatQuery, formatStatus, formatTrace, type OutputFormat } from "./output.js";

const program = new Command();

program
	.name("wtfoc")
	.description("What the FOC happened? Trace it.")
	.version("0.0.1")
	.option("--json", "Output as JSON")
	.option("--quiet", "Suppress output (errors only)");

function getFormat(opts: { json?: boolean; quiet?: boolean }): OutputFormat {
	if (opts.json) return "json";
	if (opts.quiet) return "quiet";
	return "human";
}

// ─── wtfoc init ──────────────────────────────────────────────────────────────
program
	.command("init <name>")
	.description("Create a new wtfoc project")
	.option("--local", "Use local storage (default)")
	.option("--foc", "Use FOC storage")
	.action(async (name: string, opts: { local?: boolean; foc?: boolean }) => {
		const backend = opts.foc ? "foc" : "local";
		const store = createStore({ storage: backend as "local" | "foc" });

		// Create initial manifest
		const manifest: HeadManifest = {
			schemaVersion: 1,
			name,
			prevHeadId: null,
			segments: [],
			totalChunks: 0,
			embeddingModel: "Xenova/all-MiniLM-L6-v2",
			embeddingDimensions: 384,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await store.manifests.putHead(name, manifest, null);
		console.log(`✅ Project "${name}" created (${backend} storage)`);
	});

// ─── wtfoc ingest <source-type> ──────────────────────────────────────────────
const ingestCmd = program
	.command("ingest <sourceType> [args...]")
	.description("Ingest from a source (repo, slack, github, website)")
	.requiredOption("-c, --collection <name>", "Collection name")
	.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)")
	.action(async (sourceType: string, args: string[], opts: { collection: string }) => {
		const store = createStore({ storage: "local" });
		const format = getFormat(program.opts());

		// Get or create manifest
		const head = await store.manifests.getHead(opts.collection);
		let prevHeadId: string | null = null;
		if (head) {
			prevHeadId = head.headId;
		}

		// Initialize embedder
		if (format !== "quiet") console.error("⏳ Loading embedder...");
		let embedder: Embedder;
		try {
			embedder = new TransformersEmbedder();
		} catch {
			// Fallback: create a simple embedder that returns zero vectors
			// (for environments where transformers.js isn't available)
			console.error("⚠️  TransformersEmbedder unavailable, using zero-vector fallback");
			embedder = {
				dimensions: 384,
				async embed(): Promise<Float32Array> {
					return new Float32Array(384);
				},
				async embedBatch(texts: string[]): Promise<Float32Array[]> {
					return texts.map(() => new Float32Array(384));
				},
			};
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
				embeddingModel: "Xenova/all-MiniLM-L6-v2",
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
				embeddingModel: "Xenova/all-MiniLM-L6-v2",
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
	});

// ─── wtfoc trace ─────────────────────────────────────────────────────────────
program
	.command("trace <query>")
	.description("Trace evidence-backed connections across sources")
	.requiredOption("-c, --collection <name>", "Collection name")
	.action(async (queryText: string, opts: { collection: string }) => {
		const store = createStore({ storage: "local" });
		const format = getFormat(program.opts());

		const head = await store.manifests.getHead(opts.collection);
		if (!head) {
			console.error(`Error: collection "${opts.collection}" not found`);
			process.exit(1);
		}

		if (format !== "quiet") console.error("⏳ Loading embedder + index...");

		// Load all segments and build vector index
		const { embedder, vectorIndex, segments } = await loadCollection(store, head.manifest);

		const result = await trace(queryText, embedder, vectorIndex, segments);
		console.log(formatTrace(result, format));
	});

// ─── wtfoc query ─────────────────────────────────────────────────────────────
program
	.command("query <queryText>")
	.description("Semantic search across collection")
	.requiredOption("-c, --collection <name>", "Collection name")
	.option("-k, --top-k <number>", "Number of results", "10")
	.action(async (queryText: string, opts: { collection: string; topK: string }) => {
		const store = createStore({ storage: "local" });
		const format = getFormat(program.opts());

		const head = await store.manifests.getHead(opts.collection);
		if (!head) {
			console.error(`Error: collection "${opts.collection}" not found`);
			process.exit(1);
		}

		if (format !== "quiet") console.error("⏳ Loading embedder + index...");

		const { embedder, vectorIndex } = await loadCollection(store, head.manifest);

		const result = await query(queryText, embedder, vectorIndex, {
			topK: Number.parseInt(opts.topK, 10),
		});
		console.log(formatQuery(result, format));
	});

// ─── wtfoc status ────────────────────────────────────────────────────────────
program
	.command("status")
	.description("Show collection status")
	.requiredOption("-c, --collection <name>", "Collection name")
	.action(async (opts: { collection: string }) => {
		const store = createStore({ storage: "local" });
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
		const store = createStore({ storage: "local" });
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
	embedder: Embedder;
	vectorIndex: VectorIndex;
	segments: Segment[];
}

async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: HeadManifest,
): Promise<LoadedCollection> {
	let embedder: Embedder;
	try {
		embedder = new TransformersEmbedder();
	} catch {
		embedder = {
			dimensions: manifest.embeddingDimensions,
			async embed(): Promise<Float32Array> {
				return new Float32Array(manifest.embeddingDimensions);
			},
			async embedBatch(texts: string[]): Promise<Float32Array[]> {
				return texts.map(() => new Float32Array(manifest.embeddingDimensions));
			},
		};
	}

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

	return { embedder, vectorIndex, segments };
}

// ─── Run ─────────────────────────────────────────────────────────────────────
program.parse();
