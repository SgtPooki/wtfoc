/**
 * Ownership: Dependency manifest parser unit tests.
 * Tests: extractPackageJsonDeps and extractRequirementsTxtDeps — all parsing edge cases.
 * Delegates to: code.test.ts for CodeEdgeExtractor routing/delegation to these parsers.
 */
import { describe, expect, it } from "vitest";
import { makeCodeChunk } from "./__test-helpers.js";
import { extractPackageJsonDeps, extractRequirementsTxtDeps } from "./dependency-parser.js";

describe("extractPackageJsonDeps", () => {
	it("extracts dependencies", () => {
		const chunk = makeCodeChunk(
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
		const chunk = makeCodeChunk(
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
		const chunk = makeCodeChunk("not json", "package.json");
		expect(extractPackageJsonDeps(chunk)).toEqual([]);
	});

	it("returns empty array for package.json with no deps", () => {
		const chunk = makeCodeChunk(
			JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
			"package.json",
		);
		expect(extractPackageJsonDeps(chunk)).toEqual([]);
	});

	it("includes dependency field in evidence", () => {
		const chunk = makeCodeChunk(JSON.stringify({ dependencies: { foo: "1.0.0" } }), "package.json");
		const edges = extractPackageJsonDeps(chunk);
		expect(edges[0]?.evidence).toBe("dependencies: foo");
	});
});

describe("extractRequirementsTxtDeps", () => {
	it("extracts simple package names", () => {
		const chunk = makeCodeChunk("flask\nrequests\nnumpy", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(3);
		expect(edges.map((e) => e.targetId)).toEqual(["flask", "requests", "numpy"]);
	});

	it("extracts packages with version specifiers", () => {
		const chunk = makeCodeChunk("flask==2.0.0\nrequests>=2.28.0\nnumpy~=1.24", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(3);
		expect(edges[0]?.targetId).toBe("flask");
	});

	it("skips comments and empty lines", () => {
		const chunk = makeCodeChunk(
			"# This is a comment\n\nflask\n# Another comment",
			"requirements.txt",
		);
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
	});

	it("skips -r include directives", () => {
		const chunk = makeCodeChunk("-r base.txt\nflask", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
		expect(edges[0]?.targetId).toBe("flask");
	});

	it("deduplicates same package", () => {
		const chunk = makeCodeChunk("flask\nflask==2.0.0", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges).toHaveLength(1);
	});

	it("includes full line as evidence", () => {
		const chunk = makeCodeChunk("flask>=2.0.0", "requirements.txt");
		const edges = extractRequirementsTxtDeps(chunk);
		expect(edges[0]?.evidence).toBe("flask>=2.0.0");
	});
});
