import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoAdapter } from "./repo/index.js";

const FIXTURE_PATH = resolve(import.meta.dirname ?? ".", "../../../../fixtures/test-repo");

describe("RepoAdapter", () => {
	const adapter = new RepoAdapter();

	describe("ingest", () => {
		it("yields chunks from a local directory", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			// Golden count: 4 chunks from fixtures/test-repo (3 .ts code + 1 .md)
			// If test-repo fixture changes, update: run tests and capture new values
			expect(chunks.length).toBe(4);
		});

		it("produces code chunks for .ts files", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const codeChunks = chunks.filter((c) => c.sourceType === "code");
			expect(codeChunks.length).toBe(3);
			const firstCode = codeChunks[0];
			if (!firstCode) throw new Error("Expected at least one code chunk");
			expect(firstCode.metadata.language).toBe("ts");
			expect(codeChunks.some((c) => c.content.includes("StorageManager"))).toBe(true);
		});

		it("produces markdown chunks for .md files", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const mdChunks = chunks.filter((c) => c.sourceType === "markdown");
			expect(mdChunks.length).toBe(1);
			expect(mdChunks[0]?.metadata.filePath).toBe("docs/getting-started.md");
		});

		it("includes filePath and repo in metadata", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const filePaths = chunks.map((c) => c.metadata.filePath).sort();
			expect(filePaths).toContain("docs/getting-started.md");
			expect(filePaths).toContain("src/storage.ts");
			expect(filePaths).toContain("src/upload.ts");
		});

		it("generates deterministic chunk IDs", async () => {
			const chunks1 = [];
			const chunks2 = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks1.push(chunk);
			}
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks2.push(chunk);
			}

			expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
		});

		it("skips excluded directories", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const nodeModuleChunks = chunks.filter((c) => c.metadata.filePath?.includes("node_modules"));
			expect(nodeModuleChunks).toHaveLength(0);
		});
	});

	describe("extractEdges", () => {
		it("extracts import references from code", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const edges = await adapter.extractEdges(chunks);
			const importEdges = edges.filter((e) => e.type === "references" && e.targetType === "file");
			// Golden count: 1 import edge from test-repo .ts files
			expect(importEdges.length).toBe(1);
		});

		it("extracts issue references from comments", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const edges = await adapter.extractEdges(chunks);
			const issueEdges = edges.filter((e) => e.type === "references" && e.targetType === "issue");
			// Golden count: 1 issue reference from test-repo
			expect(issueEdges.length).toBe(1);
		});

		it("extracts URL references from markdown", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const edges = await adapter.extractEdges(chunks);
			const urlEdges = edges.filter((e) => e.type === "references" && e.targetType === "url");
			// Golden count: 3 URL references from test-repo markdown
			expect(urlEdges.length).toBe(3);
		});

		it("all edges have confidence 1.0", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(
				adapter.parseConfig({
					source: FIXTURE_PATH,
				}),
			)) {
				chunks.push(chunk);
			}

			const edges = await adapter.extractEdges(chunks);
			for (const edge of edges) {
				expect(edge.confidence).toBe(1.0);
			}
		});
	});
});
