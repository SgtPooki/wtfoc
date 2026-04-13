import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { buildSourceIndex, resolves } from "./edge-resolution.js";

function makeSegment(chunks: Array<{ id: string; source: string; sourceType: string }>): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 384,
		chunks: chunks.map((c) => ({
			...c,
			storageId: c.id,
			content: "test content",
			embedding: [],
			terms: [],
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		})),
		edges: [],
	};
}

describe("resolves", () => {
	it("matches org/repo-prefixed targetId against dot-slash source via prefix stripping", () => {
		const index = buildSourceIndex([
			makeSegment([{ id: "c1", source: "./packages/ingest/src/edges/llm.ts", sourceType: "code" }]),
		]);

		// The LLM produces "SgtPooki/wtfoc/packages/ingest/src/edges/llm.ts"
		// which should resolve against "./packages/ingest/src/edges/llm.ts"
		expect(resolves("SgtPooki/wtfoc/packages/ingest/src/edges/llm.ts", index)).toBe(true);
	});

	it("still resolves exact source match", () => {
		const index = buildSourceIndex([
			makeSegment([{ id: "c1", source: "owner/repo#42", sourceType: "github-issue" }]),
		]);

		expect(resolves("owner/repo#42", index)).toBe(true);
	});

	it("still resolves direct chunk ID match", () => {
		const index = buildSourceIndex([
			makeSegment([{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" }]),
		]);

		expect(resolves("c1", index)).toBe(true);
	});

	it("still resolves partial source match without prefix stripping", () => {
		const index = buildSourceIndex([
			makeSegment([{ id: "c1", source: "owner/repo/src/index.ts", sourceType: "code" }]),
		]);

		expect(resolves("owner/repo/src/index.ts", index)).toBe(true);
	});

	it("resolves root-relative targetId against dot-slash source after normalization", () => {
		const index = buildSourceIndex([
			makeSegment([{ id: "c1", source: "./packages/foo.ts", sourceType: "code" }]),
		]);

		// Edge with root-relative path (no ./) should exact-match after normalization
		expect(resolves("packages/foo.ts", index)).toBe(true);
	});
});
