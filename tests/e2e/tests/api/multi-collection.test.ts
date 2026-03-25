/**
 * E2E: Multi-collection isolation.
 *
 * Queries against collection A must not return collection B results.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransformersEmbedder } from "@wtfoc/search";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_FOC_CLI, FIXTURE_KNOWLEDGE_BASE } from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";
import { type RunningServer, startServer } from "../../helpers/server.js";

let dataDir: string;
let manifestDir: string;
let server: RunningServer;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-multi-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-multi-manifest-"));

	const embedder = new TransformersEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	// Seed two isolated collections with distinct content
	await seedCollection("collection-cli", [
		{ source: "foc-cli/README.md", content: FIXTURE_FOC_CLI },
	], { storage, manifests, embedder });

	await seedCollection("collection-kb", [
		{ source: "kb/architecture.md", content: FIXTURE_KNOWLEDGE_BASE },
	], { storage, manifests, embedder });

	server = await startServer({
		port: 3592,
		dataDir,
		manifestDir,
	});
}, 60_000);

afterAll(async () => {
	await server?.kill();
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

describe("multi-collection isolation", () => {
	it("lists both collections", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections`);
		const collections = await res.json() as Array<{ name: string }>;
		const names = collections.map((c) => c.name);
		expect(names).toContain("collection-cli");
		expect(names).toContain("collection-kb");
	});

	it("collection-cli results only contain CLI sources", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/collection-cli/query?q=command+line&k=20`);
		const data = await res.json() as { results: Array<{ source: string }> };
		expect(data.results.length).toBeGreaterThan(0);
		for (const r of data.results) {
			expect(r.source).toContain("foc-cli");
		}
	});

	it("collection-kb results only contain KB sources", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/collection-kb/query?q=ingestion+pipeline&k=20`);
		const data = await res.json() as { results: Array<{ source: string }> };
		expect(data.results.length).toBeGreaterThan(0);
		for (const r of data.results) {
			expect(r.source).toContain("kb");
		}
	});
});
