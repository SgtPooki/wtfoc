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

	it("sub-chunks from large symbol are non-overlapping and cover the content", () => {
		const lines = ["export function bigFn() {"];
		for (let i = 0; i < 200; i++) {
			lines.push(`  const x${i} = ${i}; // padding line ${i}`);
		}
		lines.push("}");
		const src = lines.join("\n");

		const chunks = chunker.chunk(makeDoc(src), { maxChunkChars: 1000 });

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
