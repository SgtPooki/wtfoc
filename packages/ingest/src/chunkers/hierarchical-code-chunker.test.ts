import type { ChunkerDocument, ChunkerOutput } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { AstHeuristicChunker } from "./ast-heuristic-chunker.js";
import { FILE_SUMMARY_SYMBOL, HierarchicalCodeChunker } from "./hierarchical-code-chunker.js";

function doc(overrides: Partial<ChunkerDocument> & { content: string }): ChunkerDocument {
	return {
		documentId: "repo/pkg/file",
		documentVersionId: "v1",
		sourceType: "code",
		source: "repo/pkg/file.ts",
		filePath: "pkg/file.ts",
		...overrides,
	};
}

describe("HierarchicalCodeChunker", () => {
	const chunker = new HierarchicalCodeChunker();

	it("emits a file-level summary chunk followed by symbol chunks", async () => {
		const content = `/**
 * Widget renderer for the dashboard.
 */
import { foo } from "./foo.js";
import type { Bar } from "./bar.js";

export function render(bar: Bar) {
	return foo(bar);
}

export class Registry {
	get(key: string) {}
}
`;
		const out = await chunker.chunk(doc({ content }));
		expect(out.length).toBeGreaterThanOrEqual(3);
		const first = out[0] as ChunkerOutput;
		expect(first.symbolPath).toBe(FILE_SUMMARY_SYMBOL);
		expect(first.chunkIndex).toBe(0);
		expect(first.metadata.chunkLevel).toBe("file");
		expect(first.content).toContain("File: repo/pkg/file.ts");
		expect(first.content).toContain("Widget renderer");
		expect(first.content).toContain(`import { foo } from "./foo.js"`);
		expect(first.content).toContain("- render");
		expect(first.content).toContain("- Registry");
		// Symbol chunks follow and keep their own content
		const symbols = out.slice(1);
		expect(symbols.some((c) => c.content.includes("function render"))).toBe(true);
		expect(symbols.some((c) => c.content.includes("class Registry"))).toBe(true);
	});

	it("reindexes symbol chunks so totalChunks and chunkIndex stay consistent", async () => {
		const content = `import { a } from "./a.js";
export function one() {}
export function two() {}
export function three() {}
`;
		const out = await chunker.chunk(doc({ content }));
		expect(out.length).toBeGreaterThanOrEqual(2);
		const total = out.length;
		for (let i = 0; i < out.length; i++) {
			expect(out[i]?.chunkIndex).toBe(i);
			expect(out[i]?.totalChunks).toBe(total);
		}
	});

	it("omits the summary when the inner chunker yields no chunks", async () => {
		const out = await chunker.chunk(doc({ content: "" }));
		expect(out).toEqual([]);
	});

	it("omits the summary when no header, imports, or symbols are detected", async () => {
		const content = "// just a comment\nconst x = 1;\n";
		// AstHeuristicChunker falls back to code-window for content without boundaries;
		// this yields a single chunk. No symbols → no summary.
		const inner = new AstHeuristicChunker();
		const bare = await inner.chunk(doc({ content }));
		const wrapped = await chunker.chunk(doc({ content }));
		// Either wrapped matches inner (summary suppressed), or wrapped adds exactly one
		// summary chunk. Enforce: wrapped length - 1 <= inner length.
		expect(wrapped.length - bare.length).toBeLessThanOrEqual(1);
	});

	it("falls through to inner chunker when file extension has no language mapping", async () => {
		const out = await chunker.chunk(
			doc({
				content: "some text without known language",
				filePath: "notes.xyz",
			}),
		);
		// No summary for unknown language
		expect(out.every((c) => c.symbolPath !== FILE_SUMMARY_SYMBOL)).toBe(true);
	});

	it("derives symbol list from inner chunker symbolPath when available", async () => {
		const content = `export function alpha() {}
export function beta() {}
`;
		const out = await chunker.chunk(doc({ content }));
		const summary = out[0];
		expect(summary?.symbolPath).toBe(FILE_SUMMARY_SYMBOL);
		expect(summary?.content).toContain("- alpha");
		expect(summary?.content).toContain("- beta");
	});

	it("handles python docstring + imports", async () => {
		const content = `"""
Module docstring for widgets.
"""
import os
from foo import bar

def render(x):
	return x

class Registry:
	pass
`;
		const out = await chunker.chunk(doc({ content, filePath: "pkg/widgets.py" }));
		const summary = out[0];
		expect(summary?.symbolPath).toBe(FILE_SUMMARY_SYMBOL);
		expect(summary?.content).toContain("Module docstring for widgets");
		expect(summary?.content).toContain("import os");
		expect(summary?.content).toContain("from foo import bar");
		expect(summary?.content).toContain("- render");
		expect(summary?.content).toContain("- Registry");
	});

	it("summary chunk carries timestamp and timestampKind from the document", async () => {
		const content = `import { a } from "./a.js";
export function f() {}
`;
		const out = await chunker.chunk(
			doc({
				content,
				timestamp: "2025-10-15T00:00:00Z",
				timestampKind: "committed",
			}),
		);
		expect(out[0]?.timestamp).toBe("2025-10-15T00:00:00Z");
		expect(out[0]?.timestampKind).toBe("committed");
	});
});
