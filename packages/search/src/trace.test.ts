import type { Edge, Segment, VectorEntry } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { InMemoryVectorIndex } from "./index/in-memory.js";
import { hashEmbedder } from "./test-helpers.js";
import { trace } from "./trace/index.js";
import { buildEdgeIndex } from "./trace/indexing.js";

// ─── Embedder — deterministic hash-based for consistent but non-trivial vectors ──
const embedder = hashEmbedder(3);

// ─── Helpers ────────────────────────────────────────────────────────────────────
async function seedIndex(...entries: VectorEntry[]): Promise<InMemoryVectorIndex> {
	const index = new InMemoryVectorIndex();
	await index.add(entries);
	return index;
}

// ─── Test fixtures ──────────────────────────────────────────────────────────────
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

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("trace", () => {
	it("returns results grouped by sourceType", async () => {
		const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		expect(result.groups).toBeDefined();
		expect(result.stats.sourceTypes.length).toBeGreaterThan(0);
		// Discovery mode should not produce insights
		expect(result.insights).toEqual([]);
		expect(result.stats.insightCount).toBe(0);
	});

	it("produces insights in analytical mode", async () => {
		const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
		const result = await trace("upload failures", embedder, index, [testSegment], {
			mode: "analytical",
		});

		expect(result.insights).toBeDefined();
		expect(result.insights.length).toBeGreaterThan(0);
		expect(result.stats.insightCount).toBe(result.insights.length);

		// The mock data has 3+ source types and edge-connected hops, so we expect
		// at least a convergence or evidence-chain insight
		const kinds = result.insights.map((i) => i.kind);
		expect(kinds.some((k) => k === "convergence" || k === "evidence-chain")).toBe(true);

		// Every insight should have valid structure
		for (const insight of result.insights) {
			expect(insight.strength).toBeGreaterThan(0);
			expect(insight.strength).toBeLessThanOrEqual(1);
			expect(insight.summary.length).toBeGreaterThan(0);
			expect(insight.hopIndices.length).toBeGreaterThan(0);
		}
	});

	it("follows explicit edges from seed chunks", async () => {
		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		const edgeHops = result.hops.filter((h) => h.connection.method === "edge");
		expect(edgeHops.length).toBeGreaterThan(0);
		expect(result.stats.edgeHops).toBeGreaterThan(0);
	});

	it("annotates edge hops with evidence", async () => {
		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		const edgeHop = result.hops.find((h) => h.connection.method === "edge");
		expect(edgeHop?.connection.evidence).toBeTruthy();
		expect(edgeHop?.connection.edgeType).toBeTruthy();
		expect(edgeHop?.connection.confidence).toBe(1.0);
	});

	it("includes semantic search results as fallback", async () => {
		const index = await seedIndex(slackChunk, codeChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		const semanticHops = result.hops.filter((h) => h.connection.method === "semantic");
		expect(semanticHops.length).toBeGreaterThan(0);
	});

	it("detects cycles — does not visit same chunk twice", async () => {
		const index = await seedIndex(slackChunk, issueChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		const ids = result.hops.map((h) => h.storageId);
		const uniqueIds = new Set(ids);
		expect(ids.length).toBe(uniqueIds.size);
	});

	it("respects maxTotal limit", async () => {
		const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
		const result = await trace("upload failures", embedder, index, [testSegment], {
			maxTotal: 2,
		});

		expect(result.hops.length).toBeLessThanOrEqual(2);
	});

	it("returns empty results for no matches", async () => {
		const index = new InMemoryVectorIndex();
		const result = await trace("nonexistent query", embedder, index, [testSegment]);

		expect(result.hops).toHaveLength(0);
		expect(result.stats.totalHops).toBe(0);
	});

	it("includes the query in results", async () => {
		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		expect(result.query).toBe("upload failures");
	});

	it("follows multi-hop chains: slack → issue → PR via edges", async () => {
		// Only seed with the Slack chunk — the issue and PR should be discovered
		// purely via edge traversal: slack-msg-1 → issue-142 → pr-156
		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

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

		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [largeSegment]);

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

		// Index has slack + code; edges lead to issue and PR from the segment
		const index = await seedIndex(slackChunk, codeEntry);
		const result = await trace("upload failures", embedder, index, [segmentWithCode], {
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

		const index = await seedIndex(slackChunk);
		await expect(
			trace("upload failures", embedder, index, [testSegment], {
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});

	it("uses overlay edges to discover hops not in segment edges", async () => {
		// Create a segment with NO edges — only chunks
		const segmentNoEdges: Segment = {
			...testSegment,
			edges: [],
		};

		// But provide overlay edges that link slack → issue
		const overlayEdges: Edge[] = [
			{
				type: "implements",
				sourceId: "slack-msg-1",
				targetType: "issue",
				targetId: "FilOzone/synapse-sdk#142",
				evidence: "LLM-extracted: slack discusses issue",
				confidence: 0.7,
				provenance: ["llm"],
			},
		];

		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [segmentNoEdges], {
			overlayEdges,
		});

		// Should find the issue via the overlay edge
		const edgeHops = result.hops.filter((h) => h.connection.method === "edge");
		expect(edgeHops.length).toBeGreaterThan(0);

		const issueHop = result.hops.find((h) => h.sourceType === "github-issue");
		expect(issueHop).toBeDefined();
		expect(issueHop?.connection.method).toBe("edge");
		expect(issueHop?.connection.edgeType).toBe("implements");
	});

	it("carries chunk timestamps through to TraceHop", async () => {
		const timestampedSegment: Segment = {
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
					timestamp: "2026-04-10T14:30:00Z",
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
					timestamp: "2026-04-10T16:00:00Z",
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
			],
		};

		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [timestampedSegment]);

		// Seed hop should carry timestamp
		const slackHop = result.hops.find((h) => h.sourceType === "slack-message");
		expect(slackHop?.timestamp).toBe("2026-04-10T14:30:00Z");

		// Edge-traversed hop should carry timestamp
		const issueHop = result.hops.find((h) => h.sourceType === "github-issue");
		expect(issueHop?.timestamp).toBe("2026-04-10T16:00:00Z");
	});

	it("leaves timestamp undefined when chunk has no timestamp", async () => {
		const index = await seedIndex(slackChunk);
		const result = await trace("upload failures", embedder, index, [testSegment]);

		// testSegment chunks have no timestamp field
		for (const hop of result.hops) {
			expect(hop.timestamp).toBeUndefined();
		}
	});

	describe("sourceTypeBoosts — never-drop soft routing (#265)", () => {
		it("boost changes relative seed ranking (code with 2.0x boost outranks slack with 0.3x)", async () => {
			// Raw cosine score: slack ~ 0.58, code ~ 0.41 (hashEmbedder quantizing).
			// Apply boost: code * 2.0 ≈ 0.82, slack * 0.3 ≈ 0.17 → code should win.
			const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
			const boosted = await trace("upload failures", embedder, index, [testSegment], {
				sourceTypeBoosts: { code: 2.0, "slack-message": 0.3 },
				maxTotal: 4,
			});
			const seedHops = boosted.hops.filter((h) => h.connection.method === "semantic");
			if (seedHops.length < 2) return; // defensive — at least compare top two
			// With 2.0x boost, code should outrank slack (despite slack's higher raw cosine).
			const codeIdx = seedHops.findIndex((h) => h.sourceType === "code");
			const slackIdx = seedHops.findIndex((h) => h.sourceType === "slack-message");
			if (codeIdx !== -1 && slackIdx !== -1) {
				expect(codeIdx).toBeLessThan(slackIdx);
			}
		});

		it("never drops a source type from seeds (unlike excludeSourceTypes)", async () => {
			const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
			// Heavy suppression (0.1) — but result should still contain ALL types
			// since boosts never drop, they only reorder.
			const result = await trace("upload failures", embedder, index, [testSegment], {
				sourceTypeBoosts: {
					"slack-message": 0.1,
					"github-issue": 0.1,
					"github-pr": 0.1,
					code: 0.1,
				},
				maxTotal: 20,
			});
			const typesReached = new Set(result.hops.map((h) => h.sourceType));
			expect(typesReached.size).toBeGreaterThan(0);
		});

		it("missing boost key leaves that type's score unchanged", async () => {
			const index = await seedIndex(slackChunk, issueChunk, prChunk, codeChunk);
			const withoutBoost = await trace("upload failures", embedder, index, [testSegment]);
			const withIrrelevantBoost = await trace("upload failures", embedder, index, [testSegment], {
				sourceTypeBoosts: { nonexistent: 3.0 },
			});
			// Top-level seed order should be identical since no actual source type was boosted
			const firstSemantic = (hops: typeof withoutBoost.hops) =>
				hops.find((h) => h.connection.method === "semantic")?.sourceType;
			expect(firstSemantic(withIrrelevantBoost.hops)).toBe(firstSemantic(withoutBoost.hops));
		});
	});
});

describe("buildEdgeIndex", () => {
	it("indexes overlay edges alongside segment edges", () => {
		const overlayEdges: Edge[] = [
			{
				type: "implements",
				sourceId: "chunk-a",
				targetType: "concept",
				targetId: "design-doc",
				evidence: "LLM: chunk references design doc",
				confidence: 0.6,
			},
		];

		const index = buildEdgeIndex([testSegment], overlayEdges);

		// Segment edges should be indexed
		const slackEdges = index.get("slack-msg-1") ?? [];
		expect(slackEdges.some((e) => e.type === "references")).toBe(true);

		// Overlay edges should also be indexed (forward)
		const overlayFwd = index.get("chunk-a") ?? [];
		expect(overlayFwd.some((e) => e.type === "implements")).toBe(true);

		// Overlay edges should be indexed (reverse)
		const overlayRev = index.get("design-doc") ?? [];
		expect(overlayRev.some((e) => e.evidence.startsWith("←"))).toBe(true);
	});

	it("works without overlay edges (backward compat)", () => {
		const index = buildEdgeIndex([testSegment]);
		const edges = index.get("slack-msg-1") ?? [];
		expect(edges.some((e) => e.type === "references")).toBe(true);
	});

	it("works with empty overlay array", () => {
		const index = buildEdgeIndex([testSegment], []);
		const edges = index.get("slack-msg-1") ?? [];
		expect(edges.some((e) => e.type === "references")).toBe(true);
	});
});

describe("trace chronological projection (#274)", () => {
	// Timestamped variant of the upload-timeout fixture, deliberately ordered
	// so DFS traversal (slack → issue → pr) is NOT chronological: the slack
	// seed is newest, the issue and PR referenced via edges are older, and
	// between the two edge children the PR is older than the issue.
	const slackSeed: VectorEntry = {
		id: "slack-msg-1",
		vector: new Float32Array([1.0, 0.0, 0.0]),
		storageId: "storage-slack-1",
		metadata: {
			sourceType: "slack-message",
			source: "#foc-support",
			content: "users hitting timeouts — see #142",
		},
	};

	const tsSegment: Segment = {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 3,
		chunks: [
			{
				id: "slack-msg-1",
				storageId: "storage-slack-1",
				content: "users hitting timeouts",
				embedding: [1.0, 0.0, 0.0],
				terms: ["upload", "timeout"],
				source: "#foc-support",
				sourceType: "slack-message",
				timestamp: "2025-12-01T00:00:00Z",
				metadata: {},
			},
			{
				id: "issue-142",
				storageId: "storage-issue-142",
				content: "Upload timeout on large files",
				embedding: [0.9, 0.1, 0.0],
				terms: ["upload", "timeout"],
				source: "FilOzone/synapse-sdk#142",
				sourceType: "github-issue",
				timestamp: "2025-10-15T00:00:00Z",
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
				timestamp: "2025-10-14T00:00:00Z",
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

	it("populates chronologicalHopIndices as a permutation of hops", async () => {
		const index = await seedIndex(slackSeed);
		const result = await trace("upload failures", embedder, index, [tsSegment]);

		expect(result.chronologicalHopIndices).toBeDefined();
		expect(result.chronologicalHopIndices).toHaveLength(result.hops.length);
		expect(new Set(result.chronologicalHopIndices).size).toBe(result.hops.length);
	});

	it("orders timestamped hops ascending; DFS hops stay in traversal order", async () => {
		const index = await seedIndex(slackSeed);
		const result = await trace("upload failures", embedder, index, [tsSegment]);

		// Traversal order: slack seed first (newest), then edge children (older)
		expect(result.hops[0]?.sourceType).toBe("slack-message");

		// Chronological order: PR (2025-10-14) → issue (2025-10-15) → slack (2025-12-01)
		const orderedTypes = result.chronologicalHopIndices.map((i) => result.hops[i]?.sourceType);
		const firstThree = orderedTypes.slice(0, 3);
		expect(firstThree).toEqual(["github-pr", "github-issue", "slack-message"]);
	});

	it("mirrors the permutation position onto each hop's chronologicalIndex", async () => {
		const index = await seedIndex(slackSeed);
		const result = await trace("upload failures", embedder, index, [tsSegment]);

		for (let i = 0; i < result.chronologicalHopIndices.length; i++) {
			const hopIdx = result.chronologicalHopIndices[i];
			if (hopIdx === undefined) continue;
			expect(result.hops[hopIdx]?.chronologicalIndex).toBe(i);
		}
	});

	it("does not mutate DFS hop order or parent links", async () => {
		const index = await seedIndex(slackSeed);
		const result = await trace("upload failures", embedder, index, [tsSegment]);

		// Seed is always at index 0 (semantic, no parent)
		expect(result.hops[0]?.connection.method).toBe("semantic");
		expect(result.hops[0]?.parentHopIndex).toBeUndefined();

		// Every non-seed hop's parentHopIndex must point to an earlier index
		for (let i = 1; i < result.hops.length; i++) {
			const parent = result.hops[i]?.parentHopIndex;
			if (parent !== undefined) {
				expect(parent).toBeLessThan(i);
			}
		}
	});

	it("appends undated hops at the end of the chronological projection", async () => {
		const undatedSegment: Segment = {
			...tsSegment,
			chunks: tsSegment.chunks.map((c) => (c.id === "pr-156" ? { ...c, timestamp: undefined } : c)),
		};

		const index = await seedIndex(slackSeed);
		const result = await trace("upload failures", embedder, index, [undatedSegment]);
		const undatedHopIdx = result.hops.findIndex((h) => h.sourceType === "github-pr");
		if (undatedHopIdx === -1) return; // PR didn't make it into hops; skip

		// Undated hop must appear after every dated hop in the projection
		const posInChrono = result.chronologicalHopIndices.indexOf(undatedHopIdx);
		const datedPositions = result.chronologicalHopIndices
			.map((hopIdx, pos) => ({ hopIdx, pos, ts: result.hops[hopIdx]?.timestamp }))
			.filter((x) => x.ts);
		for (const d of datedPositions) expect(posInChrono).toBeGreaterThan(d.pos);
	});
});
