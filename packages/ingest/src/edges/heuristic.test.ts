import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { HeuristicEdgeExtractor } from "./heuristic.js";

function makeChunk(content: string, id = "chunk-1"): Chunk {
	return {
		id,
		content,
		sourceType: "slack-message",
		source: "#general",
		metadata: {},
	};
}

describe("HeuristicEdgeExtractor", () => {
	const extractor = new HeuristicEdgeExtractor();

	describe("Slack permalinks", () => {
		it("extracts Slack message permalink", async () => {
			const chunk = makeChunk(
				"Check this thread: https://myteam.slack.com/archives/C01ABC123/p1234567890123",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "references",
				sourceId: "chunk-1",
				targetType: "slack-message",
				targetId: "myteam/C01ABC123/p1234567890123",
				confidence: 0.85,
			});
		});

		it("extracts multiple Slack permalinks", async () => {
			const chunk = makeChunk(
				"See https://team.slack.com/archives/C01/p111 and https://team.slack.com/archives/C02/p222",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(2);
		});
	});

	describe("Jira ticket keys", () => {
		it("extracts Jira ticket key", async () => {
			const chunk = makeChunk("This relates to PROJ-123 and should fix the bug");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "references",
				targetType: "jira-ticket",
				targetId: "PROJ-123",
				confidence: 0.85,
			});
		});

		it("extracts multiple distinct Jira keys", async () => {
			const chunk = makeChunk("Blocked by PROJ-456 and depends on INFRA-789");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(2);
			const ids = edges.map((e) => e.targetId);
			expect(ids).toContain("PROJ-456");
			expect(ids).toContain("INFRA-789");
		});

		it("deduplicates same Jira key mentioned multiple times", async () => {
			const chunk = makeChunk("PROJ-123 is important. See PROJ-123 for details.");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
		});

		it("ignores false positive patterns like UTF-8 and SHA-256", async () => {
			const chunk = makeChunk("Uses UTF-8 encoding and SHA-256 hashing");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(0);
		});

		it("rejects single-char project keys", async () => {
			// Jira requires at least 2 chars in project key
			const chunk = makeChunk("See X-123 in the docs");
			const edges = await extractor.extract([chunk]);
			// X is only 1 uppercase letter — pattern requires 2+ (A-Z followed by A-Z0-9{1,9})
			expect(edges).toHaveLength(0);
		});
	});

	describe("Markdown hyperlinks", () => {
		it("extracts markdown link", async () => {
			const chunk = makeChunk("See the [design doc](https://docs.example.com/design)");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "references",
				targetType: "url",
				targetId: "https://docs.example.com/design",
				confidence: 0.8,
			});
		});

		it("includes link text in evidence", async () => {
			const chunk = makeChunk("[Architecture Overview](https://wiki.example.com/arch)");
			const edges = await extractor.extract([chunk]);
			expect(edges[0]?.evidence).toContain("Architecture Overview");
		});

		it("skips GitHub URLs (handled by regex extractor)", async () => {
			const chunk = makeChunk("[PR](https://github.com/owner/repo/pull/42)");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(0);
		});

		it("deduplicates same URL linked multiple times", async () => {
			const chunk = makeChunk(
				"[link1](https://example.com/doc) and [link2](https://example.com/doc)",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
		});
	});

	describe("mixed content", () => {
		it("extracts edges from multiple pattern types in one chunk", async () => {
			const chunk = makeChunk(
				"Discussed in https://team.slack.com/archives/C01/p111. " +
					"Related to PROJ-42. See [spec](https://docs.example.com/spec).",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(3);
			const types = edges.map((e) => e.targetType);
			expect(types).toContain("slack-message");
			expect(types).toContain("jira-ticket");
			expect(types).toContain("url");
		});

		it("processes multiple chunks", async () => {
			const chunks = [makeChunk("See PROJ-1", "chunk-a"), makeChunk("See PROJ-2", "chunk-b")];
			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(2);
			expect(edges[0]?.sourceId).toBe("chunk-a");
			expect(edges[1]?.sourceId).toBe("chunk-b");
		});
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(extractor.extract([makeChunk("PROJ-1")], controller.signal)).rejects.toThrow();
	});

	it("returns empty array for content with no heuristic patterns", async () => {
		const chunk = makeChunk("Just some plain text with no links or tickets");
		const edges = await extractor.extract([chunk]);
		expect(edges).toHaveLength(0);
	});
});
