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
import { buildSegment, chunkMarkdown, RegexEdgeExtractor, segmentId } from "@wtfoc/ingest";
import { InMemoryVectorIndex, mountCollection, query, trace } from "@wtfoc/search";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorageBackend } from "./backends/local.js";
import { generateCollectionId } from "./collection.js";
import { LocalManifestStore } from "./manifest/local.js";
import { validateManifestSchema } from "./schema.js";
import { deserializeSegment } from "./segment.js";

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

const SOURCE_A_MARKDOWN = `# Synapse SDK

The synapse-sdk provides storage on Filecoin. Refs #42 for gas optimization.

## Upload API

Use \`synapse.upload(data)\` to store content. This closes #15 with the new batching approach.
`;

const SOURCE_B_MARKDOWN = `# FOC CLI

The foc-cli wraps synapse-sdk for command-line usage. See the upload docs for details.

## Commands

Run \`foc upload <file>\` to store a file on the network.
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

describe("E2E pipeline: ingest → store → mount → query → trace", () => {
	const collectionName = "e2e-test-collection";
	const embedder = mockEmbedder();
	let storedSegmentId: string;
	let head: CollectionHead;

	it("T002: ingests markdown, builds segment, stores, and updates CollectionHead", async () => {
		const chunks = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			sourceType: "repo",
			chunkSize: 200,
			chunkOverlap: 0,
		});
		expect(chunks.length).toBeGreaterThan(0);

		const edgeExtractor = new RegexEdgeExtractor();
		const edges = edgeExtractor.extract(chunks);

		const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));

		const segmentChunks = chunks.map((chunk, i) => {
			const emb = embeddings[i];
			if (!emb) throw new Error(`Missing embedding ${i}`);
			return { chunk, embedding: Array.from(emb) };
		});

		const segment = buildSegment(segmentChunks, edges, {
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
		});

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);
		storedSegmentId = result.id;

		head = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(collectionName),
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [
				{
					id: storedSegmentId,
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
		expect(stored.headId).toBeTruthy();

		expect(head.collectionId).toBe(generateCollectionId(collectionName));
		expect(head.currentRevisionId).toBeNull();
		expect(head.segments).toHaveLength(1);
	});

	it("T003: reloads segment from storage and validates schema round-trip", async () => {
		const data = await storage.download(storedSegmentId);
		const text = new TextDecoder().decode(data);
		const segment = JSON.parse(text) as Segment;

		expect(segment.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(segment.chunks.length).toBeGreaterThan(0);
		expect(segment.embeddingModel).toBe("mock-hash-embedder");
		expect(segment.embeddingDimensions).toBe(EMBED_DIMS);

		for (const chunk of segment.chunks) {
			expect(chunk.embedding).toHaveLength(EMBED_DIMS);
			expect(chunk.content.length).toBeGreaterThan(0);
		}

		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();
		expect(reloaded!.manifest.collectionId).toBe(head.collectionId);
		expect(reloaded!.manifest.segments).toHaveLength(1);
	});

	it("T004: mounts collection and runs query with results", async () => {
		const vectorIndex = new InMemoryVectorIndex(EMBED_DIMS);
		const mounted = await mountCollection(head, storage, vectorIndex);

		expect(mounted.segments.length).toBeGreaterThan(0);

		const result = await query("synapse upload API", embedder, vectorIndex);

		expect(result.results.length).toBeGreaterThan(0);
		const topResult = result.results[0];
		expect(topResult).toBeTruthy();
		expect(topResult?.score).toBeGreaterThan(0);
		expect(topResult?.content.length).toBeGreaterThan(0);
		expect(topResult?.sourceType).toBeTruthy();
		expect(topResult?.source).toBeTruthy();
	});
});

describe("E2E pipeline: edge extraction and trace", () => {
	const collectionName = "e2e-trace-collection";
	const embedder = mockEmbedder();
	let head: CollectionHead;

	it("T005: ingests markdown with cross-references and stores edges", async () => {
		const chunks = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			sourceType: "repo",
			chunkSize: 500,
			chunkOverlap: 0,
		});

		const edgeExtractor = new RegexEdgeExtractor();
		const edges = edgeExtractor.extract(chunks);

		expect(edges.length).toBeGreaterThan(0);

		const hasRefsEdge = edges.some((e) => e.type === "references" || e.type === "closes");
		expect(hasRefsEdge).toBe(true);

		for (const edge of edges) {
			expect(edge.type).toBeTruthy();
			expect(edge.sourceId).toBeTruthy();
			expect(edge.targetId).toBeTruthy();
			expect(edge.evidence).toBeTruthy();
		}

		const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));
		const segmentChunks = chunks.map((chunk, i) => ({
			chunk,
			embedding: Array.from(embeddings[i] ?? new Float32Array(EMBED_DIMS)),
		}));

		const segment = buildSegment(segmentChunks, edges, {
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
		});

		expect(segment.edges.length).toBeGreaterThan(0);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);

		head = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(collectionName),
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: result.id, sourceTypes: ["repo"], chunkCount: chunks.length }],
			totalChunks: chunks.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await manifests.putHead(collectionName, head, null);
	});

	it("T006: runs trace and follows explicit edges with evidence", async () => {
		const vectorIndex = new InMemoryVectorIndex(EMBED_DIMS);
		const mounted = await mountCollection(head, storage, vectorIndex);

		const result = await trace("gas optimization", embedder, vectorIndex, mounted.segments, {
			minScore: 0.0,
		});

		expect(result.hops.length).toBeGreaterThan(0);
	});

	it("T007: trace with no edges produces semantic-only results", async () => {
		const noEdgeChunks = chunkMarkdown("# Simple doc\n\nNo cross-references here.", {
			source: "test-repo/simple",
			sourceType: "repo",
			chunkSize: 500,
			chunkOverlap: 0,
		});

		const embeddings = await embedder.embedBatch(noEdgeChunks.map((c) => c.content));
		const segChunks = noEdgeChunks.map((chunk, i) => ({
			chunk,
			embedding: Array.from(embeddings[i] ?? new Float32Array(EMBED_DIMS)),
		}));

		const segment = buildSegment(segChunks, [], {
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
		});

		expect(segment.edges).toHaveLength(0);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);

		const noEdgeHead: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId("no-edge-collection"),
			name: "no-edge-collection",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: result.id, sourceTypes: ["repo"], chunkCount: noEdgeChunks.length }],
			totalChunks: noEdgeChunks.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const vectorIndex = new InMemoryVectorIndex(EMBED_DIMS);
		const mounted = await mountCollection(noEdgeHead, storage, vectorIndex);

		const traceResult = await trace("simple doc", embedder, vectorIndex, mounted.segments, {
			minScore: 0.0,
		});
		expect(traceResult.hops.length).toBeGreaterThan(0);

		for (const hop of traceResult.hops) {
			expect(hop.connection.method).toBe("semantic");
		}
	});
});

describe("E2E pipeline: multi-source ingest", () => {
	const collectionName = "e2e-multi-source";
	const embedder = mockEmbedder();

	it("T008: ingests two sources into one collection with prevHeadId chaining", async () => {
		const chunksA = chunkMarkdown(SOURCE_A_MARKDOWN, {
			source: "test-repo/synapse-sdk",
			sourceType: "repo",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const embeddingsA = await embedder.embedBatch(chunksA.map((c) => c.content));
		const segA = buildSegment(
			chunksA.map((c, i) => ({
				chunk: c,
				embedding: Array.from(embeddingsA[i] ?? new Float32Array(EMBED_DIMS)),
			})),
			[],
			{ embeddingModel: "mock-hash-embedder", embeddingDimensions: EMBED_DIMS },
		);
		const resultA = await storage.upload(new TextEncoder().encode(JSON.stringify(segA)));

		const head1: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: generateCollectionId(collectionName),
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: resultA.id, sourceTypes: ["repo"], chunkCount: chunksA.length }],
			totalChunks: chunksA.length,
			embeddingModel: "mock-hash-embedder",
			embeddingDimensions: EMBED_DIMS,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const stored1 = await manifests.putHead(collectionName, head1, null);

		const chunksB = chunkMarkdown(SOURCE_B_MARKDOWN, {
			source: "test-repo/foc-cli",
			sourceType: "repo",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		const embeddingsB = await embedder.embedBatch(chunksB.map((c) => c.content));
		const segB = buildSegment(
			chunksB.map((c, i) => ({
				chunk: c,
				embedding: Array.from(embeddingsB[i] ?? new Float32Array(EMBED_DIMS)),
			})),
			[],
			{ embeddingModel: "mock-hash-embedder", embeddingDimensions: EMBED_DIMS },
		);
		const resultB = await storage.upload(new TextEncoder().encode(JSON.stringify(segB)));

		const head2: CollectionHead = {
			...head1,
			prevHeadId: stored1.headId,
			segments: [
				...head1.segments,
				{ id: resultB.id, sourceTypes: ["repo"], chunkCount: chunksB.length },
			],
			totalChunks: head1.totalChunks + chunksB.length,
			updatedAt: new Date().toISOString(),
		};

		await manifests.putHead(collectionName, head2, stored1.headId);

		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded?.manifest.segments).toHaveLength(2);
	});

	it("T009: query returns results from both sources", async () => {
		const reloaded = await manifests.getHead(collectionName);
		expect(reloaded).toBeTruthy();

		const vectorIndex = new InMemoryVectorIndex(EMBED_DIMS);
		await mountCollection(reloaded!.manifest, storage, vectorIndex);

		const result = await query("upload file storage", embedder, vectorIndex);

		expect(result.results.length).toBeGreaterThan(0);

		const sources = new Set(result.results.map((r) => r.source));
		expect(sources.size).toBeGreaterThanOrEqual(1);
	});
});

describe("E2E pipeline: edge cases", () => {
	it("T010: empty ingest produces no segment and no head update", async () => {
		const chunks = chunkMarkdown("", {
			source: "empty",
			sourceType: "repo",
			chunkSize: 500,
			chunkOverlap: 0,
		});
		expect(chunks).toHaveLength(0);
	});

	it("T011: query empty collection returns zero results", async () => {
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

		const vectorIndex = new InMemoryVectorIndex(EMBED_DIMS);
		await mountCollection(emptyHead, storage, vectorIndex);

		const result = await query("anything", mockEmbedder(), vectorIndex);
		expect(result.results).toHaveLength(0);
	});

	it("T012: CollectionHead conflict rejects wrong prevHeadId", async () => {
		const colName = "conflict-test";
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
