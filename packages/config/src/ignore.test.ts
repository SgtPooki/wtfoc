import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIgnoreFilter, loadWtfocIgnore } from "./ignore.js";

describe("createIgnoreFilter", () => {
	it("applies built-in defaults when no pattern sources provided", () => {
		const filter = createIgnoreFilter();
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("node_modules/foo/bar.js")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("excludes expanded built-in defaults (dist, lock, min, map)", () => {
		const filter = createIgnoreFilter();
		expect(filter("dist/bundle.js")).toBe(false);
		expect(filter("build/output.js")).toBe(false);
		expect(filter("out/main.js")).toBe(false);
		expect(filter("coverage/lcov.info")).toBe(false);
		expect(filter(".next/cache")).toBe(false);
		expect(filter(".turbo/cache")).toBe(false);
		expect(filter("__pycache__/module.pyc")).toBe(false);
		expect(filter("package-lock.json")).toBe(false);
		expect(filter("yarn.lock")).toBe(false);
		expect(filter("pnpm-lock.yaml")).toBe(false);
		expect(filter("foo.min.js")).toBe(false);
		expect(filter("styles.min.css")).toBe(false);
		expect(filter("app.js.map")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("excludes test files and fixture directories by default", () => {
		const filter = createIgnoreFilter();
		expect(filter("src/utils.test.ts")).toBe(false);
		expect(filter("src/utils.spec.ts")).toBe(false);
		expect(filter("src/Button.stories.tsx")).toBe(false);
		expect(filter("__tests__/helper.ts")).toBe(false);
		expect(filter("__fixtures__/data.json")).toBe(false);
		expect(filter("__mocks__/api.ts")).toBe(false);
		expect(filter("test/setup.ts")).toBe(false);
		expect(filter("tests/integration.ts")).toBe(false);
		expect(filter("fixtures/sample.json")).toBe(false);
		expect(filter("spec/helper.ts")).toBe(false);
		// Source files are still included
		expect(filter("src/utils.ts")).toBe(true);
		expect(filter("src/components/Button.tsx")).toBe(true);
	});

	it("allows negation to override built-in test file exclusions", () => {
		// Re-include specific test file patterns
		const filter = createIgnoreFilter(["!*.test.ts"]);
		expect(filter("src/utils.test.ts")).toBe(true);
		// Other test patterns still excluded
		expect(filter("src/utils.spec.ts")).toBe(false);
		expect(filter("__fixtures__/data.json")).toBe(false);
	});

	it("merges single pattern source additively with defaults", () => {
		const filter = createIgnoreFilter(["*.log"]);
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("dist/bundle.js")).toBe(false);
		expect(filter("error.log")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("merges multiple pattern sources additively", () => {
		const filter = createIgnoreFilter(["*.log"], ["*.tmp"], ["secrets/"]);
		expect(filter("error.log")).toBe(false);
		expect(filter("temp.tmp")).toBe(false);
		expect(filter("secrets/key.pem")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("skips undefined pattern sources", () => {
		const filter = createIgnoreFilter(undefined, ["*.log"], undefined);
		expect(filter("error.log")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("supports gitignore negation patterns", () => {
		const filter = createIgnoreFilter(["*.log", "!important.log"]);
		expect(filter("error.log")).toBe(false);
		expect(filter("important.log")).toBe(true);
	});

	it("supports negation in later sources overriding earlier sources", () => {
		const filter = createIgnoreFilter(["*.json"], ["!package.json"]);
		expect(filter("tsconfig.json")).toBe(false);
		expect(filter("package.json")).toBe(true);
	});

	it("supports directory patterns with trailing /", () => {
		const filter = createIgnoreFilter(["vendor/"]);
		expect(filter("vendor/lib.js")).toBe(false);
		expect(filter("src/vendor.ts")).toBe(true);
	});

	it("normalizes backslash paths for cross-platform compatibility", () => {
		const filter = createIgnoreFilter(["docs/"]);
		expect(filter("docs\\readme.md")).toBe(false);
		expect(filter(".\\node_modules\\foo")).toBe(false);
	});

	it("strips leading ./ from paths", () => {
		const filter = createIgnoreFilter();
		expect(filter("./dist/bundle.js")).toBe(false);
		expect(filter("./src/main.ts")).toBe(true);
	});

	it("applies built-in defaults even with empty pattern arrays", () => {
		const filter = createIgnoreFilter([], []);
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("dist/bundle.js")).toBe(false);
		expect(filter("src/main.ts")).toBe(true);
	});
});

describe("loadWtfocIgnore", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "wtfocignore-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty array when .wtfocignore does not exist", () => {
		const patterns = loadWtfocIgnore(tempDir);
		expect(patterns).toEqual([]);
	});

	it("returns patterns from .wtfocignore file", () => {
		writeFileSync(join(tempDir, ".wtfocignore"), "*.log\ndocs/\nsecrets/\n");
		const patterns = loadWtfocIgnore(tempDir);
		expect(patterns).toEqual(["*.log", "docs/", "secrets/"]);
	});

	it("strips comment lines and blank lines", () => {
		writeFileSync(
			join(tempDir, ".wtfocignore"),
			"# This is a comment\n*.log\n\n# Another comment\ndocs/\n\n",
		);
		const patterns = loadWtfocIgnore(tempDir);
		expect(patterns).toEqual(["*.log", "docs/"]);
	});

	it("returns empty array when file contains only comments", () => {
		writeFileSync(join(tempDir, ".wtfocignore"), "# Just comments\n# Nothing else\n");
		const patterns = loadWtfocIgnore(tempDir);
		expect(patterns).toEqual([]);
	});

	it("preserves negation patterns", () => {
		writeFileSync(join(tempDir, ".wtfocignore"), "*.json\n!package.json\n");
		const patterns = loadWtfocIgnore(tempDir);
		expect(patterns).toEqual(["*.json", "!package.json"]);
	});
});
