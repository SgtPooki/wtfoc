import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import {
	buildBatchRepoAffinity,
	extractChangedFileEdges,
	inferRepoFromContent,
	RegexEdgeExtractor,
} from "./extractor.js";

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

function makeSlackChunk(content: string, overrides: Partial<Chunk> = {}): Chunk {
	return makeChunk(content, {
		sourceType: "slack-message",
		source: "#foc-support",
		...overrides,
	});
}

describe("RegexEdgeExtractor", () => {
	const extractor = new RegexEdgeExtractor();

	describe("references — local issue refs (#123) — GitHub chunks", () => {
		it("repo-scopes a local issue reference using chunk source", () => {
			const chunk = makeChunk("This relates to #123");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "owner/repo#123",
				evidence: "#123",
				confidence: 1.0,
			});
		});

		it("extracts multiple local refs from one chunk, all repo-scoped", () => {
			const chunk = makeChunk("See #10 and #20 for context");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetId)).toEqual(["owner/repo#10", "owner/repo#20"]);
		});
	});

	describe("references — local issue refs (#123) — non-GitHub chunks", () => {
		it("keeps bare #123 for Slack chunks with no repo context anywhere", () => {
			const chunk = makeSlackChunk("This relates to #123");
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

		it("extracts multiple bare local refs from a Slack chunk with no context", () => {
			const chunk = makeSlackChunk("See #10 and #20 for context");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetId)).toEqual(["#10", "#20"]);
		});
	});

	describe("context-aware bare #N resolution — same-chunk inference", () => {
		it("infers repo from GitHub URL in same Slack message", () => {
			const chunk = makeSlackChunk(
				"See https://github.com/FILCAT/pdp/pull/38 — also related to #42",
			);
			const edges = extractor.extract([chunk]);

			const urlEdge = edges.find((e) => e.evidence.startsWith("https://"));
			const bareEdge = edges.find((e) => e.evidence === "#42");

			expect(urlEdge?.targetId).toBe("FILCAT/pdp#38");
			expect(urlEdge?.confidence).toBe(1.0);

			expect(bareEdge?.targetId).toBe("FILCAT/pdp#42");
			expect(bareEdge?.confidence).toBe(0.5);
		});

		it("infers repo from cross-repo ref in same Slack message", () => {
			const chunk = makeSlackChunk(
				"FilOzone/synapse-sdk#100 is the main issue, see also #101 and #102",
			);
			const edges = extractor.extract([chunk]);

			const explicit = edges.find((e) => e.evidence === "FilOzone/synapse-sdk#100");
			const inferred = edges.filter((e) => e.confidence === 0.5);

			expect(explicit?.confidence).toBe(1.0);
			expect(inferred).toHaveLength(2);
			expect(inferred.map((e) => e.targetId).sort()).toEqual([
				"FilOzone/synapse-sdk#101",
				"FilOzone/synapse-sdk#102",
			]);
		});

		it("picks the most frequently referenced repo when multiple are present", () => {
			const chunk = makeSlackChunk(
				"FILCAT/pdp#1 FILCAT/pdp#2 FilOzone/synapse-sdk#3 — see also #99",
			);
			const edges = extractor.extract([chunk]);

			const bareEdge = edges.find((e) => e.evidence === "#99");
			// FILCAT/pdp appears twice, synapse-sdk once — pdp wins
			expect(bareEdge?.targetId).toBe("FILCAT/pdp#99");
			expect(bareEdge?.confidence).toBe(0.5);
		});
	});

	describe("context-aware bare #N resolution — batch-level affinity", () => {
		it("uses batch affinity when single chunk has no context", () => {
			const contextChunk = makeSlackChunk(
				"See https://github.com/FILCAT/pdp/issues/10",
				{ id: "ctx" },
			);
			const bareChunk = makeSlackChunk("this is about #42", { id: "bare" });

			const edges = extractor.extract([contextChunk, bareChunk]);

			const bareEdge = edges.find((e) => e.sourceId === "bare" && e.evidence === "#42");
			expect(bareEdge?.targetId).toBe("FILCAT/pdp#42");
			expect(bareEdge?.confidence).toBe(0.5);
		});

		it("prefers same-chunk context over batch affinity", () => {
			// Batch has lots of FILCAT/pdp refs
			const batchChunk1 = makeSlackChunk("FILCAT/pdp#1 FILCAT/pdp#2", { id: "b1" });
			// This chunk mentions a different repo directly
			const targetChunk = makeSlackChunk(
				"FilOzone/synapse-sdk#50 is broken, see #51",
				{ id: "target" },
			);

			const edges = extractor.extract([batchChunk1, targetChunk]);

			const bareEdge = edges.find(
				(e) => e.sourceId === "target" && e.evidence === "#51",
			);
			// Same-chunk context (synapse-sdk) should win over batch affinity (pdp)
			expect(bareEdge?.targetId).toBe("FilOzone/synapse-sdk#51");
		});

		it("uses GitHub chunk sources for batch affinity", () => {
			const ghChunk = makeChunk("Some PR content", { id: "gh" });
			const slackChunk = makeSlackChunk("related to #42", { id: "slack" });

			const edges = extractor.extract([ghChunk, slackChunk]);

			const bareEdge = edges.find(
				(e) => e.sourceId === "slack" && e.evidence === "#42",
			);
			expect(bareEdge?.targetId).toBe("owner/repo#42");
			expect(bareEdge?.confidence).toBe(0.5);
		});
	});

	describe("context-aware bare #N — closes edges", () => {
		it("infers repo for Fixes #N in Slack chunk with context", () => {
			const chunk = makeSlackChunk(
				"Fixes #42 — see https://github.com/FILCAT/pdp/pull/38",
			);
			const edges = extractor.extract([chunk]);

			const closesEdge = edges.find((e) => e.type === "closes");
			expect(closesEdge?.targetId).toBe("FILCAT/pdp#42");
			expect(closesEdge?.confidence).toBe(0.5);
		});

		it("keeps bare #N for closes when no context exists", () => {
			const chunk = makeSlackChunk("Fixes #42");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]?.type).toBe("closes");
			expect(edges[0]?.targetId).toBe("#42");
			expect(edges[0]?.confidence).toBe(1.0);
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

		it("extracts cross-repo refs from Slack chunks too", () => {
			const chunk = makeSlackChunk("See FilOzone/synapse-sdk#142");
			const edges = extractor.extract([chunk]);

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
			it(`extracts repo-scoped 'closes' edge for keyword "${keyword}" (GitHub chunk)`, () => {
				const chunk = makeChunk(`${keyword} #42`);
				const edges = extractor.extract([chunk]);

				expect(edges).toHaveLength(1);
				expect(edges[0]?.type).toBe("closes");
				expect(edges[0]?.targetId).toBe("owner/repo#42");
				expect(edges[0]?.confidence).toBe(1.0);
			});
		}

		it("keeps bare #42 for non-GitHub closes with no context", () => {
			const chunk = makeSlackChunk("Fixes #42");
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(1);
			expect(edges[0]?.type).toBe("closes");
			expect(edges[0]?.targetId).toBe("#42");
		});

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
			expect(closes[0]?.targetId).toBe("owner/repo#42");
			expect(refs).toHaveLength(1);
			expect(refs[0]?.targetId).toBe("owner/repo#99");
		});
	});

	describe("mixed content", () => {
		it("extracts all edge types from a PR body (GitHub chunk)", () => {
			const chunk = makeChunk(
				"Fixes #9\n\nRelated to SgtPooki/wtfoc#1 and see https://github.com/other/repo/issues/5",
			);
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(3);

			const closes = edges.filter((e) => e.type === "closes");
			const refs = edges.filter((e) => e.type === "references");

			expect(closes).toHaveLength(1);
			expect(closes[0]?.targetId).toBe("owner/repo#9");

			expect(refs).toHaveLength(2);
			expect(refs.map((e) => e.targetId).sort()).toEqual(["SgtPooki/wtfoc#1", "other/repo#5"]);
		});

		it("extracts mixed edges from Slack chunk — infers repo from context", () => {
			const chunk = makeSlackChunk(
				"Fixes #9\n\nRelated to SgtPooki/wtfoc#1 and see https://github.com/other/repo/issues/5",
			);
			const edges = extractor.extract([chunk]);

			expect(edges).toHaveLength(3);

			const closes = edges.filter((e) => e.type === "closes");
			const refs = edges.filter((e) => e.type === "references");

			expect(closes).toHaveLength(1);
			// SgtPooki/wtfoc and other/repo each appear once — tie broken by first seen
			// The bare #9 gets inferred to whichever repo is most frequent
			expect(closes[0]?.confidence).toBe(0.5);

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

describe("inferRepoFromContent", () => {
	it("extracts repo from GitHub URL", () => {
		expect(inferRepoFromContent("see https://github.com/FILCAT/pdp/pull/38")).toBe("FILCAT/pdp");
	});

	it("extracts repo from cross-repo ref", () => {
		expect(inferRepoFromContent("see FilOzone/synapse-sdk#100")).toBe("FilOzone/synapse-sdk");
	});

	it("picks most frequent repo", () => {
		expect(
			inferRepoFromContent("FILCAT/pdp#1 FILCAT/pdp#2 FilOzone/synapse-sdk#3"),
		).toBe("FILCAT/pdp");
	});

	it("returns undefined for no context", () => {
		expect(inferRepoFromContent("just text with #42")).toBeUndefined();
	});
});

describe("buildBatchRepoAffinity", () => {
	it("counts across all chunks", () => {
		const chunks = [
			makeSlackChunk("FILCAT/pdp#1", { id: "c1" }),
			makeSlackChunk("FILCAT/pdp#2", { id: "c2" }),
			makeSlackChunk("FilOzone/synapse-sdk#3", { id: "c3" }),
		];
		expect(buildBatchRepoAffinity(chunks)).toBe("FILCAT/pdp");
	});

	it("includes GitHub chunk source repos", () => {
		const chunks = [
			makeChunk("some content", { id: "c1" }),
			makeSlackChunk("hello", { id: "c2" }),
		];
		expect(buildBatchRepoAffinity(chunks)).toBe("owner/repo");
	});

	it("returns undefined for chunks with no repo context", () => {
		const chunks = [makeSlackChunk("just text", { id: "c1" })];
		expect(buildBatchRepoAffinity(chunks)).toBeUndefined();
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
