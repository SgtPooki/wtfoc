import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { buildExcerptMap, getExcerpt } from "./recipe-segment-loader.js";

function makeSegment(
	chunks: Array<{ documentId?: string; content: string; id?: string }>,
): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 4,
		chunks: chunks.map((c, i) => ({
			id: c.id ?? `chunk-${i}`,
			storageId: `s-${i}`,
			content: c.content,
			embedding: [0, 0, 0, 0],
			terms: [],
			source: "src",
			sourceType: "code",
			metadata: {},
			...(c.documentId ? { documentId: c.documentId } : {}),
		})),
		edges: [],
	} as unknown as Segment;
}

describe("buildExcerptMap", () => {
	it("groups chunks by documentId and concatenates in order", () => {
		const seg = makeSegment([
			{ documentId: "doc-A", content: "first" },
			{ documentId: "doc-B", content: "B-only" },
			{ documentId: "doc-A", content: "second" },
		]);
		const m = buildExcerptMap([seg]);
		expect(m.get("doc-A")).toBe("first\n\nsecond");
		expect(m.get("doc-B")).toBe("B-only");
	});

	it("skips chunks without a documentId", () => {
		const seg = makeSegment([
			{ content: "no-doc" },
			{ documentId: "doc-A", content: "with-doc" },
		]);
		const m = buildExcerptMap([seg]);
		expect(m.size).toBe(1);
		expect(m.get("doc-A")).toBe("with-doc");
	});

	it("caps excerpt at maxChars and appends an ellipsis", () => {
		const big = "x".repeat(5000);
		const seg = makeSegment([{ documentId: "doc", content: big }]);
		const m = buildExcerptMap([seg], { maxChars: 100 });
		const e = m.get("doc");
		expect(e?.length).toBe(101); // 100 chars + 1 ellipsis char
		expect(e?.endsWith("…")).toBe(true);
	});

	it("returns no entry for empty content", () => {
		const seg = makeSegment([{ documentId: "doc", content: "" }]);
		const m = buildExcerptMap([seg]);
		expect(m.has("doc")).toBe(false);
	});

	it("merges chunks across multiple segments under the same documentId", () => {
		const segA = makeSegment([{ documentId: "doc", content: "from-A" }]);
		const segB = makeSegment([{ documentId: "doc", content: "from-B" }]);
		const m = buildExcerptMap([segA, segB]);
		expect(m.get("doc")).toContain("from-A");
		expect(m.get("doc")).toContain("from-B");
	});

	it("returns an empty map for empty input", () => {
		expect(buildExcerptMap([]).size).toBe(0);
	});
});

describe("getExcerpt", () => {
	it("returns undefined for unknown artifactIds", () => {
		expect(getExcerpt(new Map(), "missing")).toBeUndefined();
	});
	it("returns the stored excerpt for known artifactIds", () => {
		const m = new Map([["doc", "content"]]);
		expect(getExcerpt(m, "doc")).toBe("content");
	});
});
