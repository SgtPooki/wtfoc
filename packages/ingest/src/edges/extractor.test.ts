import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { extractChangedFileEdges, RegexEdgeExtractor } from "./extractor.js";

function makeChunk(content: string, overrides: Partial<Chunk> = {}): Chunk {
	return {
		id: overrides.id ?? "chunk-1",
		content,
		sourceType: "github-pr",
		source: "owner/repo#10",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		...overrides,
	};
}

describe("RegexEdgeExtractor", () => {
	const extractor = new RegexEdgeExtractor();

	describe("references — local issue refs (#123)", () => {
		it("extracts a local issue reference", () => {
			const chunk = makeChunk("This relates to #123");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "#123",
				evidence: "#123",
				confidence: 1.0,
			});
		});

		it("extracts multiple local refs from one chunk", () => {
			const chunk = makeChunk("See #10 and #20 for context");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetId)).toEqual(["#10", "#20"]);
		});
	});

	describe("references — cross-repo refs (owner/repo#456)", () => {
		it("extracts a cross-repo reference", () => {
			const chunk = makeChunk("Related to FilOzone/synapse-sdk#142");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "FilOzone/synapse-sdk#142",
				evidence: "FilOzone/synapse-sdk#142",
				confidence: 1.0,
			});
		});

		it("does not double-count the number part as a local ref", () => {
			const chunk = makeChunk("See FilOzone/synapse-sdk#142");
			const edges = extractor.extract([chunk]);

			// Should get exactly 1 edge (the cross-repo ref), not 2
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("FilOzone/synapse-sdk#142");
		});
	});

	describe("references — GitHub URLs", () => {
		it("extracts a GitHub issue URL", () => {
			const chunk = makeChunk("See https://github.com/owner/repo/issues/42 for details");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "owner/repo#42",
				evidence: "https://github.com/owner/repo/issues/42",
				confidence: 1.0,
			});
		});

		it("extracts a GitHub PR URL", () => {
			const chunk = makeChunk("Check https://github.com/owner/repo/pull/99");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("owner/repo#99");
		});
	});

	describe("closes — closing keywords", () => {
		for (const keyword of [
			"Closes",
			"closes",
			"Fix",
			"Fixes",
			"fixes",
			"Fixed",
			"Resolve",
			"Resolves",
			"resolved",
		]) {
			it(`extracts 'closes' edge for keyword "${keyword}"`, () => {
				const chunk = makeChunk(`${keyword} #42`);
				const edges = extractor.extract([chunk]);

				expect(edges).toHaveLength(1);
				expect(edges[0]?.type).toBe("closes");
				expect(edges[0]?.targetId).toBe("#42");
				expect(edges[0]?.confidence).toBe(1.0);
			});
		}

		it("extracts cross-repo closes", () => {
			const chunk = makeChunk("Fixes owner/repo#99");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "closes",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "owner/repo#99",
				evidence: "Fixes owner/repo#99",
				confidence: 1.0,
			});
		});

		it("does not also emit a 'references' edge for the same target", () => {
			const chunk = makeChunk("Closes #42, also see #99");
			const edges = extractor.extract([chunk]);

			const closes = edges.filter((e) => e.type === "closes");
			const refs = edges.filter((e) => e.type === "references");

			expect(closes).toHaveLength(1);
			expect(closes[0]?.targetId).toBe("#42");
			expect(refs).toHaveLength(1);
			expect(refs[0]?.targetId).toBe("#99");
		});
	});

	describe("mixed content", () => {
		it("extracts all edge types from a PR body", () => {
			const chunk = makeChunk(
				"Fixes #9\n\nRelated to SgtPooki/wtfoc#1 and see https://github.com/other/repo/issues/5",
			);
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(3);

			const closes = edges.filter((e) => e.type === "closes");
			const refs = edges.filter((e) => e.type === "references");

			expect(closes).toHaveLength(1);
			expect(closes[0]?.targetId).toBe("#9");

			expect(refs).toHaveLength(2);
			expect(refs.map((e) => e.targetId).sort()).toEqual(["SgtPooki/wtfoc#1", "other/repo#5"]);
		});
	});

	describe("no edges", () => {
		it("returns empty array for content with no references", () => {
			const chunk = makeChunk("Just a regular message with no issue refs");
			const edges = extractor.extract([chunk]);
			expect(edges).toHaveLength(0);
		});

		it("returns empty array for empty chunks array", () => {
			const edges = extractor.extract([]);
			expect(edges).toHaveLength(0);
		});
	});

	describe("multiple chunks", () => {
		it("extracts edges from all provided chunks", () => {
			const chunks = [makeChunk("See #1", { id: "c1" }), makeChunk("See #2", { id: "c2" })];
			const edges = extractor.extract(chunks);

			expect(edges).toHaveLength(2);
			expect(edges[0]?.sourceId).toBe("c1");
			expect(edges[1]?.sourceId).toBe("c2");
		});
	});
});

describe("extractChangedFileEdges", () => {
	it("creates 'changes' edges for each file", () => {
		const edges = extractChangedFileEdges("pr-chunk-1", [
			{ repo: "owner/repo", path: "src/index.ts", commitSha: "abc123" },
			{ repo: "owner/repo", path: "README.md", commitSha: "abc123" },
		]);

		expect(edges).toHaveLength(2);
		expect(edges[0]).toEqual({
			type: "changes",
			sourceId: "pr-chunk-1",
			targetType: "file",
			targetId: "owner/repo:src/index.ts@abc123",
			evidence: "Changed file: src/index.ts",
			confidence: 1.0,
		});
		expect(edges[1]).toEqual({
			type: "changes",
			sourceId: "pr-chunk-1",
			targetType: "file",
			targetId: "owner/repo:README.md@abc123",
			evidence: "Changed file: README.md",
			confidence: 1.0,
		});
	});

	it("returns empty array for no files", () => {
		const edges = extractChangedFileEdges("pr-chunk-1", []);
		expect(edges).toHaveLength(0);
	});

	it("includes commit SHA as immutable anchor in targetId", () => {
		const edges = extractChangedFileEdges("pr-chunk-1", [
			{
				repo: "SgtPooki/wtfoc",
				path: "packages/ingest/src/edges/extractor.ts",
				commitSha: "deadbeef",
			},
		]);

		expect(edges[0]?.targetId).toBe(
			"SgtPooki/wtfoc:packages/ingest/src/edges/extractor.ts@deadbeef",
		);
	});

	it("all edges have confidence 1.0", () => {
		const edges = extractChangedFileEdges("c", [
			{ repo: "a/b", path: "f1.ts", commitSha: "sha1" },
			{ repo: "a/b", path: "f2.ts", commitSha: "sha2" },
		]);

		for (const edge of edges) {
			expect(edge.confidence).toBe(1.0);
		}
	});
});
