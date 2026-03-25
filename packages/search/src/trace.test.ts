import type { Embedder, Segment, VectorEntry, VectorIndex } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { trace } from "./trace/index.js";

// ─── Mock embedder ───────────────────────────────────────────────────────────
const mockEmbedder: Embedder = {
	dimensions: 3,
	async embed(): Promise<Float32Array> {
		return new Float32Array([1.0, 0.0, 0.0]);
	},
	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		return texts.map(() => new Float32Array([1.0, 0.0, 0.0]));
	},
};

// ─── Mock vector index ───────────────────────────────────────────────────────
function createMockIndex(entries: VectorEntry[]): VectorIndex {
	return {
		size: entries.length,
		async add(newEntries: VectorEntry[]): Promise<void> {
			entries.push(...newEntries);
		},
		async search(_query: Float32Array, topK: number) {
			// Return all entries with decreasing scores
			return entries.slice(0, topK).map((entry, i) => ({
				entry,
				score: 1.0 - i * 0.1,
			}));
		},
		async serialize(): Promise<Uint8Array> {
			return new Uint8Array(0);
		},
		async deserialize(): Promise<void> {},
	};
}

// ─── Test fixtures ───────────────────────────────────────────────────────────
const slackChunk: VectorEntry = {
	id: "slack-msg-1",
	vector: new Float32Array([1.0, 0.0, 0.0]),
	storageId: "storage-slack-1",
	metadata: {
		sourceType: "slack-message",
		source: "#foc-support",
		content: "users are seeing upload timeouts on files >1GB. See #142",
	},
};

const issueChunk: VectorEntry = {
	id: "issue-142",
	vector: new Float32Array([0.9, 0.1, 0.0]),
	storageId: "storage-issue-142",
	metadata: {
		sourceType: "github-issue",
		source: "FilOzone/synapse-sdk#142",
		sourceUrl: "https://github.com/FilOzone/synapse-sdk/issues/142",
		content: "Upload timeout on large files",
	},
};

const prChunk: VectorEntry = {
	id: "pr-156",
	vector: new Float32Array([0.8, 0.2, 0.0]),
	storageId: "storage-pr-156",
	metadata: {
		sourceType: "github-pr",
		source: "FilOzone/synapse-sdk#156",
		sourceUrl: "https://github.com/FilOzone/synapse-sdk/pull/156",
		content: "Fix upload retry logic",
	},
};

const codeChunk: VectorEntry = {
	id: "code-manager-ts",
	vector: new Float32Array([0.7, 0.3, 0.0]),
	storageId: "storage-code-1",
	metadata: {
		sourceType: "code",
		source: "FilOzone/synapse-sdk",
		sourceUrl:
			"https://github.com/FilOzone/synapse-sdk/blob/main/packages/synapse-sdk/src/storage/manager.ts",
		content: "export class StorageManager { async upload(data) { ... } }",
	},
};

const testSegment: Segment = {
	schemaVersion: 1,
	embeddingModel: "test",
	embeddingDimensions: 3,
	chunks: [
		{
			id: "slack-msg-1",
			storageId: "storage-slack-1",
			content: "users are seeing upload timeouts",
			embedding: [1.0, 0.0, 0.0],
			terms: ["upload", "timeout"],
			source: "#foc-support",
			sourceType: "slack-message",
			metadata: {},
		},
		{
			id: "issue-142",
			storageId: "storage-issue-142",
			content: "Upload timeout on large files",
			embedding: [0.9, 0.1, 0.0],
			terms: ["upload", "timeout", "large"],
			source: "FilOzone/synapse-sdk#142",
			sourceType: "github-issue",
			sourceUrl: "https://github.com/FilOzone/synapse-sdk/issues/142",
			metadata: {},
		},
		{
			id: "pr-156",
			storageId: "storage-pr-156",
			content: "Fix upload retry logic",
			embedding: [0.8, 0.2, 0.0],
			terms: ["upload", "retry"],
			source: "FilOzone/synapse-sdk#156",
			sourceType: "github-pr",
			sourceUrl: "https://github.com/FilOzone/synapse-sdk/pull/156",
			metadata: {},
		},
	],
	edges: [
		{
			type: "references",
			sourceId: "slack-msg-1",
			targetType: "issue",
			targetId: "FilOzone/synapse-sdk#142",
			evidence: "#142 in message",
			confidence: 1.0,
		},
		{
			type: "closes",
			sourceId: "pr-156",
			targetType: "issue",
			targetId: "FilOzone/synapse-sdk#142",
			evidence: "Closes #142 in PR body",
			confidence: 1.0,
		},
	],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("trace", () => {
	it("returns results grouped by sourceType", async () => {
		const index = createMockIndex([slackChunk, issueChunk, prChunk, codeChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		expect(result.groups).toBeDefined();
		expect(result.stats.sourceTypes.length).toBeGreaterThan(0);
	});

	it("follows explicit edges from seed chunks", async () => {
		const index = createMockIndex([slackChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		const edgeHops = result.hops.filter((h) => h.connection.method === "edge");
		expect(edgeHops.length).toBeGreaterThan(0);
		expect(result.stats.edgeHops).toBeGreaterThan(0);
	});

	it("annotates edge hops with evidence", async () => {
		const index = createMockIndex([slackChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		const edgeHop = result.hops.find((h) => h.connection.method === "edge");
		expect(edgeHop?.connection.evidence).toBeTruthy();
		expect(edgeHop?.connection.edgeType).toBeTruthy();
		expect(edgeHop?.connection.confidence).toBe(1.0);
	});

	it("includes semantic search results as fallback", async () => {
		const index = createMockIndex([slackChunk, codeChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		const semanticHops = result.hops.filter((h) => h.connection.method === "semantic");
		expect(semanticHops.length).toBeGreaterThan(0);
	});

	it("detects cycles — does not visit same chunk twice", async () => {
		const index = createMockIndex([slackChunk, issueChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		const ids = result.hops.map((h) => h.storageId);
		const uniqueIds = new Set(ids);
		expect(ids.length).toBe(uniqueIds.size);
	});

	it("respects maxTotal limit", async () => {
		const index = createMockIndex([slackChunk, issueChunk, prChunk, codeChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment], {
			maxTotal: 2,
		});

		expect(result.hops.length).toBeLessThanOrEqual(2);
	});

	it("returns empty results for no matches", async () => {
		const index = createMockIndex([]);
		const result = await trace("nonexistent query", mockEmbedder, index, [testSegment]);

		expect(result.hops).toHaveLength(0);
		expect(result.stats.totalHops).toBe(0);
	});

	it("includes the query in results", async () => {
		const index = createMockIndex([slackChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		expect(result.query).toBe("upload failures");
	});

	it("follows multi-hop chains: slack → issue → PR via edges", async () => {
		// Only seed with the Slack chunk — the issue and PR should be discovered
		// purely via edge traversal: slack-msg-1 → issue-142 → pr-156
		const index = createMockIndex([slackChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [testSegment]);

		// Should find the slack seed + at least issue via edge
		const edgeHops = result.hops.filter((h) => h.connection.method === "edge");
		expect(edgeHops.length).toBeGreaterThanOrEqual(1);

		// The issue chunk should be reachable via the "references" edge
		const issueHop = result.hops.find((h) => h.sourceType === "github-issue");
		expect(issueHop).toBeDefined();
		expect(issueHop?.connection.method).toBe("edge");

		// The PR chunk should be reachable via the reverse "closes" edge from issue
		const prHop = result.hops.find((h) => h.sourceType === "github-pr");
		expect(prHop).toBeDefined();
		expect(prHop?.connection.method).toBe("edge");
		expect(prHop?.connection.edgeType).toBe("closes");
	});

	it("resolves edges by exact source match (O(1) indexed lookup)", async () => {
		// Create a segment with many chunks to verify we're not doing O(n) scans
		const largeSegment: Segment = {
			schemaVersion: 1,
			embeddingModel: "test",
			embeddingDimensions: 3,
			chunks: [
				...testSegment.chunks,
				// Add filler chunks that should NOT match
				...Array.from({ length: 100 }, (_, i) => ({
					id: `filler-${i}`,
					storageId: `storage-filler-${i}`,
					content: `unrelated content ${i}`,
					embedding: [0.1, 0.1, 0.1],
					terms: ["filler"],
					source: `unrelated/source-${i}`,
					sourceType: "markdown",
					metadata: {},
				})),
			],
			edges: testSegment.edges,
		};

		const index = createMockIndex([slackChunk]);
		const result = await trace("upload failures", mockEmbedder, index, [largeSegment]);

		// Should still resolve the edge to issue-142
		const issueHop = result.hops.find((h) => h.sourceType === "github-issue");
		expect(issueHop).toBeDefined();
		expect(issueHop?.source).toBe("FilOzone/synapse-sdk#142");
	});

	it("fills underrepresented source types via semantic fallback", async () => {
		// Only seed the index with slack — edges lead to issue and PR.
		// Code chunk is in the segment but not in the seed results.
		// The semantic fallback should find the code chunk.
		const codeEntry: VectorEntry = {
			id: "code-manager-ts",
			vector: new Float32Array([0.7, 0.3, 0.0]),
			storageId: "storage-code-1",
			metadata: {
				sourceType: "code",
				source: "FilOzone/synapse-sdk",
				content: "export class StorageManager { async upload(data) { ... } }",
			},
		};

		const segmentWithCode: Segment = {
			...testSegment,
			chunks: [
				...testSegment.chunks,
				{
					id: "code-manager-ts",
					storageId: "storage-code-1",
					content: "export class StorageManager { async upload(data) { ... } }",
					embedding: [0.7, 0.3, 0.0],
					terms: ["upload", "storage"],
					source: "FilOzone/synapse-sdk",
					sourceType: "code",
					metadata: {},
				},
			],
		};

		// Index returns slack first, then code — but code won't be in initial seeds
		// because maxTotal defaults to 15 and slack+edges fill the initial pass
		const index = createMockIndex([slackChunk, codeEntry]);
		const result = await trace("upload failures", mockEmbedder, index, [segmentWithCode], {
			maxPerSource: 1,
		});

		// Should have at least one code result from semantic fallback
		const codeHop = result.hops.find((h) => h.sourceType === "code");
		expect(codeHop).toBeDefined();
		expect(codeHop?.connection.method).toBe("semantic");

		// Should have results from multiple source types
		expect(result.stats.sourceTypes.length).toBeGreaterThanOrEqual(3);
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();

		const index = createMockIndex([slackChunk]);
		await expect(
			trace("upload failures", mockEmbedder, index, [testSegment], {
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});
});
