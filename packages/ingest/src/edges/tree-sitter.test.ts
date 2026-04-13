/**
 * Ownership: TreeSitterEdgeExtractor integration tests.
 * Tests: extension-to-language mapping, sourceType filtering, edge field mapping, concurrency, empty input.
 * Delegates to: tree-sitter-client.test.ts for HTTP transport, fail-open, timeout, and abort behavior.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeChunk, makeCodeChunk } from "./__test-helpers.js";
import { TreeSitterEdgeExtractor } from "./tree-sitter.js";

// Mock sidecar
let server: Server;
let baseUrl: string;

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			server = createServer((req, res) => {
				if (req.method === "POST" && req.url === "/parse") {
					let body = "";
					req.on("data", (c: Buffer) => {
						body += c.toString();
					});
					req.on("end", () => {
						const parsed = JSON.parse(body);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								edges: [
									{
										type: "imports",
										targetId: `${parsed.language}-module`,
										targetType: "module",
										confidence: 1.0,
										evidence: `mock ${parsed.language}`,
									},
								],
								language: parsed.language,
								nodeCount: 3,
							}),
						);
					});
					return;
				}
				res.writeHead(404);
				res.end();
			});
			server.listen(0, () => {
				const addr = server.address();
				if (addr && typeof addr === "object") {
					baseUrl = `http://localhost:${addr.port}`;
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

describe("TreeSitterEdgeExtractor", () => {
	describe("extension → language mapping", () => {
		it("maps .ts to typescript", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "src/main.ts")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("typescript-module");
		});

		it("maps .py to python", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "src/main.py")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("python-module");
		});

		it("maps .go to go", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "main.go")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("go-module");
		});

		it("maps .rs to rust", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "src/main.rs")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("rust-module");
		});

		it("maps .jsx and .mjs to javascript", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const jsxEdges = await extractor.extract([makeCodeChunk("code", "src/App.jsx")]);
			expect(jsxEdges[0]?.targetId).toBe("javascript-module");
			const mjsEdges = await extractor.extract([makeCodeChunk("code", "src/lib.mjs")]);
			expect(mjsEdges[0]?.targetId).toBe("javascript-module");
		});
	});

	describe("filtering", () => {
		it("skips unsupported extensions", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "data.json")]);
			expect(edges).toHaveLength(0);
		});

		it("skips non-code source types", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([
				makeChunk("import foo", { source: "src/main.ts", sourceType: "slack-message" }),
			]);
			expect(edges).toHaveLength(0);
		});

		it("processes repo source type", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([
				makeChunk("code", { source: "src/main.py", sourceType: "repo" }),
			]);
			expect(edges).toHaveLength(1);
		});
	});

	describe("edge mapping", () => {
		it("sets sourceId from chunk", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeCodeChunk("code", "main.go", "my-chunk")]);
			expect(edges[0]?.sourceId).toBe("my-chunk");
		});
	});

	it("returns empty array for empty chunk list", async () => {
		const extractor = new TreeSitterEdgeExtractor({ baseUrl });
		const edges = await extractor.extract([]);
		expect(edges).toHaveLength(0);
	});

	describe("concurrency", () => {
		it("processes multiple chunks", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl, maxConcurrency: 2 });
			const chunks = [
				makeCodeChunk("a", "src/a.ts", "c1"),
				makeCodeChunk("b", "src/b.py", "c2"),
				makeCodeChunk("c", "src/c.go", "c3"),
			];
			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(3);
			expect(edges.map((e) => e.sourceId).sort()).toEqual(["c1", "c2", "c3"]);
		});
	});
});
