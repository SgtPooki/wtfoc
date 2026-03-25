/**
 * E2E: Ingest → Query round-trip via HTTP API.
 *
 * Seeds fixture data into a temp store, starts the web server,
 * then queries it over HTTP and validates results.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransformersEmbedder } from "@wtfoc/search";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_FOC_CLI, FIXTURE_SYNAPSE_SDK } from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";
import { type RunningServer, startServer } from "../../helpers/server.js";

let dataDir: string;
let manifestDir: string;
let server: RunningServer;
let embedder: TransformersEmbedder;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-iq-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-iq-manifest-"));

	embedder = new TransformersEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	// Seed a collection with two sources
	await seedCollection("test-project", [
		{ source: "synapse-sdk/README.md", content: FIXTURE_SYNAPSE_SDK },
		{ source: "foc-cli/README.md", content: FIXTURE_FOC_CLI },
	], { storage, manifests, embedder });

	server = await startServer({
		port: 3590,
		dataDir,
		manifestDir,
	});
}, 60_000);

afterAll(async () => {
	await server?.kill();
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

describe("ingest → query round-trip", () => {
	it("lists the seeded collection", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections`);
		expect(res.ok).toBe(true);
		const collections = await res.json() as Array<{ name: string; chunks: number }>;
		expect(collections.length).toBeGreaterThanOrEqual(1);
		const col = collections.find((c) => c.name === "test-project");
		expect(col).toBeTruthy();
		expect(col!.chunks).toBeGreaterThan(0);
	});

	it("returns collection status with embedding model", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/test-project/status`);
		expect(res.ok).toBe(true);
		const status = await res.json() as { collection: string; totalChunks: number; embeddingModel: string };
		expect(status.collection).toBe("test-project");
		expect(status.totalChunks).toBeGreaterThan(0);
		expect(status.embeddingModel).toBeTruthy();
	});

	it("returns relevant results for a semantic query", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/test-project/query?q=upload+file+storage`);
		expect(res.ok).toBe(true);
		const data = await res.json() as { results: Array<{ content: string; score: number; source: string }> };
		expect(data.results.length).toBeGreaterThan(0);

		// Results should be about uploading/storage since that's what we queried
		const topResult = data.results[0]!;
		expect(topResult.score).toBeGreaterThan(0);
		expect(topResult.content.length).toBeGreaterThan(0);
		expect(topResult.source).toBeTruthy();
	});

	it("returns results from both sources", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/test-project/query?q=upload&k=20`);
		expect(res.ok).toBe(true);
		const data = await res.json() as { results: Array<{ source: string }> };

		const sources = new Set(data.results.map((r) => r.source));
		expect(sources.size).toBeGreaterThanOrEqual(2);
	});

	it("returns 400 for missing query parameter", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/test-project/query`);
		expect(res.status).toBe(400);
	});

	it("returns 404 for non-existent collection", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/does-not-exist/status`);
		expect(res.status).toBe(404);
	});
});
