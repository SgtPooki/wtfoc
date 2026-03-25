import { describe, expect, it } from "vitest";
import { createIgnoreFilter } from "./ignore.js";

describe("createIgnoreFilter", () => {
	it("applies built-in defaults (.git, node_modules) when no user patterns", () => {
		const filter = createIgnoreFilter();
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("node_modules/foo/bar.js")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("merges user patterns additively with defaults", () => {
		const filter = createIgnoreFilter(["dist/**", "*.log"]);
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("dist/bundle.js")).toBe(false);
		expect(filter("error.log")).toBe(false);
		expect(filter("src/index.ts")).toBe(true);
	});

	it("supports gitignore negation patterns", () => {
		const filter = createIgnoreFilter(["*.log", "!important.log"]);
		expect(filter("error.log")).toBe(false);
		expect(filter("important.log")).toBe(true);
	});

	it("supports directory patterns with trailing /", () => {
		const filter = createIgnoreFilter(["build/"]);
		expect(filter("build/output.js")).toBe(false);
		expect(filter("src/build.ts")).toBe(true);
	});

	it("normalizes backslash paths for cross-platform compatibility", () => {
		const filter = createIgnoreFilter(["dist/**"]);
		expect(filter("dist\\bundle.js")).toBe(false);
		expect(filter(".\\node_modules\\foo")).toBe(false);
	});

	it("strips leading ./ from paths", () => {
		const filter = createIgnoreFilter(["dist/**"]);
		expect(filter("./dist/bundle.js")).toBe(false);
		expect(filter("./src/main.ts")).toBe(true);
	});

	it("applies built-in defaults even with empty user patterns array", () => {
		const filter = createIgnoreFilter([]);
		expect(filter(".git")).toBe(false);
		expect(filter("node_modules")).toBe(false);
		expect(filter("src/main.ts")).toBe(true);
	});
});
