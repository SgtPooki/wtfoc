import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { detectInsights } from "./insights.js";
import type { TraceHop } from "./trace.js";

function makeHop(
	sourceType: string,
	source: string,
	method: "edge" | "semantic" = "semantic",
	overrides?: Partial<TraceHop>,
): TraceHop {
	return {
		content: `content from ${source}`,
		sourceType,
		source,
		storageId: `storage-${source}`,
		connection: {
			method,
			confidence: method === "edge" ? 1.0 : 0.8,
			...(method === "edge" ? { edgeType: "references", evidence: "test edge" } : {}),
		},
		...overrides,
	};
}

function makeSegment(chunks: Array<{ storageId: string; timestamp?: string }>): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 3,
		chunks: chunks.map((c) => ({
			id: c.storageId,
			storageId: c.storageId,
			content: "test",
			embedding: [1, 0, 0],
			terms: [],
			source: "test",
			sourceType: "test",
			timestamp: c.timestamp,
			metadata: {},
		})),
		edges: [],
	};
}

describe("detectInsights", () => {
	describe("convergence", () => {
		it("detects convergence when 3+ source types are present", () => {
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support"),
				makeHop("github-issue", "org/repo#1"),
				makeHop("code", "org/repo"),
			];

			const insights = detectInsights(hops, []);

			const convergence = insights.find((i) => i.kind === "convergence");
			expect(convergence).toBeDefined();
			expect(convergence?.summary).toContain("3 source types");
			expect(convergence?.hopIndices).toHaveLength(3);
			// hopIndices should be sorted by traversal order, not grouped by type
			expect(convergence?.hopIndices).toEqual([0, 1, 2]);
		});

		it("does not detect convergence with fewer than 3 source types", () => {
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support"),
				makeHop("github-issue", "org/repo#1"),
			];

			const insights = detectInsights(hops, []);

			const convergence = insights.find((i) => i.kind === "convergence");
			expect(convergence).toBeUndefined();
		});

		it("strength increases with more source types", () => {
			const hops3: TraceHop[] = [
				makeHop("slack-message", "#support"),
				makeHop("github-issue", "org/repo#1"),
				makeHop("code", "org/repo"),
			];

			const hops5: TraceHop[] = [
				...hops3,
				makeHop("github-pr", "org/repo#2"),
				makeHop("markdown", "README.md"),
			];

			const insights3 = detectInsights(hops3, []);
			const insights5 = detectInsights(hops5, []);

			const c3 = insights3.find((i) => i.kind === "convergence");
			const c5 = insights5.find((i) => i.kind === "convergence");
			expect(c3).toBeDefined();
			expect(c5).toBeDefined();
			expect(c5?.strength).toBeGreaterThan(c3?.strength ?? 0);
		});
	});

	describe("evidence-chain", () => {
		it("detects a linear chain crossing 3+ source types via parentHopIndex", () => {
			// Seed(0) → Issue(1) → PR(2) → Code(3)
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic"),
				makeHop("github-issue", "org/repo#1", "edge", { parentHopIndex: 0 }),
				makeHop("github-pr", "org/repo#2", "edge", { parentHopIndex: 1 }),
				makeHop("code", "org/repo", "edge", { parentHopIndex: 2 }),
			];

			const insights = detectInsights(hops, []);

			const chain = insights.find((i) => i.kind === "evidence-chain");
			expect(chain).toBeDefined();
			expect(chain?.summary).toContain("→");
			// Should be the full path: [0, 1, 2, 3]
			expect(chain?.hopIndices).toEqual([0, 1, 2, 3]);
		});

		it("does not detect a chain with fewer than 3 source types", () => {
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic"),
				makeHop("github-issue", "org/repo#1", "edge", { parentHopIndex: 0 }),
				makeHop("github-issue", "org/repo#2", "edge", { parentHopIndex: 1 }),
			];

			const insights = detectInsights(hops, []);

			const chain = insights.find((i) => i.kind === "evidence-chain");
			expect(chain).toBeUndefined();
		});

		it("reports separate paths for sibling branches from DFS", () => {
			// Seed(0) branches into two paths:
			//   0 → 1(issue) → 2(PR) → 3(code)   ← 4 types
			//   0 → 4(issue) → 5(docs)             ← only 3 types (slack, issue, docs)
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic"), // 0: seed
				makeHop("github-issue", "org/repo#1", "edge", { parentHopIndex: 0 }), // 1
				makeHop("github-pr", "org/repo#2", "edge", { parentHopIndex: 1 }), // 2
				makeHop("code", "org/repo", "edge", { parentHopIndex: 2 }), // 3
				makeHop("github-issue", "org/repo#3", "edge", { parentHopIndex: 0 }), // 4: sibling
				makeHop("markdown", "docs.md", "edge", { parentHopIndex: 4 }), // 5
			];

			const insights = detectInsights(hops, []);

			const chains = insights.filter((i) => i.kind === "evidence-chain");
			// Should find 2 chains: [0,1,2,3] and [0,4,5]
			expect(chains.length).toBe(2);

			// The longer chain should be first (longer = higher strength due to more types)
			expect(chains[0]?.hopIndices).toEqual([0, 1, 2, 3]);
			expect(chains[1]?.hopIndices).toEqual([0, 4, 5]);
		});

		it("does not detect chains without parentHopIndex", () => {
			// Edge hops with no parentHopIndex — old-style data
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic"),
				makeHop("github-issue", "org/repo#1", "edge"),
				makeHop("github-pr", "org/repo#2", "edge"),
				makeHop("code", "org/repo", "edge"),
			];

			const insights = detectInsights(hops, []);

			// Without parentHopIndex, no tree structure → no chains
			const chain = insights.find((i) => i.kind === "evidence-chain");
			expect(chain).toBeUndefined();
		});
	});

	describe("temporal-cluster", () => {
		it("detects recent activity concentration", () => {
			const now = new Date();
			const recent1 = new Date(now.getTime() - 5 * 86_400_000).toISOString(); // 5 days ago
			const recent2 = new Date(now.getTime() - 10 * 86_400_000).toISOString(); // 10 days ago
			const old1 = new Date(now.getTime() - 180 * 86_400_000).toISOString(); // 180 days ago

			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic", { storageId: "s1" }),
				makeHop("github-issue", "org/repo#1", "semantic", { storageId: "s2" }),
				makeHop("code", "org/repo", "semantic", { storageId: "s3" }),
			];

			const segment = makeSegment([
				{ storageId: "s1", timestamp: recent1 },
				{ storageId: "s2", timestamp: recent2 },
				{ storageId: "s3", timestamp: old1 },
			]);

			const insights = detectInsights(hops, [segment]);

			const temporal = insights.find((i) => i.kind === "temporal-cluster");
			expect(temporal).toBeDefined();
			expect(temporal?.summary).toContain("2 of 3");
			expect(temporal?.summary).toContain("30 days");
		});

		it("does not detect cluster when most results are old", () => {
			const now = new Date();
			const old1 = new Date(now.getTime() - 180 * 86_400_000).toISOString();
			const old2 = new Date(now.getTime() - 200 * 86_400_000).toISOString();
			const recent = new Date(now.getTime() - 5 * 86_400_000).toISOString();

			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic", { storageId: "s1" }),
				makeHop("github-issue", "org/repo#1", "semantic", { storageId: "s2" }),
				makeHop("code", "org/repo", "semantic", { storageId: "s3" }),
				makeHop("markdown", "docs.md", "semantic", { storageId: "s4" }),
				makeHop("github-pr", "org/repo#2", "semantic", { storageId: "s5" }),
			];

			const segment = makeSegment([
				{ storageId: "s1", timestamp: old1 },
				{ storageId: "s2", timestamp: old2 },
				{ storageId: "s3", timestamp: old1 },
				{ storageId: "s4", timestamp: old2 },
				{ storageId: "s5", timestamp: recent },
			]);

			const insights = detectInsights(hops, [segment]);

			const temporal = insights.find((i) => i.kind === "temporal-cluster");
			expect(temporal).toBeUndefined();
		});

		it("skips temporal detection when no timestamps are available", () => {
			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic", { storageId: "s1" }),
				makeHop("github-issue", "org/repo#1", "semantic", { storageId: "s2" }),
			];

			const segment = makeSegment([{ storageId: "s1" }, { storageId: "s2" }]);

			const insights = detectInsights(hops, [segment]);

			const temporal = insights.find((i) => i.kind === "temporal-cluster");
			expect(temporal).toBeUndefined();
		});
	});

	describe("integration", () => {
		it("returns insights sorted by strength descending", () => {
			const now = new Date();
			const recent = new Date(now.getTime() - 5 * 86_400_000).toISOString();

			const hops: TraceHop[] = [
				makeHop("slack-message", "#support", "semantic", { storageId: "s1" }),
				makeHop("github-issue", "org/repo#1", "edge", { storageId: "s2", parentHopIndex: 0 }),
				makeHop("github-pr", "org/repo#2", "edge", { storageId: "s3", parentHopIndex: 1 }),
				makeHop("code", "org/repo", "edge", { storageId: "s4", parentHopIndex: 2 }),
			];

			const segment = makeSegment([
				{ storageId: "s1", timestamp: recent },
				{ storageId: "s2", timestamp: recent },
				{ storageId: "s3", timestamp: recent },
				{ storageId: "s4", timestamp: recent },
			]);

			const insights = detectInsights(hops, [segment]);

			expect(insights.length).toBeGreaterThanOrEqual(2);
			// Verify sorted by strength descending
			for (let i = 1; i < insights.length; i++) {
				expect(insights[i]?.strength).toBeLessThanOrEqual(insights[i - 1]?.strength ?? 0);
			}
		});

		it("returns empty array for empty hops", () => {
			expect(detectInsights([], [])).toEqual([]);
		});
	});
});
