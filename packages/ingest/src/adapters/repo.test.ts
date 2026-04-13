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

	describe("temporal metadata", () => {
		it("sets timestamp on code chunks from git history", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(adapter.parseConfig({ source: FIXTURE_PATH }))) {
				chunks.push(chunk);
			}

			const codeChunks = chunks.filter((c) => c.sourceType === "code");
			for (const chunk of codeChunks) {
				expect(chunk.timestamp).toBeDefined();
				expect(chunk.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			}
		});

		it("sets timestamp on markdown chunks from git history", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(adapter.parseConfig({ source: FIXTURE_PATH }))) {
				chunks.push(chunk);
			}

			const mdChunks = chunks.filter((c) => c.sourceType === "markdown");
			for (const chunk of mdChunks) {
				expect(chunk.timestamp).toBeDefined();
				expect(chunk.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			}
		});

		it("includes lastCommitSha in chunk metadata", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(adapter.parseConfig({ source: FIXTURE_PATH }))) {
				chunks.push(chunk);
			}

			for (const chunk of chunks) {
				expect(chunk.metadata.lastCommitSha).toBeDefined();
				expect(chunk.metadata.lastCommitSha).toMatch(/^[0-9a-f]{40}$/);
			}
		});

		it("includes lastCommitAuthor in chunk metadata", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(adapter.parseConfig({ source: FIXTURE_PATH }))) {
				chunks.push(chunk);
			}

			for (const chunk of chunks) {
				expect(chunk.metadata.lastCommitAuthor).toBeDefined();
				expect((chunk.metadata.lastCommitAuthor ?? "").length).toBeGreaterThan(0);
			}
		});

		it("includes lastCommitMessage in chunk metadata", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest(adapter.parseConfig({ source: FIXTURE_PATH }))) {
				chunks.push(chunk);
			}

			for (const chunk of chunks) {
				expect(chunk.metadata.lastCommitMessage).toBeDefined();
			}
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
