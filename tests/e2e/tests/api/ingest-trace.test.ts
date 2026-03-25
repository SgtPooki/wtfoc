/**
 * E2E: Ingest → Trace round-trip via HTTP API.
 *
 * Validates that the trace endpoint returns grouped results with hop metadata.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransformersEmbedder } from "@wtfoc/search";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FIXTURE_FOC_CLI,
	FIXTURE_KNOWLEDGE_BASE,
	FIXTURE_SYNAPSE_SDK,
} from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";
import { type RunningServer, startServer } from "../../helpers/server.js";

let dataDir: string;
let manifestDir: string;
let server: RunningServer;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-trace-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-trace-manifest-"));

	const embedder = new TransformersEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	await seedCollection("trace-test", [
		{ source: "synapse-sdk/README.md", content: FIXTURE_SYNAPSE_SDK },
		{ source: "foc-cli/README.md", content: FIXTURE_FOC_CLI },
		{ source: "kb/architecture.md", content: FIXTURE_KNOWLEDGE_BASE },
	], { storage, manifests, embedder });

	server = await startServer({
		port: 3591,
		dataDir,
		manifestDir,
	});
}, 60_000);

afterAll(async () => {
	await server?.kill();
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

describe("ingest → trace round-trip", () => {
	it("returns trace results with groups and stats", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/trace-test/trace?q=vector+embeddings+search`);
		expect(res.ok).toBe(true);
		const data = await res.json() as {
			query: string;
			stats: { totalHops: number; semanticHops: number; edgeHops: number };
			groups: Record<string, Array<{ content: string; sourceType: string }>>;
		};

		expect(data.query).toBe("vector embeddings search");
		expect(data.stats.totalHops).toBeGreaterThan(0);
		expect(data.stats.semanticHops).toBeGreaterThan(0);

		const groupKeys = Object.keys(data.groups);
		expect(groupKeys.length).toBeGreaterThan(0);

		// Each group should have hops with content
		for (const key of groupKeys) {
			const hops = data.groups[key]!;
			expect(hops.length).toBeGreaterThan(0);
			for (const hop of hops) {
				expect(hop.content).toBeTruthy();
				expect(hop.sourceType).toBeTruthy();
			}
		}
	});

	it("edge extraction produces edges from cross-references in fixtures", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/trace-test/edges`);
		expect(res.ok).toBe(true);
		const data = await res.json() as { totalEdges: number; resolvedEdges: number };
		// Fixtures contain "Refs #42" and "closes #15" which should produce edges
		expect(data.totalEdges).toBeGreaterThan(0);
	});

	it("returns 400 for missing trace query", async () => {
		const res = await fetch(`${server.baseUrl}/api/collections/trace-test/trace`);
		expect(res.status).toBe(400);
	});
});
