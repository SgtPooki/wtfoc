import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { WebsiteAdapter } from "./website.js";

describe("WebsiteAdapter", () => {
	const adapter = new WebsiteAdapter();

	describe("sourceType", () => {
		it("should be 'website'", () => {
			expect(adapter.sourceType).toBe("website");
		});
	});

	describe("parseConfig", () => {
		it("parses a valid URL source", () => {
			const config = adapter.parseConfig({ source: "https://docs.filecoin.io" });
			expect(config).toEqual({
				source: "https://docs.filecoin.io",
				maxPages: 100,
				urlPattern: undefined,
			});
		});

		it("parses optional maxPages and urlPattern", () => {
			const config = adapter.parseConfig({
				source: "https://docs.filecoin.io",
				maxPages: 50,
				urlPattern: "https://docs.filecoin.io/basics/**",
			});
			expect(config).toEqual({
				source: "https://docs.filecoin.io",
				maxPages: 50,
				urlPattern: "https://docs.filecoin.io/basics/**",
			});
		});

		it("throws on missing source", () => {
			expect(() => adapter.parseConfig({})).toThrow("website adapter requires a source URL");
		});

		it("throws on non-URL source", () => {
			expect(() => adapter.parseConfig({ source: "/local/path" })).toThrow(
				"website adapter requires a source URL",
			);
		});

		it("throws on non-string source", () => {
			expect(() => adapter.parseConfig({ source: 42 })).toThrow(
				"website adapter requires a source URL",
			);
		});

		it("defaults maxPages to 100 when not a number", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				maxPages: "not-a-number",
			});
			expect(config.maxPages).toBe(100);
		});
	});

	describe("extractEdges", () => {
		it("extracts markdown link references", () => {
			const chunks: Chunk[] = [
				{
					id: "abc123",
					content: "Check the [API docs](https://api.example.com/v1) for details.",
					sourceType: "doc-page",
					source: "/docs/intro",
					sourceUrl: "https://example.com/docs/intro",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/intro", title: "Intro" },
				},
			];

			const edges = adapter.extractEdges(chunks);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "abc123",
				targetType: "url",
				targetId: "https://api.example.com/v1",
				evidence: "[API docs](https://api.example.com/v1)",
				confidence: 1.0,
			});
		});

		it("extracts GitHub issue/PR URL references", () => {
			const chunks: Chunk[] = [
				{
					id: "def456",
					content: "See https://github.com/filecoin-project/lotus/issues/42 for the upstream bug.",
					sourceType: "doc-page",
					source: "/docs/bugs",
					sourceUrl: "https://example.com/docs/bugs",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/bugs", title: "Bugs" },
				},
			];

			const edges = adapter.extractEdges(chunks);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "def456",
				targetType: "issue",
				targetId: "filecoin-project/lotus#42",
				evidence: "https://github.com/filecoin-project/lotus/issues/42",
				confidence: 1.0,
			});
		});

		it("extracts both link types from same chunk", () => {
			const chunks: Chunk[] = [
				{
					id: "ghi789",
					content:
						"Read the [guide](https://docs.example.com/guide). Related: https://github.com/org/repo/pull/10",
					sourceType: "doc-page",
					source: "/docs/mixed",
					sourceUrl: "https://example.com/docs/mixed",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/mixed", title: "Mixed" },
				},
			];

			const edges = adapter.extractEdges(chunks);
			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetType).sort()).toEqual(["issue", "url"]);
		});

		it("returns empty array for chunks without links", () => {
			const chunks: Chunk[] = [
				{
					id: "nope",
					content: "Just some plain text without any links.",
					sourceType: "doc-page",
					source: "/docs/plain",
					sourceUrl: "https://example.com/docs/plain",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/plain", title: "Plain" },
				},
			];

			const edges = adapter.extractEdges(chunks);
			expect(edges).toHaveLength(0);
		});

		it("ignores relative markdown links", () => {
			const chunks: Chunk[] = [
				{
					id: "rel",
					content: "See [next section](./next) and [another](/other).",
					sourceType: "doc-page",
					source: "/docs/relative",
					sourceUrl: "https://example.com/docs/relative",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/relative", title: "Relative" },
				},
			];

			const edges = adapter.extractEdges(chunks);
			expect(edges).toHaveLength(0);
		});
	});

	// Note: ingest() tests require network access and a running website.
	// We skip them here but document the expected behaviour:
	// - Crawls the given URL using CheerioCrawler
	// - Converts HTML to markdown via turndown
	// - Yields Chunk objects with sourceType "doc-page"
	// - Chunk IDs are SHA-256 hashes of content
	// - Long pages are split using chunkMarkdown()
	// - Metadata includes url and title
});
