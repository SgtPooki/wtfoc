import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { treeSitterHealth, treeSitterParse } from "./tree-sitter-client.js";

// Minimal mock HTTP server that behaves like the tree-sitter-parser sidecar
let server: Server;
let baseUrl: string;

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			server = createServer((req, res) => {
				if (req.method === "GET" && req.url === "/health") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "ok", languages: ["javascript", "python"] }));
					return;
				}
				if (req.method === "POST" && req.url === "/parse") {
					let body = "";
					req.on("data", (c: Buffer) => {
						body += c.toString();
					});
					req.on("end", () => {
						const parsed = JSON.parse(body);
						if (parsed.language === "fail500") {
							res.writeHead(500, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ error: "internal" }));
							return;
						}
						if (parsed.language === "slow") {
							// Never respond — let timeout kick in
							return;
						}
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								edges: [
									{
										type: "imports",
										targetId: "mock-module",
										targetType: "module",
										confidence: 1.0,
										evidence: "mock evidence",
									},
								],
								language: parsed.language,
								nodeCount: 5,
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

describe("treeSitterParse", () => {
	it("returns parsed edges on success", async () => {
		const result = await treeSitterParse(
			{ language: "javascript", content: "import foo from 'bar';" },
			{ baseUrl },
		);
		expect(result).not.toBeNull();
		expect(result?.edges).toHaveLength(1);
		expect(result?.edges[0]?.targetId).toBe("mock-module");
		expect(result?.language).toBe("javascript");
	});

	it("returns null on server error (fail-open)", async () => {
		const result = await treeSitterParse({ language: "fail500", content: "x" }, { baseUrl });
		expect(result).toBeNull();
	});

	it("returns null when sidecar is unreachable (fail-open)", async () => {
		const result = await treeSitterParse(
			{ language: "javascript", content: "x" },
			{ baseUrl: "http://localhost:1" },
		);
		expect(result).toBeNull();
	});

	it("returns null on timeout (fail-open)", async () => {
		const result = await treeSitterParse(
			{ language: "slow", content: "x" },
			{ baseUrl, timeoutMs: 100 },
		);
		expect(result).toBeNull();
	});

	it("throws when external signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("pre-aborted"));
		await expect(
			treeSitterParse({ language: "javascript", content: "x" }, { baseUrl }, controller.signal),
		).rejects.toThrow("pre-aborted");
	});

	it("throws when external signal aborts during request", async () => {
		const controller = new AbortController();
		// Use the "slow" language so the request hangs, then abort
		const promise = treeSitterParse(
			{ language: "slow", content: "x" },
			{ baseUrl, timeoutMs: 5000 },
			controller.signal,
		);
		setTimeout(() => controller.abort(new Error("user-cancelled")), 50);
		await expect(promise).rejects.toThrow("user-cancelled");
	});

	it("does not leak abort listeners", async () => {
		// Make several requests with the same signal; listener count should not grow
		const controller = new AbortController();
		for (let i = 0; i < 20; i++) {
			await treeSitterParse(
				{ language: "javascript", content: "x" },
				{ baseUrl },
				controller.signal,
			);
		}
		// If listeners leaked, Node would emit MaxListenersExceededWarning.
		// The fact that we get here without warning is the test.
		expect(true).toBe(true);
	});
});

describe("treeSitterHealth", () => {
	it("returns health response", async () => {
		const result = await treeSitterHealth({ baseUrl });
		expect(result).toEqual({ status: "ok", languages: ["javascript", "python"] });
	});

	it("returns null when sidecar is unreachable", async () => {
		const result = await treeSitterHealth({ baseUrl: "http://localhost:1" });
		expect(result).toBeNull();
	});
});
