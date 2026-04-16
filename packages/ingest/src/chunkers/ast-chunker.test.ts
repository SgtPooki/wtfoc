import { describe, expect, it, vi } from "vitest";
import type { TreeSitterParseResponse, TreeSitterSymbol } from "../edges/tree-sitter-client.js";

const mockParse = vi.hoisted(() =>
	vi.fn<
		(req: unknown, opts: unknown, signal?: AbortSignal) => Promise<TreeSitterParseResponse | null>
	>(),
);

vi.mock("../edges/tree-sitter-client.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../edges/tree-sitter-client.js")>();
	return { ...actual, treeSitterParse: mockParse };
});

const { AstChunker } = await import("./ast-chunker.js");
const { AstHeuristicChunker } = await import("./ast-heuristic-chunker.js");

function sym(o: Partial<TreeSitterSymbol> & { name: string }): TreeSitterSymbol {
	return {
		kind: "function",
		nodeType: "function_declaration",
		byteStart: 0,
		byteEnd: 0,
		lineStart: 1,
		lineEnd: 1,
		parentIndex: -1,
		...o,
	};
}

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

describe("AstChunker", () => {
	const sidecarUrl = "http://sidecar.example";

	describe("sidecar integration", () => {
		it("emits one chunk per leaf symbol", async () => {
			const src = [
				"import foo from 'bar';",
				"",
				"export function greet(name: string): string {",
				'  return "hi " + name;',
				"}",
				"",
				"export class User {",
				"  greet(): void {}",
				"}",
			].join("\n");

			// Symbol offsets into `src` (computed manually from the source above)
			const greetFnStart = src.indexOf("export function greet");
			const greetFnEnd = src.indexOf("}\n\nexport class") + 1;
			const userClassStart = src.indexOf("export class User");
			const userClassEnd = src.length;
			const userMethodStart = src.indexOf("  greet(): void");
			const userMethodEnd = userMethodStart + "  greet(): void {}".length;

			const symbols: TreeSitterSymbol[] = [
				sym({
					name: "greet",
					kind: "function",
					byteStart: greetFnStart,
					byteEnd: greetFnEnd,
					lineStart: 3,
					lineEnd: 5,
				}),
				sym({
					name: "User",
					kind: "class",
					nodeType: "class_declaration",
					byteStart: userClassStart,
					byteEnd: userClassEnd,
					lineStart: 7,
					lineEnd: 9,
				}),
				sym({
					name: "greet",
					kind: "method",
					nodeType: "method_definition",
					byteStart: userMethodStart,
					byteEnd: userMethodEnd,
					lineStart: 8,
					lineEnd: 8,
					parentIndex: 1, // inside User class
				}),
			];
			mockParse.mockResolvedValue({ edges: [], symbols, language: "typescript", nodeCount: 42 });

			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));

			// preamble (imports) + greet function + User.greet method
			// (User class itself is NOT a leaf because it has a method child)
			expect(chunks).toHaveLength(3);
			expect(chunks[0]?.symbolPath).toBe("preamble");
			expect(chunks[0]?.content).toContain("import foo from 'bar'");
			expect(chunks[1]?.symbolPath).toBe("greet");
			expect(chunks[1]?.content).toContain("export function greet");
			expect(chunks[2]?.symbolPath).toBe("User.greet");
			expect(chunks[2]?.content).toContain("greet(): void {}");
			// chunk totalChunks back-filled
			for (const c of chunks) expect(c.totalChunks).toBe(3);
		});

		it("falls back to heuristic when the sidecar returns null (unreachable)", async () => {
			mockParse.mockResolvedValue(null);
			const src = "export function a() {}\nexport function b() {}\n";
			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));

			const heuristicExpected = await new AstHeuristicChunker().chunk(makeDoc(src));
			// Same chunker output shape as heuristic (fallback parity)
			expect(chunks.length).toBe(heuristicExpected.length);
			expect(chunks[0]?.chunkerName).toBe("ast-heuristic");
		});

		it("falls back to heuristic when the sidecar returns zero symbols", async () => {
			mockParse.mockResolvedValue({
				edges: [],
				symbols: [],
				language: "typescript",
				nodeCount: 5,
			});
			const src = "export function foo() { return 1 }\n";
			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));
			expect(chunks[0]?.chunkerName).toBe("ast-heuristic");
		});

		it("falls back to heuristic when the sidecar omits symbols (older API)", async () => {
			// Pre-#220 sidecars don't include the symbols field. Should be treated
			// as no symbols — NOT as a hard failure.
			mockParse.mockResolvedValue({
				edges: [],
				language: "typescript",
				nodeCount: 5,
			} as TreeSitterParseResponse);
			const src = "export function foo() { return 1 }\n";
			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));
			expect(chunks[0]?.chunkerName).toBe("ast-heuristic");
		});

		it("falls back to heuristic for unsupported file extensions (skips sidecar call)", async () => {
			mockParse.mockClear();
			const src = "some data\n";
			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src, "src/data.unknown"));
			// Heuristic chunker delegates to code-window for unknown ext
			expect(chunks.length).toBeGreaterThan(0);
			expect(mockParse).not.toHaveBeenCalled();
		});
	});

	describe("span provenance", () => {
		it("byteOffsets describe the EXACT trimmed chunk content (codex review)", async () => {
			// The sidecar's byteStart/byteEnd often surround a symbol with
			// leading/trailing whitespace (e.g. trailing blank line before next
			// symbol). AstChunker must adjust offsets so the slice matches the
			// emitted chunk content byte-for-byte, not just as a superset.
			const src = `\n\n  function foo() {\n    return 1;\n  }\n\n\nfunction bar() { return 2; }\n`;
			const fooRaw = "\n\n  function foo() {\n    return 1;\n  }\n\n\n";
			const fooStart = 0;
			const fooEnd = fooStart + fooRaw.length;
			const barStart = src.indexOf("function bar");
			const barEnd = src.length;
			const symbols: TreeSitterSymbol[] = [
				sym({
					name: "foo",
					byteStart: fooStart,
					byteEnd: fooEnd,
					lineStart: 3,
					lineEnd: 5,
				}),
				sym({
					name: "bar",
					byteStart: barStart,
					byteEnd: barEnd,
					lineStart: 8,
					lineEnd: 8,
				}),
			];
			mockParse.mockResolvedValue({ edges: [], symbols, language: "typescript", nodeCount: 20 });

			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));

			for (const chunk of chunks) {
				if (chunk.byteOffsetStart == null || chunk.byteOffsetEnd == null) continue;
				const described = src.slice(chunk.byteOffsetStart - 1, chunk.byteOffsetEnd);
				expect(described).toBe(chunk.content);
			}
		});

		it("byteOffsets describe a region of the source that contains the chunk content", async () => {
			const src = [
				"import foo from 'bar';",
				"",
				"export function alpha() {",
				"  return 1;",
				"}",
				"",
				"export function beta() {",
				"  return 2;",
				"}",
			].join("\n");

			const alphaStart = src.indexOf("export function alpha");
			const alphaEnd = src.indexOf("}\n\nexport function beta") + 1;
			const betaStart = src.indexOf("export function beta");
			const betaEnd = src.length;
			const symbols: TreeSitterSymbol[] = [
				sym({
					name: "alpha",
					byteStart: alphaStart,
					byteEnd: alphaEnd,
					lineStart: 3,
					lineEnd: 5,
				}),
				sym({
					name: "beta",
					byteStart: betaStart,
					byteEnd: betaEnd,
					lineStart: 7,
					lineEnd: 9,
				}),
			];
			mockParse.mockResolvedValue({ edges: [], symbols, language: "typescript", nodeCount: 30 });

			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src));

			for (const chunk of chunks) {
				if (chunk.byteOffsetStart == null || chunk.byteOffsetEnd == null) continue;
				const described = src.slice(chunk.byteOffsetStart - 1, chunk.byteOffsetEnd);
				expect(described.trim()).toContain(chunk.content.trim());
			}
		});
	});

	describe("large symbols", () => {
		it("window-splits oversized symbols while preserving symbolPath", async () => {
			const bigBody = "// long line\n".repeat(500); // ~6000 chars
			const src = `export function huge() {\n${bigBody}}\n`;
			const symbols: TreeSitterSymbol[] = [
				sym({
					name: "huge",
					byteStart: 0,
					byteEnd: src.length - 1,
					lineStart: 1,
					lineEnd: 503,
				}),
			];
			mockParse.mockResolvedValue({ edges: [], symbols, language: "typescript", nodeCount: 10 });

			const chunker = new AstChunker({ sidecarUrl });
			const chunks = await chunker.chunk(makeDoc(src), { maxChunkChars: 1500 });
			expect(chunks.length).toBeGreaterThan(1);
			// First piece keeps the exact symbol name; subsequent pieces tag with #N
			expect(chunks[0]?.symbolPath).toBe("huge");
			expect(chunks[1]?.symbolPath).toBe("huge#2");
		});
	});
});
