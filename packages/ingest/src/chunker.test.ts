import { createHash } from "node:crypto";
import { WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, findMarkdownSplitEnd } from "./chunker.js";

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("chunkMarkdown", () => {
	it("returns no chunks for empty input", () => {
		expect(chunkMarkdown("", { source: "doc.md" })).toEqual([]);
	});

	it("assigns deterministic SHA-256 ids from exact chunk content", () => {
		const md = "# One\n\nHello world.\n\n## Two\n\nMore text.";
		const a = chunkMarkdown(md, { source: "doc.md", chunkSize: 10_000 });
		const b = chunkMarkdown(md, { source: "doc.md", chunkSize: 10_000 });
		expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
		for (const c of a) {
			expect(c.id).toBe(sha256(c.content));
		}
	});

	it("sets sourceType markdown and chunkIndex / totalChunks", () => {
		const md = "alpha\n\nbeta\n\ngamma";
		const chunks = chunkMarkdown(md, { source: "notes/a.md", chunkSize: 8 });
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks.every((c) => c.sourceType === "markdown")).toBe(true);
		expect(chunks.every((c) => c.source === "notes/a.md")).toBe(true);
		expect(chunks.every((c) => c.totalChunks === chunks.length)).toBe(true);
		chunks.forEach((c, i) => {
			expect(c.chunkIndex).toBe(i);
		});
	});

	it("respects chunkSize and chunkOverlap", () => {
		const md = "x".repeat(2000);
		const chunks = chunkMarkdown(md, {
			source: "s",
			chunkSize: 512,
			chunkOverlap: 50,
		});
		expect(chunks.length).toBeGreaterThan(1);
		for (let i = 0; i < chunks.length - 1; i++) {
			const chunk = chunks[i];
			expect(chunk).toBeDefined();
			expect(chunk?.content.length).toBeLessThanOrEqual(512);
		}
		// Overlap: suffix of chunk i is prefix of chunk i+1
		for (let i = 0; i < chunks.length - 1; i++) {
			const a = chunks[i]?.content;
			const b = chunks[i + 1]?.content;
			if (!a || !b) throw new Error(`Expected chunks at index ${i} and ${i + 1} to exist`);
			const suf = a.slice(-50);
			expect(b.startsWith(suf)).toBe(true);
		}
	});

	it("prefers splitting before a header over mid-paragraph when both fit the window", () => {
		const filler = "p".repeat(400);
		const md = `# First\n\n${filler}\n\n## Second\n\nshort`;
		const chunks = chunkMarkdown(md, { source: "doc", chunkSize: 420 });
		const joined = chunks.map((c) => c.content).join("");
		expect(joined).toBe(md);
		const splitAtSecondHeader = chunks.findIndex((c) => c.content.includes("## Second"));
		expect(splitAtSecondHeader).toBeGreaterThan(-1);
		expect(chunks.some((c) => c.content.startsWith("## Second"))).toBe(true);
		expect(chunks.some((c) => c.content.trimStart().startsWith("## Second"))).toBe(true);
	});

	it("merges optional metadata", () => {
		const chunks = chunkMarkdown("hello", {
			source: "x",
			metadata: { lang: "en" },
		});
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.metadata.lang).toBe("en");
	});

	it("does not produce overlap-only chunks when overlap meets a paragraph boundary", () => {
		const md = `${"a".repeat(400)}\n\n${"b".repeat(1000)}`;
		const chunks = chunkMarkdown(md, {
			source: "s",
			chunkSize: 420,
			chunkOverlap: 50,
		});
		// Every chunk must contain new content beyond just the overlap
		for (const chunk of chunks) {
			expect(chunk.content.length).toBeGreaterThan(50);
		}
		// All original content is covered
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("throws WtfocError with INVALID_CHUNK_SIZE when chunkSize is below 1", () => {
		let thrown: unknown;
		try {
			chunkMarkdown("a", { source: "s", chunkSize: 0 });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(WtfocError);
		expect((thrown as WtfocError).code).toBe("INVALID_CHUNK_SIZE");
	});

	it("throws WtfocError for non-finite or non-integer chunkSize", () => {
		for (const bad of [NaN, Infinity, -Infinity, 1.5]) {
			expect(() => chunkMarkdown("a", { source: "s", chunkSize: bad })).toThrow(WtfocError);
		}
	});

	it("throws WtfocError for non-finite or non-integer chunkOverlap", () => {
		for (const bad of [NaN, Infinity, -1, 0.5]) {
			expect(() => chunkMarkdown("a", { source: "s", chunkOverlap: bad })).toThrow(WtfocError);
		}
	});
});

describe("findMarkdownSplitEnd", () => {
	it("returns a header boundary before a hard cap when present", () => {
		const text = `${"a".repeat(100)}\n## H\n\n${"b".repeat(100)}`;
		const start = 0;
		const maxEnd = 120;
		const end = findMarkdownSplitEnd(text, start, maxEnd);
		expect(end).toBe(101);
		expect(text.slice(start, end)).not.toContain("#");
	});

	it("falls back to paragraph boundary when no header in range", () => {
		const text = "line one\n\nline two\n\nline three";
		const end = findMarkdownSplitEnd(text, 0, 25);
		expect(text.slice(0, end).endsWith("two")).toBe(true);
		expect(text[end]).toBe("\n");
	});

	it("falls back to sentence boundary when no paragraph or header in range", () => {
		const text = "First sentence. Second sentence. Third sentence.";
		const end = findMarkdownSplitEnd(text, 0, 22);
		expect(text.slice(0, end)).toBe("First sentence.");
		expect(text[end]).toBe(" ");
	});
});
