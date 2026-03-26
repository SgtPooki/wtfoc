import { createServer, type Server } from "node:http";
import type { Chunk } from "@wtfoc/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TreeSitterEdgeExtractor } from "./tree-sitter.js";

function makeChunk(content: string, source: string, sourceType = "code", id = "chunk-1"): Chunk {
	return { id, content, sourceType, source, chunkIndex: 0, totalChunks: 1, metadata: {} };
}

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
			const edges = await extractor.extract([makeChunk("code", "src/main.ts")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("typescript-module");
		});

		it("maps .py to python", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "src/main.py")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("python-module");
		});

		it("maps .go to go", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "main.go")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("go-module");
		});

		it("maps .rs to rust", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "src/main.rs")]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("rust-module");
		});

		it("maps .jsx and .mjs to javascript", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const jsxEdges = await extractor.extract([makeChunk("code", "src/App.jsx")]);
			expect(jsxEdges[0]?.targetId).toBe("javascript-module");
			const mjsEdges = await extractor.extract([makeChunk("code", "src/lib.mjs")]);
			expect(mjsEdges[0]?.targetId).toBe("javascript-module");
		});
	});

	describe("filtering", () => {
		it("skips unsupported extensions", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "data.json")]);
			expect(edges).toHaveLength(0);
		});

		it("skips non-code source types", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([
				makeChunk("import foo", "src/main.ts", "slack-message"),
			]);
			expect(edges).toHaveLength(0);
		});

		it("processes repo source type", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "src/main.py", "repo")]);
			expect(edges).toHaveLength(1);
		});
	});

	describe("edge mapping", () => {
		it("sets sourceId from chunk", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([makeChunk("code", "main.go", "code", "my-chunk")]);
			expect(edges[0]?.sourceId).toBe("my-chunk");
		});
	});

	describe("fail-open", () => {
		it("returns empty array when sidecar is unreachable", async () => {
			const extractor = new TreeSitterEdgeExtractor({
				baseUrl: "http://localhost:1",
				timeoutMs: 200,
			});
			const edges = await extractor.extract([makeChunk("code", "src/main.ts")]);
			expect(edges).toHaveLength(0);
		});

		it("returns empty array for empty chunk list", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const edges = await extractor.extract([]);
			expect(edges).toHaveLength(0);
		});
	});

	describe("abort", () => {
		it("respects pre-aborted signal", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl });
			const controller = new AbortController();
			controller.abort();
			await expect(
				extractor.extract([makeChunk("code", "src/main.ts")], controller.signal),
			).rejects.toThrow();
		});
	});

	describe("concurrency", () => {
		it("processes multiple chunks", async () => {
			const extractor = new TreeSitterEdgeExtractor({ baseUrl, maxConcurrency: 2 });
			const chunks = [
				makeChunk("a", "src/a.ts", "code", "c1"),
				makeChunk("b", "src/b.py", "code", "c2"),
				makeChunk("c", "src/c.go", "code", "c3"),
			];
			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(3);
			expect(edges.map((e) => e.sourceId).sort()).toEqual(["c1", "c2", "c3"]);
		});
	});
});
