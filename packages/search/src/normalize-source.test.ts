import { describe, expect, it } from "vitest";
import { normalizeRepoSource } from "./normalize-source.js";

describe("normalizeRepoSource", () => {
	it("strips https://github.com/ prefix", () => {
		expect(normalizeRepoSource("https://github.com/SgtPooki/wtfoc")).toBe("sgtpooki/wtfoc");
	});

	it("strips github.com/ prefix", () => {
		expect(normalizeRepoSource("github.com/SgtPooki/wtfoc")).toBe("sgtpooki/wtfoc");
	});

	it("strips https://github.com/ prefix with trailing .git", () => {
		expect(normalizeRepoSource("https://github.com/SgtPooki/wtfoc.git")).toBe("sgtpooki/wtfoc");
	});

	it("strips http://github.com/ prefix", () => {
		expect(normalizeRepoSource("http://github.com/SgtPooki/wtfoc")).toBe("sgtpooki/wtfoc");
	});

	it("lowercases owner/repo without prefix", () => {
		expect(normalizeRepoSource("SgtPooki/wtfoc")).toBe("sgtpooki/wtfoc");
	});

	it("preserves issue/PR suffix", () => {
		expect(normalizeRepoSource("github.com/Org/repo#42")).toBe("org/repo#42");
	});

	it("preserves path suffix after repo", () => {
		expect(normalizeRepoSource("https://github.com/Org/repo/blob/main/file.ts")).toBe(
			"org/repo/blob/main/file.ts",
		);
	});

	it("passes through non-repo strings (lowercased)", () => {
		expect(normalizeRepoSource("src/index.ts")).toBe("src/index.ts");
	});

	it("passes through bare file paths", () => {
		expect(normalizeRepoSource("#general")).toBe("#general");
	});

	it("handles empty string", () => {
		expect(normalizeRepoSource("")).toBe("");
	});

	it("does not strip .git without GitHub URL prefix (ambiguous with file paths)", () => {
		expect(normalizeRepoSource("SgtPooki/wtfoc.git")).toBe("sgtpooki/wtfoc.git");
	});

	it("handles full GitHub issue URL", () => {
		expect(normalizeRepoSource("https://github.com/SgtPooki/wtfoc/issues/42")).toBe(
			"sgtpooki/wtfoc/issues/42",
		);
	});

	it("does not strip .git from file paths", () => {
		expect(normalizeRepoSource("scripts/deploy.git")).toBe("scripts/deploy.git");
	});

	it("does not strip .git from bare filenames", () => {
		expect(normalizeRepoSource("config.git")).toBe("config.git");
	});

	it("strips leading ./ from relative paths", () => {
		expect(normalizeRepoSource("./packages/ingest/src/index.ts")).toBe(
			"packages/ingest/src/index.ts",
		);
	});

	it("strips leading ./ from simple relative paths", () => {
		expect(normalizeRepoSource("./src/foo.ts")).toBe("src/foo.ts");
	});
});
