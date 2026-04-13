import { describe, expect, it } from "vitest";
import { AstHeuristicChunker } from "./ast-heuristic-chunker.js";

const chunker = new AstHeuristicChunker();

function makeDoc(content: string, filePath = "src/example.ts") {
	return {
		documentId: "doc-1",
		documentVersionId: "v-1",
		content,
		sourceType: "code",
		source: "owner/repo/src/example.ts",
		filePath,
	};
}

describe("AstHeuristicChunker — span provenance", () => {
	it("chunk content matches what byteOffsets describe in the source document", () => {
		const src = [
			"import { foo } from './foo.js';",
			"",
			"export function alpha() {",
			"  return 1;",
			"}",
			"",
			"export function beta() {",
			"  return 2;",
			"}",
		].join("\n");

		const chunks = chunker.chunk(makeDoc(src));

		for (const chunk of chunks) {
			if (chunk.byteOffsetStart == null || chunk.byteOffsetEnd == null) continue;
			// byteOffsetStart is 1-indexed; slice to the described region
			const described = src.slice(chunk.byteOffsetStart - 1, chunk.byteOffsetEnd);
			// The stored content must be contained within what the offsets describe
			// (trim is allowed to strip surrounding whitespace, but no more)
			expect(described.trim()).toContain(chunk.content.trim());
		}
	});

	it("lineStart and lineEnd describe the correct lines in the source", () => {
		const src = [
			"import { x } from './x.js';",
			"",
			"export function one() {",
			"  return 1;",
			"}",
			"",
			"export function two() {",
			"  return 2;",
			"}",
		].join("\n");

		const lines = src.split("\n");
		const chunks = chunker.chunk(makeDoc(src));

		for (const chunk of chunks) {
			if (chunk.lineStart == null || chunk.lineEnd == null) continue;
			// lineStart is 1-indexed
			const describedLines = lines.slice(chunk.lineStart - 1, chunk.lineEnd).join("\n");
			expect(describedLines.trim()).toContain(chunk.content.trim());
		}
	});

	it("preamble chunk has byteOffsetStart and byteOffsetEnd", () => {
		const src = [
			"import { a } from './a.js';",
			"import { b } from './b.js';",
			"",
			"export function main() {",
			"  return a() + b();",
			"}",
		].join("\n");

		const chunks = chunker.chunk(makeDoc(src));
		const preamble = chunks.find((c) => c.symbolPath === "preamble");

		expect(preamble).toBeDefined();
		expect(preamble?.byteOffsetStart).toBeDefined();
		expect(preamble?.byteOffsetEnd).toBeDefined();
	});
});

describe("AstHeuristicChunker — splitLargeChunk span metadata", () => {
	it("each sub-chunk from a large symbol has distinct lineStart values", () => {
		// Create a function large enough to trigger #splitLargeChunk (> 4000 chars)
		const lines = ["export function bigFunction() {"];
		for (let i = 0; i < 200; i++) {
			lines.push(`  const var${i} = ${i} * 2; // line ${i}`);
		}
		lines.push("}");
		const src = lines.join("\n");

		const chunks = chunker.chunk(makeDoc(src), { maxChunkChars: 1000 });

		// Should have produced multiple sub-chunks
		expect(chunks.length).toBeGreaterThan(1);

		// Each sub-chunk must have lineStart, lineEnd, byteOffsetStart, byteOffsetEnd
		for (const chunk of chunks) {
			expect(chunk.lineStart).toBeDefined();
			expect(chunk.lineEnd).toBeDefined();
			expect(chunk.byteOffsetStart).toBeDefined();
			expect(chunk.byteOffsetEnd).toBeDefined();
		}

		// lineStart values must not all be the same
		const lineStarts = chunks.map((c) => c.lineStart);
		const uniqueLineStarts = new Set(lineStarts);
		expect(uniqueLineStarts.size).toBeGreaterThan(1);
	});

	it("sub-chunks from large symbol are non-overlapping when chunkOverlap=0", () => {
		const lines = ["export function bigFn() {"];
		for (let i = 0; i < 200; i++) {
			lines.push(`  const x${i} = ${i}; // padding line ${i}`);
		}
		lines.push("}");
		const src = lines.join("\n");

		const chunks = chunker.chunk(makeDoc(src), { maxChunkChars: 1000, chunkOverlap: 0 });

		// Sub-chunks should be ordered by byteOffsetStart
		const sorted = [...chunks].sort((a, b) => (a.byteOffsetStart ?? 0) - (b.byteOffsetStart ?? 0));
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1];
			const curr = sorted[i];
			if (!prev || !curr) continue;
			// Non-overlapping: each chunk starts at or after the previous ends
			expect(curr.byteOffsetStart).toBeGreaterThanOrEqual(prev.byteOffsetEnd ?? 0);
		}
	});
});

describe("AstHeuristicChunker — structural overlap (#250)", () => {
	const src = [
		"export function alpha() {",
		"  // alpha body",
		"  return 1;",
		"}",
		"",
		"export function beta() {",
		"  // beta body",
		"  return 2;",
		"}",
	].join("\n");

	it("by default (no chunkOverlap), inter-symbol chunks have no overlap content", () => {
		const chunks = chunker.chunk(makeDoc(src));
		// With no overlap, beta chunk should NOT contain any alpha content
		const betaChunk = chunks.find((c) => c.content.includes("beta"));
		expect(betaChunk).toBeDefined();
		expect(betaChunk?.content).not.toContain("alpha");
	});

	it("with chunkOverlap > 0, each inter-symbol chunk includes a header from the previous symbol", () => {
		const chunks = chunker.chunk(makeDoc(src), { chunkOverlap: 30 });
		// beta chunk should now carry some content from alpha
		const betaChunk = chunks.find((c) => c.content.includes("beta body"));
		expect(betaChunk).toBeDefined();
		expect(betaChunk?.content).toContain("alpha");
	});

	it("overlap header is prepended before the symbol's own content", () => {
		const chunks = chunker.chunk(makeDoc(src), { chunkOverlap: 30 });
		const betaChunk = chunks.find((c) => c.content.includes("beta body"));
		if (!betaChunk) throw new Error("beta chunk not found");
		// alpha context appears before beta content in the chunk
		const alphaPos = betaChunk.content.indexOf("alpha");
		const betaPos = betaChunk.content.indexOf("beta");
		expect(alphaPos).toBeLessThan(betaPos);
	});

	it("byteOffsetStart/End still describe beta's own position in the document", () => {
		const chunksNoOverlap = chunker.chunk(makeDoc(src), { chunkOverlap: 0 });
		const chunksWithOverlap = chunker.chunk(makeDoc(src), { chunkOverlap: 30 });
		const betaNoOverlap = chunksNoOverlap.find((c) => c.content.includes("export function beta"));
		const betaWithOverlap = chunksWithOverlap.find((c) =>
			c.content.includes("export function beta"),
		);
		// byteOffsets should be consistent regardless of overlap (overlap is added to content but
		// doesn't shift the documented position of the chunk in the source)
		expect(betaWithOverlap?.byteOffsetStart).toBe(betaNoOverlap?.byteOffsetStart);
	});

	it("intra-symbol splits overlap by chunkOverlap chars", () => {
		const lines = ["export function bigFn() {"];
		for (let i = 0; i < 200; i++) {
			lines.push(`  const x${i} = ${i}; // line ${i}`);
		}
		lines.push("}");
		const src2 = lines.join("\n");

		const overlap = 100;
		const chunks = chunker.chunk(makeDoc(src2), { maxChunkChars: 1000, chunkOverlap: overlap });

		expect(chunks.length).toBeGreaterThan(1);
		// Each chunk (except the first) should share `overlap` chars with the end of the previous
		for (let i = 1; i < chunks.length; i++) {
			const prev = chunks[i - 1];
			const curr = chunks[i];
			if (!prev || !curr) continue;
			const prevTail = prev.content.slice(-overlap);
			expect(curr.content).toContain(prevTail.slice(0, 20)); // at least starts overlap
		}
	});

	it("first sub-chunk of an oversized symbol carries the previous symbol's header", () => {
		// alpha is small, beta is large (exceeds maxChunkChars) — first sub-chunk of beta
		// must still include context from alpha when chunkOverlap > 0
		const alphaLines = ["export function alpha() {", "  return 'alpha context';", "}"];
		const betaLines = ["export function beta() {"];
		for (let i = 0; i < 200; i++) {
			betaLines.push(`  const y${i} = ${i}; // beta line ${i}`);
		}
		betaLines.push("}");

		const src = [...alphaLines, "", ...betaLines].join("\n");
		const chunks = chunker.chunk(makeDoc(src), { maxChunkChars: 500, chunkOverlap: 30 });

		// The first beta sub-chunk (the one containing beta line 0) should carry alpha context
		const firstBetaSubChunk = chunks.find(
			(c) => c.content.includes("beta line 0") && !c.content.includes("alpha"),
		);
		expect(firstBetaSubChunk).toBeUndefined(); // should NOT exist — alpha should be present

		const firstBetaWithAlpha = chunks.find(
			(c) => c.content.includes("beta line 0") && c.content.includes("alpha"),
		);
		expect(firstBetaWithAlpha).toBeDefined();
	});

	it("does not hang when chunkOverlap >= maxChunkChars", () => {
		const lines = ["export function bigFn() {"];
		for (let i = 0; i < 200; i++) {
			lines.push(`  const z${i} = ${i};`);
		}
		lines.push("}");
		const src = lines.join("\n");
		// Would hang without clamping; just verify it terminates and produces output
		const chunks = chunker.chunk(makeDoc(src), { maxChunkChars: 100, chunkOverlap: 200 });
		expect(chunks.length).toBeGreaterThan(0);
	});
});
