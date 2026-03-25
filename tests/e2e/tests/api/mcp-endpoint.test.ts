/**
 * E2E: MCP-over-HTTP endpoint.
 *
 * Tests that POST /mcp accepts MCP JSON-RPC requests and returns valid responses.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { createTestEmbedder } from "../../helpers/embedder.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_SYNAPSE_SDK } from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";
import { type RunningServer, startServer } from "../../helpers/server.js";

let dataDir: string;
let manifestDir: string;
let server: RunningServer;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-mcp-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-mcp-manifest-"));

	const embedder = createTestEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	await seedCollection("mcp-test", [
		{ source: "synapse-sdk/README.md", content: FIXTURE_SYNAPSE_SDK },
	], { storage, manifests, embedder });

	server = await startServer({
		port: 3593,
		dataDir,
		manifestDir,
	});
}, 60_000);

afterAll(async () => {
	await server?.kill();
	await rm(dataDir, { recursive: true, force: true });
	await rm(manifestDir, { recursive: true, force: true });
});

/** Send an MCP JSON-RPC request and return the parsed response */
async function mcpRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(`${server.baseUrl}/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Accept": "text/event-stream, application/json",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method,
			params: params ?? {},
		}),
	});
	expect(res.ok).toBe(true);

	// MCP Streamable HTTP returns SSE format
	const text = await res.text();
	// Extract JSON-RPC response from SSE events
	const lines = text.split("\n");
	for (const line of lines) {
		if (line.startsWith("data: ")) {
			return JSON.parse(line.slice(6));
		}
	}
	throw new Error(`No data event in MCP response: ${text}`);
}

describe("MCP-over-HTTP endpoint", () => {
	it("responds to initialize", async () => {
		const result = await mcpRequest("initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "e2e-test", version: "0.0.0" },
		}) as { result?: { serverInfo: { name: string } } };
		expect(result.result?.serverInfo.name).toBeTruthy();
	});

	it("initialize response includes server capabilities", async () => {
		const result = await mcpRequest("initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "e2e-test", version: "0.0.0" },
		}) as { result?: { capabilities: { tools?: unknown } } };
		// Server should advertise tool capabilities
		expect(result.result?.capabilities).toBeTruthy();
	});

	it("DELETE /mcp returns 200", async () => {
		const res = await fetch(`${server.baseUrl}/mcp`, { method: "DELETE" });
		expect(res.status).toBe(200);
	});

	it("rejects invalid JSON", async () => {
		const res = await fetch(`${server.baseUrl}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});
});
