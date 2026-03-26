/**
 * Integration tests for embedder profiles.
 * Spins up a real HTTP server to verify the full pipeline:
 * profile resolution → prefix application → API request → response parsing.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EMBEDDER_PROFILES } from "@wtfoc/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAIEmbedder } from "./openai.js";

/** Captured request bodies from the mock server */
const capturedRequests: Array<{ model: string; input: string[]; dimensions?: number }> = [];
let serverUrl: string;
let server: ReturnType<typeof createServer>;

function fakeEmbedding(dims: number): number[] {
	return Array.from({ length: dims }, (_, i) => Math.sin(i) * 0.01);
}

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			server = createServer((req: IncomingMessage, res: ServerResponse) => {
				let body = "";
				req.on("data", (chunk) => {
					body += chunk;
				});
				req.on("end", () => {
					const parsed = JSON.parse(body);
					capturedRequests.push(parsed);

					const dims = parsed.dimensions ?? 768;
					const embeddings = (parsed.input as string[]).map((_text: string, index: number) => ({
						embedding: fakeEmbedding(dims),
						index,
					}));

					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ data: embeddings }));
				});
			});
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				if (typeof addr === "object" && addr) {
					serverUrl = `http://127.0.0.1:${addr.port}/v1`;
				}
				resolve();
			});
		}),
);

afterAll(
	() =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		}),
);

describe("OpenAIEmbedder integration with profiles", () => {
	it("nomic profile: applies search_query: prefix on embed()", async () => {
		const profile = EMBEDDER_PROFILES.nomic;
		if (!profile) throw new Error("nomic profile not found");

		capturedRequests.length = 0;

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: profile.model,
			dimensions: profile.dimensions,
			prefix: profile.prefix,
		});

		const result = await embedder.embed("what is IPFS?");

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(768);
		expect(capturedRequests).toHaveLength(1);
		expect(capturedRequests[0]?.input[0]).toBe("search_query: what is IPFS?");
		expect(capturedRequests[0]?.model).toBe("nomic-embed-text");
	});

	it("nomic profile: applies search_document: prefix on embedBatch()", async () => {
		capturedRequests.length = 0;
		const profile = EMBEDDER_PROFILES.nomic;
		if (!profile) throw new Error("nomic profile not found");

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: profile.model,
			dimensions: profile.dimensions,
			prefix: profile.prefix,
		});

		const results = await embedder.embedBatch(["doc about CIDs", "doc about DAGs"]);

		expect(results).toHaveLength(2);
		expect(capturedRequests[0]?.input).toEqual([
			"search_document: doc about CIDs",
			"search_document: doc about DAGs",
		]);
	});

	it("qwen3 profile: applies instruct prefix on embed()", async () => {
		capturedRequests.length = 0;
		const profile = EMBEDDER_PROFILES["qwen3-0.6b"];
		if (!profile) throw new Error("qwen3-0.6b profile not found");

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: profile.model,
			dimensions: profile.dimensions,
			prefix: profile.prefix,
		});

		await embedder.embed("what changed last week?");

		expect(capturedRequests[0]?.input[0]).toBe(
			"Instruct: Given a query, retrieve relevant passages\nQuery: what changed last week?",
		);
	});

	it("qwen3 profile: no prefix on document embedBatch()", async () => {
		capturedRequests.length = 0;
		const profile = EMBEDDER_PROFILES["qwen3-0.6b"];
		if (!profile) throw new Error("qwen3-0.6b profile not found");

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: profile.model,
			dimensions: profile.dimensions,
			prefix: profile.prefix,
		});

		await embedder.embedBatch(["raw document text"]);

		// qwen3 document prefix is empty string, so no prefix applied
		expect(capturedRequests[0]?.input[0]).toBe("raw document text");
	});

	it("requestDimensions: sends dimensions in API body for MRL reduction", async () => {
		capturedRequests.length = 0;

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: "text-embedding-3-large",
			requestDimensions: 256,
		});

		const result = await embedder.embed("test MRL reduction");

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(256);
		expect(capturedRequests[0]?.dimensions).toBe(256);
	});

	it("minilm profile: no prefix, no dimensions in request body", async () => {
		capturedRequests.length = 0;
		const profile = EMBEDDER_PROFILES.minilm;
		if (!profile) throw new Error("minilm profile not found");

		const embedder = new OpenAIEmbedder({
			apiKey: "no-key",
			baseUrl: serverUrl,
			model: profile.model,
			dimensions: profile.dimensions,
			prefix: profile.prefix,
			// No requestDimensions — minilm doesn't support MRL
		});

		await embedder.embed("hello world");

		// No prefix — raw text sent
		expect(capturedRequests[0]?.input[0]).toBe("hello world");
		// No dimensions in request body (not an MRL model)
		expect(capturedRequests[0]?.dimensions).toBeUndefined();
		expect(capturedRequests[0]?.model).toBe("Xenova/all-MiniLM-L6-v2");
	});

	it("all built-in profiles are well-formed", () => {
		for (const [name, profile] of Object.entries(EMBEDDER_PROFILES)) {
			expect(profile.model, `${name}.model`).toBeTruthy();
			expect(profile.dimensions, `${name}.dimensions`).toBeGreaterThan(0);
			expect(profile.pooling, `${name}.pooling`).toMatch(/^(mean|cls|last_token)$/);
		}
	});
});
