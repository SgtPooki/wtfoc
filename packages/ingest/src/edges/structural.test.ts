import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { StructuralEdgeExtractor } from "./structural.js";

function chunk(overrides: Partial<Chunk> & { id: string }): Chunk {
	return {
		content: "stub",
		sourceType: "code",
		source: "repo/pkg/file.ts",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		documentId: "repo/pkg/file.ts",
		documentVersionId: "v1",
		...overrides,
	};
}

describe("StructuralEdgeExtractor", () => {
	const extractor = new StructuralEdgeExtractor();

	it("emits a contains edge from file summary to each symbol chunk in the same document", async () => {
		const summary = chunk({
			id: "sum-1",
			metadata: { chunkLevel: "file", filePath: "pkg/file.ts" },
		});
		const sym1 = chunk({ id: "sym-1" });
		const sym2 = chunk({ id: "sym-2" });
		const edges = await extractor.extract([summary, sym1, sym2]);
		expect(edges).toHaveLength(2);
		for (const e of edges) {
			expect(e.type).toBe("contains");
			expect(e.sourceId).toBe("sum-1");
			expect(e.confidence).toBe(1);
			expect(e.provenance).toEqual(["structural"]);
		}
		expect(edges.map((e) => e.targetId).sort()).toEqual(["sym-1", "sym-2"]);
	});

	it("does not emit a contains edge to itself", async () => {
		const summary = chunk({ id: "sum-1", metadata: { chunkLevel: "file" } });
		const edges = await extractor.extract([summary]);
		expect(edges).toEqual([]);
	});

	it("does not emit edges between two file summaries (defensive)", async () => {
		// Shouldn't happen in practice, but if two summary chunks end up in the
		// same documentVersion group, skip them rather than cross-link.
		const s1 = chunk({ id: "sum-1", metadata: { chunkLevel: "file" } });
		const s2 = chunk({ id: "sum-2", metadata: { chunkLevel: "file" } });
		const edges = await extractor.extract([s1, s2]);
		expect(edges).toEqual([]);
	});

	it("scopes edges per (documentId, documentVersionId) — never crosses documents", async () => {
		const aSummary = chunk({
			id: "a-sum",
			documentId: "repo/a.ts",
			metadata: { chunkLevel: "file" },
		});
		const aSym = chunk({ id: "a-sym", documentId: "repo/a.ts" });
		const bSummary = chunk({
			id: "b-sum",
			documentId: "repo/b.ts",
			metadata: { chunkLevel: "file" },
		});
		const bSym = chunk({ id: "b-sym", documentId: "repo/b.ts" });
		const edges = await extractor.extract([aSummary, aSym, bSummary, bSym]);
		expect(edges).toHaveLength(2);
		const byTarget = Object.fromEntries(edges.map((e) => [e.targetId, e.sourceId]));
		expect(byTarget["a-sym"]).toBe("a-sum");
		expect(byTarget["b-sym"]).toBe("b-sum");
	});

	it("scopes edges per documentVersionId — supersedes don't bleed", async () => {
		const v1Sum = chunk({
			id: "v1-sum",
			documentVersionId: "v1",
			metadata: { chunkLevel: "file" },
		});
		const v1Sym = chunk({ id: "v1-sym", documentVersionId: "v1" });
		const v2Sum = chunk({
			id: "v2-sum",
			documentVersionId: "v2",
			metadata: { chunkLevel: "file" },
		});
		const v2Sym = chunk({ id: "v2-sym", documentVersionId: "v2" });
		const edges = await extractor.extract([v1Sum, v1Sym, v2Sum, v2Sym]);
		expect(edges).toHaveLength(2);
		const byTarget = Object.fromEntries(edges.map((e) => [e.targetId, e.sourceId]));
		expect(byTarget["v1-sym"]).toBe("v1-sum");
		expect(byTarget["v2-sym"]).toBe("v2-sum");
	});

	it("skips chunks without documentId (legacy anonymous chunks)", async () => {
		const summary = chunk({ id: "sum-1", metadata: { chunkLevel: "file" } });
		const anon = chunk({ id: "anon-1", documentId: undefined, documentVersionId: undefined });
		const edges = await extractor.extract([summary, anon]);
		expect(edges).toEqual([]);
	});

	it("emits no edges when the document has no file summary chunk", async () => {
		// Older collections without hierarchical-code chunker output stay edge-free.
		const edges = await extractor.extract([chunk({ id: "sym-1" }), chunk({ id: "sym-2" })]);
		expect(edges).toEqual([]);
	});

	it("targetType mirrors the symbol chunk's sourceType", async () => {
		const summary = chunk({
			id: "sum-1",
			sourceType: "code",
			metadata: { chunkLevel: "file" },
		});
		const sym = chunk({ id: "sym-1", sourceType: "code" });
		const edges = await extractor.extract([summary, sym]);
		expect(edges).toHaveLength(1);
		expect(edges[0]?.targetType).toBe("code");
	});

	it("respects AbortSignal", async () => {
		const ac = new AbortController();
		ac.abort();
		const summary = chunk({ id: "sum-1", metadata: { chunkLevel: "file" } });
		await expect(extractor.extract([summary], ac.signal)).rejects.toThrow();
	});
});
