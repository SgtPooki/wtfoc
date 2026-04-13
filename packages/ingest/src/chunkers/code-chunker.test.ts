import { describe, expect, it } from "vitest";
import { chunkCode } from "../adapters/repo/chunking.js";
import { CodeWindowChunker } from "./code-chunker.js";

const makeDoc = (content: string) => ({
	documentId: "doc-1",
	documentVersionId: "v1",
	content,
	sourceType: "code",
	source: "owner/repo/file.ts",
	filePath: "file.ts",
});

describe("chunkCode", () => {
	it("defaults to chunkSize=512 and overlap=50", () => {
		const content = "x".repeat(1000);
		const chunks = chunkCode(content, "file.ts", "owner/repo", "http://example.com");
		// First chunk: 0..512
		expect(chunks[0]?.content.length).toBe(512);
		// Second chunk starts at 512-50=462, ends at 462+512=974
		expect(chunks[1]?.content).toBe(content.slice(462, 974));
	});

	it("respects custom chunkSize option", () => {
		const content = "x".repeat(1000);
		const chunks = chunkCode(content, "file.ts", "owner/repo", "http://example.com", {
			chunkSize: 200,
		});
		expect(chunks[0]?.content.length).toBe(200);
	});

	it("respects custom chunkOverlap option", () => {
		const content = "x".repeat(600);
		// chunkSize=500, overlap=0: two chunks [0-500, 500-600]
		const noOverlap = chunkCode(content, "file.ts", "owner/repo", "http://example.com", {
			chunkSize: 500,
			chunkOverlap: 0,
		});
		// chunkSize=500, overlap=100: two chunks [0-500, 400-600]
		const withOverlap = chunkCode(content, "file.ts", "owner/repo", "http://example.com", {
			chunkSize: 500,
			chunkOverlap: 100,
		});
		expect(noOverlap.length).toBe(2);
		expect(noOverlap[1]?.content.length).toBe(100);
		expect(withOverlap.length).toBe(2);
		expect(withOverlap[1]?.content.length).toBe(200);
	});
});

describe("CodeWindowChunker", () => {
	it("uses default chunkSize=512 when no options", () => {
		const chunker = new CodeWindowChunker();
		const chunks = chunker.chunk(makeDoc("x".repeat(1000)));
		expect(chunks[0]?.content.length).toBe(512);
	});

	it("uses chunkSize from ChunkerOptions", () => {
		const chunker = new CodeWindowChunker();
		const chunks = chunker.chunk(makeDoc("x".repeat(1000)), { chunkSize: 200 });
		expect(chunks[0]?.content.length).toBe(200);
	});

	it("uses chunkOverlap from ChunkerOptions", () => {
		const chunker = new CodeWindowChunker();
		// chunkSize=500, overlap=100 → second chunk starts at 400
		const chunks = chunker.chunk(makeDoc("x".repeat(600)), { chunkSize: 500, chunkOverlap: 100 });
		expect(chunks.length).toBe(2);
		expect(chunks[1]?.content.length).toBe(200); // 400..600
	});

	it("byteOffsetStart of second chunk is correct on repetitive content", () => {
		// "x".repeat(600): chunk 1 = 0..500, chunk 2 = 400..600
		const chunker = new CodeWindowChunker();
		const chunks = chunker.chunk(makeDoc("x".repeat(600)), { chunkSize: 500, chunkOverlap: 100 });
		expect(chunks.length).toBe(2);
		expect(chunks[0]?.byteOffsetStart).toBe(0);
		expect(chunks[0]?.byteOffsetEnd).toBe(500);
		expect(chunks[1]?.byteOffsetStart).toBe(400); // not 500 (indexOf bug)
		expect(chunks[1]?.byteOffsetEnd).toBe(600);
	});
});

describe("CodeWindowChunker — manifest fast path", () => {
	it("manifest file gets a single chunk covering the full file", () => {
		const chunker = new CodeWindowChunker();
		const content = '{ "name": "test", "version": "1.0.0" }';
		const chunks = chunker.chunk({
			documentId: "doc-1",
			documentVersionId: "v1",
			content,
			sourceType: "code",
			source: "owner/repo/package.json",
			filePath: "package.json",
		});
		expect(chunks.length).toBe(1);
		expect(chunks[0]?.byteOffsetStart).toBe(0);
		expect(chunks[0]?.byteOffsetEnd).toBe(content.length);
		expect(chunks[0]?.lineStart).toBe(1);
		expect(chunks[0]?.lineEnd).toBe(1); // single line
	});

	it("manifest file does not apply sliding-window span (not 0..512)", () => {
		const chunker = new CodeWindowChunker();
		// Large enough that sliding window would produce 0..512 instead of full span
		const content =
			'{ "dependencies": ' +
			JSON.stringify(
				Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`pkg${i}`, "1.0.0"])),
			) +
			"}";
		const chunks = chunker.chunk({
			documentId: "doc-1",
			documentVersionId: "v1",
			content,
			sourceType: "code",
			source: "owner/repo/package.json",
			filePath: "package.json",
		});
		expect(chunks.length).toBe(1);
		expect(chunks[0]?.byteOffsetEnd).toBe(content.length); // full file, not 512
	});
});

describe("chunkCode — overlap clamping", () => {
	it("clamps chunkOverlap to chunkSize-1 to prevent infinite loop", () => {
		// Would hang forever without clamping
		const content = "x".repeat(200);
		const chunks = chunkCode(content, "file.ts", "repo", "http://x.com", {
			chunkSize: 100,
			chunkOverlap: 150, // >= chunkSize — must be clamped
		});
		expect(chunks.length).toBeGreaterThan(0);
		// With overlap clamped to 99, step = 1 char → many chunks but terminates
		// Just verify it doesn't hang and produces output
		expect(chunks[0]?.content.length).toBe(100);
	});
});
