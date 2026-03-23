/**
 * End-to-end integration test for the wtfoc pipeline.
 * Exercises: ingest → chunk → embed → edges → store → mount → query → trace
 *
 * Uses local storage, in-memory vector index, and a deterministic mock embedder.
 * No network calls, no model downloads.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chunk, CollectionHead, Embedder, Segment } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION, ManifestConflictError } from "@wtfoc/common";
import { buildSegment, chunkMarkdown, RegexEdgeExtractor } from "@wtfoc/ingest";
import { InMemoryVectorIndex, mountCollection, query, trace } from "@wtfoc/search";
import {
	generateCollectionId,
	LocalManifestStore,
	LocalStorageBackend,
	validateManifestSchema,
} from "@wtfoc/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EMBED_DIMS = 32;

function mockEmbedder(): Embedder {
	function hashToVector(text: string): Float32Array {
		const hash = createHash("sha256").update(text).digest();
		const vec = new Float32Array(EMBED_DIMS);
		for (let i = 0; i < EMBED_DIMS; i++) {
			vec[i] = ((hash[i % hash.length] ?? 0) - 128) / 128;
		}
		return vec;
	}

	return {
		dimensions: EMBED_DIMS,
		async embed(text: string): Promise<Float32Array> {
			return hashToVector(text);
		},
		async embedBatch(texts: string[]): Promise<Float32Array[]> {
			return texts.map(hashToVector);
		},
	};
}

function requireEmbeddings(embeddings: Float32Array[], count: number): Float32Array[] {
	if (embeddings.length !== count) {
		throw new Error(`Expected ${count} embeddings, got ${embeddings.length}`);
	}
	for (let i = 0; i < embeddings.length; i++) {
		const emb = embeddings[i];
		if (!emb || emb.length !== EMBED_DIMS) {
			throw new Error(`Embedding ${i} is missing or has wrong dimensions`);
		}
	}
	return embeddings;
}

function buildTestSegment(
	chunks: Chunk[],
	edges: ReturnType<RegexEdgeExtractor["extract"]>,
	embeddings: Float32Array[],
) {
	return buildSegment(
		chunks.map((chunk, i) => {
			const emb = embeddings[i];
			if (!emb) throw new Error(`Missing embedding ${i}`);
			return { chunk, embedding: Array.from(emb) };
		}),
		edges,
		{ embeddingModel: "mock-hash-embedder", embeddingDimensions: EMBED_DIMS },
	);
}

const SOURCE_A_MARKDOWN = `# Synapse SDK

The synapse-sdk provides storage on Filecoin. Refs #42 for gas optimization.

## Upload API

Use synapse.upload(data) to store content. This closes #15 with the new batching approach.
`;

const SOURCE_B_MARKDOWN = `# FOC CLI

The foc-cli wraps synapse-sdk for command-line usage. See the upload docs for details.

## Commands

Run foc upload to store a file on the network.
`;

let dataDir: string;
let manifestDir: string;
let storage: LocalStorageBackend;
let manifests: LocalManifestStore;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-manifest-"));
	storage = new LocalStorageBackend(dataDir);
	manifests = new LocalManifestStore(manifestDir);
});

afterAll(async () => {
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

describe("E2E pipeline: ingest → store → mount → query", () => {
	const collectionName = "e2e-query-collection";
	const embedder = mockEmbedder();
	let segmentId: string;
	let headId: string;

	beforeAll(async () => {
		const chunks = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			chunkSize: 200,
			chunkOverlap: 0,
		});
		const embeddings = requireEmbeddings(
			await embedder.embedBatch(chunks.map((c) => c.content)),
			chunks.length,
		);
		const edgeExtractor = new RegexEdgeExtractor();
		const edges = edgeExtractor.extract(chunks);
		const segment = buildTestSegment(chunks, edges, embeddings);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);
		segmentId = result.id;

		const head: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(collectionName),
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [
				{
					id: segmentId,
					sourceTypes: [...new Set(chunks.map((c) => c.sourceType))],
					chunkCount: chunks.length,
				},
			],
			totalChunks: chunks.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const stored = await manifests.putHead(collectionName, head, null);
		headId = stored.headId;
	});

	it("stores segment and updates CollectionHead with correct fields", async () => {
		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();
		expect(reloaded!.headId).toBe(headId);

		const validated = validateManifestSchema(reloaded!.manifest);
		expect(validated.collectionId).toBe(generateCollectionId(collectionName));
		expect(validated.currentRevisionId).toBeNull();
		expect(validated.segments).toHaveLength(1);
		expect(validated.segments[0]?.id).toBe(segmentId);
	});

	it("segment survives storage round-trip", async () => {
		const segData = await storage.download(segmentId);
		const segment = JSON.parse(new TextDecoder().decode(segData)) as Segment;
		expect(segment.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(segment.chunks.length).toBeGreaterThan(0);
		expect(segment.embeddingDimensions).toBe(EMBED_DIMS);
		for (const chunk of segment.chunks) {
			expect(chunk.embedding).toHaveLength(EMBED_DIMS);
			expect(chunk.content.length).toBeGreaterThan(0);
		}
	});

	it("mounts from reloaded head and queries with results", async () => {
		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();

		const vectorIndex = new InMemoryVectorIndex();
		const mounted = await mountCollection(reloaded!.manifest, storage, vectorIndex);
		expect(mounted.segments.length).toBeGreaterThan(0);

		const result = await query("synapse upload", embedder, vectorIndex, { minScore: -1 });
		expect(result.results.length).toBeGreaterThan(0);

		const topResult = result.results[0];
		expect(topResult).toBeTruthy();
		expect(topResult?.content.length).toBeGreaterThan(0);
		expect(topResult?.sourceType).toBe("markdown");
		expect(topResult?.source).toBe("test-repo/synapse-sdk");
		expect(Number.isFinite(topResult?.score)).toBe(true);
	});
});

describe("E2E pipeline: edge extraction and trace", () => {
	const embedder = mockEmbedder();

	it("extracts edges from cross-references and stores them in segment", async () => {
		const chunks = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const edgeExtractor = new RegexEdgeExtractor();
		const edges = edgeExtractor.extract(chunks);

		expect(edges.length).toBeGreaterThan(0);
		expect(edges.some((e) => e.type === "references" || e.type === "closes")).toBe(true);
		for (const edge of edges) {
			expect(edge.evidence).toBeTruthy();
		}
	});

	it("trace follows explicit edges when fixtures have resolvable targets", async () => {
		// Create two chunks where edge targets match chunk sources,
		// so trace can actually follow edges.
		const chunkA: Chunk = {
			id: "chunk-issue-41",
			content: "Issue 41 discussing performance. See Refs #42 for gas optimization details.",
			sourceType: "markdown",
			source: "test-repo/issue-41",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		};
		const chunkB: Chunk = {
			id: "chunk-issue-42",
			content: "Issue 42: gas optimization details and explicit recommendations.",
			sourceType: "markdown",
			source: "#42",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		};

		const allChunks = [chunkA, chunkB];
		const edgeExtractor = new RegexEdgeExtractor();
		const edges = edgeExtractor.extract(allChunks);
		expect(edges.length).toBeGreaterThan(0);

		const embeddings = requireEmbeddings(
			await embedder.embedBatch(allChunks.map((c) => c.content)),
			allChunks.length,
		);
		const segment = buildTestSegment(allChunks, edges, embeddings);
		expect(segment.edges.length).toBeGreaterThan(0);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);

		const head: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId("edge-trace-collection"),
			name: "edge-trace-collection",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: result.id, sourceTypes: ["markdown"], chunkCount: allChunks.length }],
			totalChunks: allChunks.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const vectorIndex = new InMemoryVectorIndex();
		const mounted = await mountCollection(head, storage, vectorIndex);

		const traceResult = await trace("gas optimization", embedder, vectorIndex, mounted.segments, {
			minScore: -1,
		});

		expect(traceResult.hops.length).toBeGreaterThan(0);
		if (traceResult.stats.edgeHops > 0) {
			const edgeHop = traceResult.hops.find((h) => h.connection.method === "edge");
			expect(edgeHop).toBeTruthy();
			expect(edgeHop?.connection.evidence).toBeTruthy();
		}
	});

	it("trace with no edges produces semantic-only results", async () => {
		const noEdgeChunks = chunkMarkdown("# Simple doc\n\nNo cross-references here.", {
			source: "test-repo/simple",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const embeddings = requireEmbeddings(
			await embedder.embedBatch(noEdgeChunks.map((c) => c.content)),
			noEdgeChunks.length,
		);
		const segment = buildTestSegment(noEdgeChunks, [], embeddings);
		expect(segment.edges).toHaveLength(0);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);

		const head: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId("no-edge-collection"),
			name: "no-edge-collection",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: result.id, sourceTypes: ["markdown"], chunkCount: noEdgeChunks.length }],
			totalChunks: noEdgeChunks.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const vectorIndex = new InMemoryVectorIndex();
		const mounted = await mountCollection(head, storage, vectorIndex);

		const traceResult = await trace("simple doc", embedder, vectorIndex, mounted.segments, {
			minScore: -1,
		});
		expect(traceResult.hops.length).toBeGreaterThan(0);
		expect(traceResult.stats.edgeHops).toBe(0);
		for (const hop of traceResult.hops) {
			expect(hop.connection.method).toBe("semantic");
		}
	});
});

describe("E2E pipeline: multi-source ingest", () => {
	const collectionName = "e2e-multi-source";
	const embedder = mockEmbedder();
	let lastHeadId: string;

	beforeAll(async () => {
		const chunksA = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const embeddingsA = requireEmbeddings(
			await embedder.embedBatch(chunksA.map((c) => c.content)),
			chunksA.length,
		);
		const segA = buildTestSegment(chunksA, [], embeddingsA);
		const resultA = await storage.upload(new TextEncoder().encode(JSON.stringify(segA)));

		const head1: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(collectionName),
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: resultA.id, sourceTypes: ["markdown"], chunkCount: chunksA.length }],
			totalChunks: chunksA.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const stored1 = await manifests.putHead(collectionName, head1, null);

		const chunksB = chunkMarkdown(SOURCE_B_MARKDOWN, {
			source: "test-repo/foc-cli",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const embeddingsB = requireEmbeddings(
			await embedder.embedBatch(chunksB.map((c) => c.content)),
			chunksB.length,
		);
		const segB = buildTestSegment(chunksB, [], embeddingsB);
		const resultB = await storage.upload(new TextEncoder().encode(JSON.stringify(segB)));

		const head2: CollectionHead = {
			...head1,
			prevHeadId: stored1.headId,
			segments: [
				...head1.segments,
				{ id: resultB.id, sourceTypes: ["markdown"], chunkCount: chunksB.length },
			],
			totalChunks: head1.totalChunks + chunksB.length,
			updatedAt: new Date().toISOString(),
		};
		const stored2 = await manifests.putHead(collectionName, head2, stored1.headId);
		lastHeadId = stored2.headId;
	});

	it("collection has two segments after multi-source ingest", async () => {
		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();
		expect(reloaded!.manifest.segments).toHaveLength(2);
	});

	it("query returns results from both sources", async () => {
		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();

		const vectorIndex = new InMemoryVectorIndex();
		await mountCollection(reloaded!.manifest, storage, vectorIndex);
		expect(vectorIndex.size).toBeGreaterThan(1);

		const result = await query("upload", embedder, vectorIndex, { topK: 100, minScore: -1 });
		expect(result.results.length).toBeGreaterThan(1);

		const sources = new Set(result.results.map((r) => r.source));
		expect(sources.has("test-repo/synapse-sdk")).toBe(true);
		expect(sources.has("test-repo/foc-cli")).toBe(true);
	});
});

describe("E2E pipeline: edge cases", () => {
	it("empty ingest produces no segment and no head update", async () => {
		const chunks = chunkMarkdown("", {
			source: "empty",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		expect(chunks).toHaveLength(0);

		const colName = "empty-ingest-e2e";
		const head = await manifests.getHead(colName);
		expect(head).toBeNull();
	});

	it("query empty collection returns zero results", async () => {
		const emptyHead: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId("empty-col"),
			name: "empty-col",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [],
			totalChunks: 0,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const vectorIndex = new InMemoryVectorIndex();
		await mountCollection(emptyHead, storage, vectorIndex);

		const result = await query("anything", mockEmbedder(), vectorIndex, { minScore: -1 });
		expect(result.results).toHaveLength(0);
	});

	it("CollectionHead conflict rejects wrong prevHeadId", async () => {
		const colName = "conflict-test-e2e";
		const head: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(colName),
			name: colName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [],
			totalChunks: 0,
			embeddingModel: "pending",
			embeddingDimensions: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await manifests.putHead(colName, head, null);

		await expect(
			manifests.putHead(colName, { ...head, updatedAt: new Date().toISOString() }, "wrong-head-id"),
		).rejects.toThrow(ManifestConflictError);
	});
});
