import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { CodeEdgeExtractor } from "./code.js";

function makeCodeChunk(content: string, source: string, id = "chunk-1"): Chunk {
	return { id, content, sourceType: "code", source, chunkIndex: 0, totalChunks: 1, metadata: {} };
}

describe("CodeEdgeExtractor", () => {
	const extractor = new CodeEdgeExtractor();

	describe("TypeScript/JavaScript (oxc-parser with regex fallback)", () => {
		it("extracts ES import statement", async () => {
			const chunk = makeCodeChunk('import { foo } from "./bar";', "src/main.ts");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "imports",
				sourceId: "chunk-1",
				targetType: "module",
				targetId: "./bar",
			});
			// oxc-parser gives 1.0, regex fallback gives 0.95
			expect(edges[0]?.confidence).toBeGreaterThanOrEqual(0.95);
		});

		it("extracts multiple imports and deduplicates", async () => {
			const chunk = makeCodeChunk(
				'import express from "express";\nimport { Router } from "express";',
				"src/app.ts",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("express");
		});

		it("extracts require() calls", async () => {
			const chunk = makeCodeChunk('const fs = require("fs");', "src/util.js");
			const edges = await extractor.extract([chunk]);
			expect(edges.length).toBeGreaterThanOrEqual(1);
			// oxc may not see require as ImportDeclaration — regex fallback catches it
			const fsEdge = edges.find((e) => e.targetId === "fs");
			expect(fsEdge).toBeTruthy();
		});

		it("extracts dynamic imports", async () => {
			const chunk = makeCodeChunk('const mod = await import("./lazy");', "src/app.ts");
			const edges = await extractor.extract([chunk]);
			expect(edges.length).toBeGreaterThanOrEqual(1);
		});

		it("extracts re-exports", async () => {
			const chunk = makeCodeChunk('export { foo } from "./bar";', "src/index.ts");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("./bar");
		});

		it("handles scoped npm packages", async () => {
			const chunk = makeCodeChunk('import { Chunk } from "@wtfoc/common";', "src/main.ts");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("@wtfoc/common");
		});
	});

	describe("Python imports", () => {
		it("extracts import statement", async () => {
			const chunk = makeCodeChunk("import os", "src/main.py");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "imports",
				targetType: "module",
				targetId: "os",
				confidence: 0.95,
			});
		});

		it("extracts from-import statement", async () => {
			const chunk = makeCodeChunk("from pathlib import Path", "src/util.py");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("pathlib");
		});

		it("extracts dotted module imports", async () => {
			const chunk = makeCodeChunk("from os.path import join", "src/files.py");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("os.path");
		});
	});

	describe("Go imports", () => {
		it("extracts single import", async () => {
			const chunk = makeCodeChunk('import "fmt"', "main.go");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "imports",
				targetId: "fmt",
				confidence: 0.95,
			});
		});

		it("extracts block imports", async () => {
			const chunk = makeCodeChunk(
				'import (\n\t"fmt"\n\t"os"\n\t"github.com/user/repo"\n)',
				"main.go",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(3);
			expect(edges.map((e) => e.targetId)).toEqual(["fmt", "os", "github.com/user/repo"]);
		});
	});

	describe("Solidity imports", () => {
		it("extracts import statement", async () => {
			const chunk = makeCodeChunk('import "./IERC20.sol";', "contracts/Token.sol");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("./IERC20.sol");
		});

		it("extracts named import", async () => {
			const chunk = makeCodeChunk(
				'import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";',
				"contracts/Token.sol",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("@openzeppelin/contracts/token/ERC20/IERC20.sol");
		});
	});

	describe("Rust imports", () => {
		it("extracts use statement", async () => {
			const chunk = makeCodeChunk("use std::collections::HashMap;", "src/main.rs");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("std::collections::HashMap");
		});

		it("extracts crate use", async () => {
			const chunk = makeCodeChunk("use crate::config::Settings;", "src/app.rs");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]?.targetId).toBe("crate::config::Settings");
		});
	});

	describe("dependency manifests", () => {
		it("extracts package.json dependencies", async () => {
			const chunk = makeCodeChunk(
				JSON.stringify({ dependencies: { express: "^4.0.0" } }),
				"package.json",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toMatchObject({
				type: "depends-on",
				targetType: "package",
				targetId: "express",
				confidence: 1.0,
			});
		});

		it("extracts requirements.txt dependencies", async () => {
			const chunk = makeCodeChunk("flask==2.0.0\nrequests>=2.28", "requirements.txt");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(2);
		});

		it("extracts go.mod dependencies", async () => {
			const chunk = makeCodeChunk(
				"module github.com/user/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.14.0\n)",
				"go.mod",
			);
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(2);
			expect(edges[0]).toMatchObject({
				type: "depends-on",
				targetType: "package",
				targetId: "github.com/gin-gonic/gin",
				confidence: 1.0,
			});
		});
	});

	describe("unsupported content", () => {
		it("skips unsupported file extensions", async () => {
			const chunk = makeCodeChunk("class Foo {}", "src/Main.java");
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(0);
		});

		it("skips non-code source types", async () => {
			const chunk: Chunk = {
				id: "chunk-1",
				content: 'import { foo } from "./bar";',
				sourceType: "slack-message",
				source: "#general",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			};
			const edges = await extractor.extract([chunk]);
			expect(edges).toHaveLength(0);
		});
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();
		const chunk = makeCodeChunk('import foo from "bar";', "src/main.ts");
		await expect(extractor.extract([chunk], controller.signal)).rejects.toThrow();
	});
});
