import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoAdapter } from "./repo.js";

const FIXTURE_PATH = resolve(import.meta.dirname ?? ".", "../../../../fixtures/test-repo");

describe("RepoAdapter", () => {
	const adapter = new RepoAdapter();

	describe("ingest", () => {
		it("yields chunks from a local directory", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});

		it("produces code chunks for .ts files", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const codeChunks = chunks.filter((c) => c.sourceType === "code");
			expect(codeChunks.length).toBeGreaterThan(0);
			expect(codeChunks[0]!.metadata["language"]).toBe("ts");
		});

		it("produces markdown chunks for .md files", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const mdChunks = chunks.filter((c) => c.sourceType === "markdown");
			expect(mdChunks.length).toBeGreaterThan(0);
		});

		it("includes filePath and repo in metadata", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			for (const chunk of chunks) {
				expect(chunk.metadata["filePath"]).toBeTruthy();
			}
		});

		it("generates deterministic chunk IDs", async () => {
			const chunks1 = [];
			const chunks2 = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks1.push(chunk);
			}
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks2.push(chunk);
			}

			expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
		});

		it("skips excluded directories", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const nodeModuleChunks = chunks.filter((c) =>
				c.metadata["filePath"]?.includes("node_modules"),
			);
			expect(nodeModuleChunks).toHaveLength(0);
		});
	});

	describe("extractEdges", () => {
		it("extracts import references from code", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const edges = adapter.extractEdges(chunks);
			const importEdges = edges.filter(
				(e) => e.type === "references" && e.targetType === "file",
			);
			expect(importEdges.length).toBeGreaterThan(0);
		});

		it("extracts issue references from comments", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const edges = adapter.extractEdges(chunks);
			const issueEdges = edges.filter(
				(e) => e.type === "references" && e.targetType === "issue",
			);
			expect(issueEdges.length).toBeGreaterThan(0);
		});

		it("extracts URL references from markdown", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const edges = adapter.extractEdges(chunks);
			const urlEdges = edges.filter((e) => e.type === "references" && e.targetType === "url");
			expect(urlEdges.length).toBeGreaterThan(0);
		});

		it("all edges have confidence 1.0", async () => {
			const chunks = [];
			for await (const chunk of adapter.ingest({
				type: "repo",
				options: { source: FIXTURE_PATH },
			})) {
				chunks.push(chunk);
			}

			const edges = adapter.extractEdges(chunks);
			for (const edge of edges) {
				expect(edge.confidence).toBe(1.0);
			}
		});
	});
});
