import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { CodeEdgeExtractor } from "./code.js";

function makeCodeChunk(
	content: string,
	source: string,
	id = "chunk-1",
	chunkIndex = 0,
	totalChunks = 1,
): Chunk {
	return { id, content, sourceType: "code", source, chunkIndex, totalChunks, metadata: {} };
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

	describe("multi-chunk manifest reconstruction", () => {
		it("reconstructs split package.json and extracts deps", async () => {
			const fullJson = JSON.stringify({
				name: "test-pkg",
				dependencies: { express: "^4.0.0", lodash: "^4.17.0" },
				devDependencies: { vitest: "^1.0.0" },
			});
			const mid1 = Math.floor(fullJson.length / 3);
			const mid2 = Math.floor((fullJson.length * 2) / 3);

			const chunks: Chunk[] = [
				makeCodeChunk(fullJson.slice(0, mid1), "repo/package.json", "chunk-0", 0, 3),
				makeCodeChunk(fullJson.slice(mid1, mid2), "repo/package.json", "chunk-1", 1, 3),
				makeCodeChunk(fullJson.slice(mid2), "repo/package.json", "chunk-2", 2, 3),
			];

			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(3);
			expect(edges.map((e) => e.targetId).sort()).toEqual(["express", "lodash", "vitest"]);
		});

		it("reconstructs split requirements.txt", async () => {
			const reqs = "flask==2.0.0\nrequests>=2.28\nnumpy~=1.24\npandas>=1.5";
			const mid = Math.floor(reqs.length / 2);

			const chunks: Chunk[] = [
				makeCodeChunk(reqs.slice(0, mid), "repo/requirements.txt", "chunk-0", 0, 2),
				makeCodeChunk(reqs.slice(mid), "repo/requirements.txt", "chunk-1", 1, 2),
			];

			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(4);
		});

		it("reconstructs split go.mod", async () => {
			const gomod =
				"module github.com/user/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.14.0\n)";
			const mid = Math.floor(gomod.length / 2);

			const chunks: Chunk[] = [
				makeCodeChunk(gomod.slice(0, mid), "repo/go.mod", "chunk-0", 0, 2),
				makeCodeChunk(gomod.slice(mid), "repo/go.mod", "chunk-1", 1, 2),
			];

			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetId).sort()).toEqual([
				"github.com/gin-gonic/gin",
				"golang.org/x/text",
			]);
		});

		it("handles out-of-order chunks", async () => {
			const fullJson = JSON.stringify({
				dependencies: { express: "^4.0.0", lodash: "^4.17.0" },
			});
			const mid = Math.floor(fullJson.length / 2);

			// Deliver chunk-1 before chunk-0
			const chunks: Chunk[] = [
				makeCodeChunk(fullJson.slice(mid), "repo/package.json", "chunk-1", 1, 2),
				makeCodeChunk(fullJson.slice(0, mid), "repo/package.json", "chunk-0", 0, 2),
			];

			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(2);
		});

		it("reconstructs overlapped chunks (50-char overlap like real chunker)", async () => {
			const fullJson = JSON.stringify({
				name: "test-overlapped-pkg",
				dependencies: Object.fromEntries(
					Array.from({ length: 30 }, (_, i) => [`dependency-package-${i}`, `^${i}.0.0`]),
				),
			});
			// Simulate the real chunker: 512-byte chunks with 50-byte overlap
			const chunkSize = 512;
			const overlap = 50;
			const chunks: Chunk[] = [];
			let offset = 0;
			let idx = 0;
			while (offset < fullJson.length) {
				const end = Math.min(offset + chunkSize, fullJson.length);
				chunks.push(
					makeCodeChunk(fullJson.slice(offset, end), "repo/package.json", `chunk-${idx}`, idx, 0),
				);
				idx++;
				offset = end - overlap;
				if (end === fullJson.length) break;
			}
			for (const c of chunks) c.totalChunks = chunks.length;

			expect(chunks.length).toBeGreaterThan(1);
			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(30);
			expect(edges[0]?.targetId).toBe("dependency-package-0");
		});

		it("groups manifest chunks by source path", async () => {
			const pkg1 = JSON.stringify({ dependencies: { express: "^4.0.0" } });
			const pkg2 = JSON.stringify({ dependencies: { lodash: "^4.17.0" } });

			const chunks: Chunk[] = [
				makeCodeChunk(pkg1, "app/package.json", "chunk-a"),
				makeCodeChunk(pkg2, "lib/package.json", "chunk-b"),
			];

			const edges = await extractor.extract(chunks);
			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetId).sort()).toEqual(["express", "lodash"]);
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
