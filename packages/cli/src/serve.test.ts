/**
 * HTTP E2E test for the serve endpoints.
 * Starts a real server on port 0, seeds a collection, and validates all API endpoints.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedder } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { buildSegment, chunkMarkdown, RegexEdgeExtractor } from "@wtfoc/ingest";
import { generateCollectionId, LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ServerHandle, startServer } from "./serve.js";

const EMBED_DIMS = 32;
const COLLECTION_NAME = "serve-test";

function testEmbedder(): Embedder {
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
		async embed(text: string) {
			return hashToVector(text);
		},
		async embedBatch(texts: string[]) {
			return texts.map(hashToVector);
		},
	};
}

let dataDir: string;
let manifestDir: string;
let handle: ServerHandle;
let baseUrl: string;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-serve-test-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-serve-test-manifest-"));

	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);
	const embedder = testEmbedder();

	// Seed a collection
	const markdown = [
		"# Upload Guide\n\nHow to upload files using the SDK.",
		"# Troubleshooting\n\nIf uploads timeout, check your network connection.",
	].join("\n\n---\n\n");
	const chunks = chunkMarkdown(markdown, { source: "docs/upload.md" });
	const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));
	const extractor = new RegexEdgeExtractor();
	const edges = await extractor.extract(chunks);
	const segmentChunks = chunks.map((chunk, i) => {
		const emb = embeddings[i];
		if (!emb) throw new Error(`Missing embedding ${i}`);
		return { chunk, embedding: Array.from(emb) };
	});
	const segment = buildSegment(segmentChunks, edges, {
		embeddingModel: "test-hash",
		embeddingDimensions: EMBED_DIMS,
	});

	const segBytes = new TextEncoder().encode(JSON.stringify(segment));
	const segResult = await storage.upload(segBytes);
	const collectionId = generateCollectionId(COLLECTION_NAME);
	const now = new Date().toISOString();
	await manifests.putHead(
		COLLECTION_NAME,
		{
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId,
			name: COLLECTION_NAME,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: segResult.id, sourceTypes: ["markdown"], chunkCount: chunks.length }],
			totalChunks: chunks.length,
			embeddingModel: "test-hash",
			embeddingDimensions: EMBED_DIMS,
			createdAt: now,
			updatedAt: now,
		},
		null,
	);

	handle = await startServer({
		store: { storage, manifests },
		collection: COLLECTION_NAME,
		embedder,
		port: 0,
		html: "<html><body>test</body></html>",
		manifestDir,
	});

	const addr = handle.server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	baseUrl = `http://localhost:${port}`;
}, 30_000);

afterAll(async () => {
	if (handle?.server) {
		await new Promise<void>((resolve) => handle.server.close(() => resolve()));
	}
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

describe("serve HTTP endpoints", () => {
	it("GET /api/status returns collection metadata", async () => {
		const res = await fetch(`${baseUrl}/api/status`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.collection).toBe(COLLECTION_NAME);
		expect(body.totalChunks).toBeGreaterThan(0);
		expect(body.embeddingModel).toBe("test-hash");
	});

	it("GET /api/collections lists collections", async () => {
		const res = await fetch(`${baseUrl}/api/collections`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
		expect(body[0].name).toBe(COLLECTION_NAME);
	});

	it("GET /api/query?q= returns valid query response", async () => {
		const res = await fetch(`${baseUrl}/api/query?q=upload`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.query).toBe("upload");
		expect(Array.isArray(body.results)).toBe(true);
		// Results may be empty with hash-based embedder (query/content vectors diverge);
		// what matters is the endpoint returns a valid response shape
	});

	it("GET /api/query without q returns 400", async () => {
		const res = await fetch(`${baseUrl}/api/query`);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBeDefined();
	});

	it("GET /api/trace?q= returns trace structure", async () => {
		const res = await fetch(`${baseUrl}/api/trace?q=upload`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.query).toBe("upload");
		expect(body.stats).toBeDefined();
	});

	it("GET /api/sources returns source breakdown", async () => {
		const res = await fetch(`${baseUrl}/api/sources`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.markdown).toBeDefined();
		expect(body.markdown.count).toBeGreaterThan(0);
	});

	it("GET /api/edges returns edge stats", async () => {
		const res = await fetch(`${baseUrl}/api/edges`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(typeof body.totalEdges).toBe("number");
	});

	it("GET /nonexistent returns 404", async () => {
		const res = await fetch(`${baseUrl}/nonexistent`);
		expect(res.status).toBe(404);
	});

	it("OPTIONS /api/query returns CORS headers", async () => {
		const res = await fetch(`${baseUrl}/api/query`, { method: "OPTIONS" });
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("GET / returns SPA HTML", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("<html>");
	});
});
