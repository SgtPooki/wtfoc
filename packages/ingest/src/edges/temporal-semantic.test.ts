import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { TemporalSemanticExtractor } from "./temporal-semantic.js";

function makeChunk(overrides: Partial<Chunk> & { id: string; sourceType: string }): Chunk {
	return {
		content: overrides.content ?? "test content",
		source: overrides.source ?? "test-source",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: overrides.metadata ?? {},
		...overrides,
	};
}

describe("TemporalSemanticExtractor", () => {
	it("returns empty for fewer than 2 chunks", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({ id: "c1", sourceType: "slack-message", timestamp: "2026-01-01T00:00:00Z" }),
		]);
		expect(edges).toEqual([]);
	});

	it("returns empty for chunks without timestamps", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({ id: "c1", sourceType: "slack-message" }),
			makeChunk({ id: "c2", sourceType: "github-issue" }),
		]);
		expect(edges).toEqual([]);
	});

	it("emits discussed-before when discussion precedes issue", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({
				id: "slack-1",
				sourceType: "slack-message",
				source: "#engineering",
				documentId: "slack:C123:1234",
				timestamp: "2026-01-01T10:00:00Z",
				content: "We need to fix the auth flow",
			}),
			makeChunk({
				id: "issue-1",
				sourceType: "github-issue",
				source: "owner/repo#42",
				documentId: "owner/repo#42",
				timestamp: "2026-01-01T12:00:00Z",
				content: "Fix auth flow",
			}),
		]);

		const before = edges.filter((e) => e.type === "discussed-before");
		expect(before.length).toBe(1);
		expect(before[0]?.sourceId).toBe("slack-1");
		expect(before[0]?.targetId).toBe("owner/repo#42");
	});

	it("emits discussed-during when discussion overlaps with long-lived issue", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({
				id: "issue-1",
				sourceType: "github-issue",
				source: "owner/repo#42",
				documentId: "owner/repo#42",
				timestamp: "2026-01-01T00:00:00Z",
				metadata: { closedAt: "2026-01-20T00:00:00Z" },
				content: "Long-running feature",
			}),
			makeChunk({
				id: "slack-1",
				sourceType: "slack-message",
				source: "#engineering",
				documentId: "slack:C123:5678",
				timestamp: "2026-01-10T00:00:00Z",
				content: "Discussion about the feature",
			}),
		]);

		const during = edges.filter((e) => e.type === "discussed-during");
		expect(during.length).toBe(1);
		expect(during[0]?.sourceId).toBe("slack-1");
	});

	it("emits addressed-after when code follows discussion", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({
				id: "slack-1",
				sourceType: "slack-message",
				source: "#engineering",
				documentId: "slack:C123:1234",
				timestamp: "2026-01-01T10:00:00Z",
				content: "Bug report",
			}),
			makeChunk({
				id: "code-1",
				sourceType: "code",
				source: "owner/repo/fix.ts",
				documentId: "owner/repo/fix.ts",
				timestamp: "2026-01-01T14:00:00Z",
				content: "Fix for the bug",
			}),
		]);

		const after = edges.filter((e) => e.type === "addressed-after");
		expect(after.length).toBe(1);
		expect(after[0]?.sourceId).toBe("code-1");
	});

	it("emits occurred-during when code falls within PR interval", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({
				id: "pr-1",
				sourceType: "github-pr",
				source: "owner/repo#100",
				documentId: "owner/repo#100",
				timestamp: "2026-01-01T00:00:00Z",
				metadata: { mergedAt: "2026-01-15T00:00:00Z" },
				content: "Feature PR",
			}),
			makeChunk({
				id: "code-1",
				sourceType: "code",
				source: "owner/repo/file.ts",
				documentId: "owner/repo/file.ts",
				timestamp: "2026-01-07T00:00:00Z",
				content: "Code change within PR",
			}),
		]);

		const during = edges.filter((e) => e.type === "occurred-during");
		expect(during.length).toBe(1);
		expect(during[0]?.sourceId).toBe("code-1");
	});

	it("handles long-lived issue beyond maxWindowHours via interval check", async () => {
		// Issue opened Jan 1, commit April 20 — beyond 168h window on start times,
		// but commit is within the issue's interval
		const extractor = new TemporalSemanticExtractor({ maxWindowHours: 168 });
		const edges = await extractor.extract([
			makeChunk({
				id: "issue-1",
				sourceType: "github-issue",
				source: "owner/repo#42",
				documentId: "owner/repo#42",
				timestamp: "2026-01-01T00:00:00Z",
				metadata: { closedAt: "2026-05-01T00:00:00Z" },
				content: "Long-lived issue",
			}),
			makeChunk({
				id: "code-1",
				sourceType: "code",
				source: "owner/repo/fix.ts",
				documentId: "owner/repo/fix.ts",
				timestamp: "2026-04-20T00:00:00Z",
				content: "Late fix",
			}),
		]);

		const during = edges.filter((e) => e.type === "occurred-during");
		expect(during.length).toBe(1);
	});

	it("respects semantic threshold when embeddings are provided", () => {
		const extractor = new TemporalSemanticExtractor({ discussionThreshold: 0.78 });

		// Create embeddings with low similarity
		const emb1 = new Float32Array([1, 0, 0]);
		const emb2 = new Float32Array([0, 1, 0]); // orthogonal = 0 similarity

		const result = extractor.extractWithEmbeddings(
			[
				makeChunk({
					id: "slack-1",
					sourceType: "slack-message",
					documentId: "slack:1",
					timestamp: "2026-01-01T10:00:00Z",
				}),
				makeChunk({
					id: "issue-1",
					sourceType: "github-issue",
					documentId: "owner/repo#42",
					timestamp: "2026-01-01T12:00:00Z",
				}),
			],
			new Map([
				["slack-1", emb1],
				["issue-1", emb2],
			]),
		);

		// Orthogonal embeddings should be below threshold — no edges
		expect(result.edges).toEqual([]);
		expect(result.temporalOnly).toBe(false);
	});

	it("emits edges when embeddings have high similarity", () => {
		const extractor = new TemporalSemanticExtractor({ discussionThreshold: 0.5 });

		// Nearly identical embeddings
		const emb1 = new Float32Array([1, 0.1, 0]);
		const emb2 = new Float32Array([1, 0.2, 0]); // very similar

		const result = extractor.extractWithEmbeddings(
			[
				makeChunk({
					id: "slack-1",
					sourceType: "slack-message",
					documentId: "slack:1",
					timestamp: "2026-01-01T10:00:00Z",
					content: "Discussion about auth",
				}),
				makeChunk({
					id: "issue-1",
					sourceType: "github-issue",
					documentId: "owner/repo#42",
					timestamp: "2026-01-01T12:00:00Z",
					content: "Auth issue",
				}),
			],
			new Map([
				["slack-1", emb1],
				["issue-1", emb2],
			]),
		);

		expect(result.edges.length).toBeGreaterThan(0);
		expect(result.temporalOnly).toBe(false);
	});

	it("sets temporalOnly=true when no embeddings provided", () => {
		const extractor = new TemporalSemanticExtractor();
		const result = extractor.extractWithEmbeddings(
			[
				makeChunk({
					id: "slack-1",
					sourceType: "slack-message",
					documentId: "slack:1",
					timestamp: "2026-01-01T10:00:00Z",
				}),
				makeChunk({
					id: "issue-1",
					sourceType: "github-issue",
					documentId: "owner/repo#42",
					timestamp: "2026-01-01T12:00:00Z",
				}),
			],
			new Map(),
		);

		expect(result.temporalOnly).toBe(true);
	});

	it("uses documentId as stable target ID", async () => {
		const extractor = new TemporalSemanticExtractor();
		const edges = await extractor.extract([
			makeChunk({
				id: "slack-1",
				sourceType: "slack-message",
				source: "#channel",
				documentId: "slack:C123:msg456",
				timestamp: "2026-01-01T10:00:00Z",
				content: "Discussion",
			}),
			makeChunk({
				id: "issue-1",
				sourceType: "github-issue",
				source: "owner/repo#42",
				documentId: "owner/repo#42",
				timestamp: "2026-01-01T12:00:00Z",
				content: "Issue",
			}),
		]);

		const before = edges.filter((e) => e.type === "discussed-before");
		expect(before.length).toBe(1);
		// targetId should be the documentId, not the channel name
		expect(before[0]?.targetId).toBe("owner/repo#42");
	});

	it("respects AbortSignal", async () => {
		const extractor = new TemporalSemanticExtractor();
		const controller = new AbortController();
		controller.abort(new Error("test abort"));

		await expect(
			extractor.extract(
				[
					makeChunk({
						id: "c1",
						sourceType: "slack-message",
						timestamp: "2026-01-01T00:00:00Z",
					}),
					makeChunk({
						id: "c2",
						sourceType: "github-issue",
						timestamp: "2026-01-01T01:00:00Z",
					}),
				],
				controller.signal,
			),
		).rejects.toThrow("test abort");
	});

	it("deduplicates edges by type + source + target", async () => {
		const extractor = new TemporalSemanticExtractor();
		// Two Slack messages from same documentId to same issue
		const edges = await extractor.extract([
			makeChunk({
				id: "slack-1",
				sourceType: "slack-message",
				documentId: "slack:C123:msg1",
				timestamp: "2026-01-01T10:00:00Z",
				content: "First message",
			}),
			makeChunk({
				id: "slack-2",
				sourceType: "slack-message",
				documentId: "slack:C123:msg1", // same documentId
				timestamp: "2026-01-01T10:05:00Z",
				content: "Second message",
			}),
			makeChunk({
				id: "issue-1",
				sourceType: "github-issue",
				documentId: "owner/repo#42",
				timestamp: "2026-01-01T12:00:00Z",
				content: "Issue",
			}),
		]);

		// Should deduplicate since both slack messages have the same stableId
		const before = edges.filter((e) => e.type === "discussed-before");
		expect(before.length).toBe(1);
	});
});
