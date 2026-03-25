import { describe, expect, it, vi } from "vitest";
import { HackerNewsAdapter } from "./hackernews.js";

// ─── Synthetic fixtures ─────────────────────────────────────────────────────

const storyHit = {
	objectID: "99001",
	title: "Filecoin storage is underrated",
	url: "https://example.com/filecoin-storage",
	story_text: null,
	author: "testuser1",
	created_at: "2026-03-20T12:00:00.000Z",
	points: 142,
	num_comments: 38,
	_tags: ["story"],
};

const storyWithBodyHit = {
	objectID: "99002",
	title: "Ask HN: Best decentralized storage for RAG?",
	url: "",
	story_text: "<p>Looking for storage that works with RAG pipelines. Has anyone tried FOC?</p>",
	author: "testuser2",
	created_at: "2026-03-21T08:30:00.000Z",
	points: 67,
	num_comments: 12,
	_tags: ["story", "ask_hn"],
};

const commentHit = {
	objectID: "99003",
	comment_text:
		'<p>We use synapse-sdk for this. See <a href="https://github.com/FilOzone/synapse-sdk/issues/142">issue #142</a> for upload timeout fixes.</p>',
	author: "testuser3",
	created_at: "2026-03-21T09:15:00.000Z",
	parent_id: 99002,
	story_id: 99002,
	_tags: ["comment"],
};

const emptyCommentHit = {
	objectID: "99004",
	comment_text: "",
	author: "testuser4",
	created_at: "2026-03-21T10:00:00.000Z",
	parent_id: 99002,
	story_id: 99002,
	_tags: ["comment"],
};

function mockAlgoliaResponse(hits: unknown[]) {
	return { hits, nbPages: 1, page: 0 };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("HackerNewsAdapter", () => {
	const adapter = new HackerNewsAdapter();

	describe("parseConfig", () => {
		it("parses a search query from source", () => {
			const config = adapter.parseConfig({ source: "filecoin storage" });
			expect(config.query).toBe("filecoin storage");
		});

		it("throws on empty source", () => {
			expect(() => adapter.parseConfig({ source: "" })).toThrow("search query");
		});

		it("throws on missing source", () => {
			expect(() => adapter.parseConfig({})).toThrow("search query");
		});
	});

	describe("ingest", () => {
		it("yields story chunks with correct sourceType and metadata", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(JSON.stringify(mockAlgoliaResponse([storyHit])), { status: 200 }),
			);
			// Empty response for comments page
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(JSON.stringify(mockAlgoliaResponse([])), { status: 200 }),
			);

			const chunks = [];
			for await (const chunk of adapter.ingest({ query: "filecoin", tags: ["story", "comment"] })) {
				chunks.push(chunk);
			}

			expect(chunks).toHaveLength(1);
			const story = chunks[0];
			expect(story).toBeDefined();
			expect(story?.sourceType).toBe("hn-story");
			expect(story?.source).toBe("hn:99001");
			expect(story?.sourceUrl).toBe("https://news.ycombinator.com/item?id=99001");
			expect(story?.content).toContain("Filecoin storage is underrated");
			expect(story?.content).toContain("https://example.com/filecoin-storage");
			expect(story?.metadata.author).toBe("testuser1");
			expect(story?.metadata.points).toBe("142");

			vi.restoreAllMocks();
		});

		it("yields Ask HN stories with body text", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(JSON.stringify(mockAlgoliaResponse([storyWithBodyHit])), { status: 200 }),
			);

			const chunks = [];
			for await (const chunk of adapter.ingest({ query: "RAG", tags: ["story"] })) {
				chunks.push(chunk);
			}

			expect(chunks).toHaveLength(1);
			expect(chunks[0]?.content).toContain("Best decentralized storage for RAG?");
			expect(chunks[0]?.content).toContain("Looking for storage that works with RAG pipelines");

			vi.restoreAllMocks();
		});

		it("yields comment chunks with parentId metadata", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(JSON.stringify(mockAlgoliaResponse([commentHit])), { status: 200 }),
			);

			const chunks = [];
			for await (const chunk of adapter.ingest({ query: "synapse", tags: ["comment"] })) {
				chunks.push(chunk);
			}

			expect(chunks).toHaveLength(1);
			const comment = chunks[0];
			expect(comment?.sourceType).toBe("hn-comment");
			expect(comment?.metadata.parentId).toBe("99002");
			expect(comment?.metadata.storyId).toBe("99002");
			// HTML should be stripped
			expect(comment?.content).not.toContain("<p>");
			expect(comment?.content).not.toContain("<a ");
			// GitHub URL should be preserved
			expect(comment?.content).toContain("https://github.com/FilOzone/synapse-sdk/issues/142");

			vi.restoreAllMocks();
		});

		it("skips empty comments", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(JSON.stringify(mockAlgoliaResponse([emptyCommentHit])), { status: 200 }),
			);

			const chunks = [];
			for await (const chunk of adapter.ingest({ query: "test", tags: ["comment"] })) {
				chunks.push(chunk);
			}

			expect(chunks).toHaveLength(0);

			vi.restoreAllMocks();
		});
	});

	describe("extractEdges", () => {
		it("extracts reply-to-parent edges from comments", async () => {
			const chunks = [
				{
					id: "chunk-1",
					content: "Some reply text",
					sourceType: "hn-comment",
					source: "hn:99003",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { parentId: "99002", author: "testuser3" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			const parentEdge = edges.find((e) => e.targetId === "hn:99002");
			expect(parentEdge).toBeDefined();
			expect(parentEdge?.type).toBe("references");
			expect(parentEdge?.evidence).toContain("reply to");
		});

		it("extracts GitHub URL edges from content", async () => {
			const chunks = [
				{
					id: "chunk-2",
					content: "Check out https://github.com/FilOzone/synapse-sdk/issues/142 for details",
					sourceType: "hn-comment",
					source: "hn:99003",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { author: "testuser3" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			const githubEdge = edges.find((e) => e.targetId === "FilOzone/synapse-sdk#142");
			expect(githubEdge).toBeDefined();
			expect(githubEdge?.type).toBe("references");
		});
	});
});
