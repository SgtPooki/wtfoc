import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { extractPackageJsonDeps, extractRequirementsTxtDeps } from "./dependency-parser.js";

function makeChunk(content: string, source: string, id = "chunk-1"): Chunk {
	return { id, content, sourceType: "code", source, chunkIndex: 0, totalChunks: 1, metadata: {} };
}

describe("extractPackageJsonDeps", () => {
	it("extracts dependencies", () => {
		const chunk = makeChunk(
			JSON.stringify({ dependencies: { express: "^4.18.0", lodash: "^4.17.0" } }),
			"package.json",
		);
		const edges = extractPackageJsonDeps(chunk);
		expect(edges).toHaveLength(2);
		expect(edges[0]).toMatchObject({
			type: "depends-on",
			targetType: "package",
			targetId: "express",
			confidence: 1.0,
		});
	});

	it("extracts devDependencies and peerDependencies", () => {
		const chunk = makeChunk(
			JSON.stringify({
				devDependencies: { vitest: "^1.0.0" },
				peerDependencies: { react: "^18.0.0" },
			}),
			"package.json",
		);
		const edges = extractPackageJsonDeps(chunk);
		expect(edges).toHaveLength(2);
		expect(edges.map((e) => e.targetId)).toEqual(["vitest", "react"]);
	});

	it("returns empty array for invalid JSON", () => {
		const chunk = makeChunk("not json", "package.json");
		expect(extractPackageJsonDeps(chunk)).toEqual([]);
	});

	it("returns empty array for package.json with no deps", () => {
		const chunk = makeChunk(JSON.stringify({ name: "my-pkg", version: "1.0.0" }), "package.json");
		expect(extractPackageJsonDeps(chunk)).toEqual([]);
	});

	it("includes dependency field in evidence", () => {
		const chunk = makeChunk(JSON.stringify({ dependencies: { foo: "1.0.0" } }), "package.json");
		const edges = extractPackageJsonDeps(chunk);
		expect(edges[0]?.evidence).toBe("dependencies: foo");
	});
});

describe("extractRequirementsTxtDeps", () => {
	it("extracts simple package names", () => {
		const chunk = makeChunk("flask\nrequests\nnumpy", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(3);
		expect(edges.map((e) => e.targetId)).toEqual(["flask", "requests", "numpy"]);
	});

	it("extracts packages with version specifiers", () => {
		const chunk = makeChunk("flask==2.0.0\nrequests>=2.28.0\nnumpy~=1.24", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(3);
		expect(edges[0]?.targetId).toBe("flask");
	});

	it("skips comments and empty lines", () => {
		const chunk = makeChunk("# This is a comment\n\nflask\n# Another comment", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
	});

	it("skips -r include directives", () => {
		const chunk = makeChunk("-r base.txt\nflask", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
		expect(edges[0]?.targetId).toBe("flask");
	});

	it("deduplicates same package", () => {
		const chunk = makeChunk("flask\nflask==2.0.0", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
	});

	it("includes full line as evidence", () => {
		const chunk = makeChunk("flask>=2.0.0", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges[0]?.evidence).toBe("flask>=2.0.0");
	});
});
