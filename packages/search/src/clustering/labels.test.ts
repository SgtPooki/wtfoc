import { describe, expect, it } from "vitest";
import { extractLabel, extractLabelFromCandidates, isCodeHeavy } from "./labels.js";

describe("extractLabel", () => {
	it("extracts meaningful words from plain text", () => {
		const label = extractLabel(
			"The upload handler failed because the storage backend was unreachable",
		);
		// Should filter stop words and take 5-7 meaningful words
		expect(label.split(" ").length).toBeGreaterThanOrEqual(5);
		expect(label.split(" ").length).toBeLessThanOrEqual(7);
		expect(label).not.toContain("the");
		expect(label).not.toContain("was");
	});

	it("strips markdown formatting", () => {
		const label = extractLabel("## **Important** feature request for `upload` handling");
		expect(label).not.toContain("#");
		expect(label).not.toContain("*");
		expect(label).not.toContain("`");
	});

	it("strips URLs", () => {
		const label = extractLabel(
			"Check https://example.com/foo for upload documentation details here",
		);
		expect(label).not.toContain("https");
		expect(label).not.toContain("example.com");
	});

	it("returns fallback for very short content", () => {
		const label = extractLabel("ok");
		expect(label.length).toBeGreaterThan(0);
	});

	it("returns default for empty content", () => {
		const label = extractLabel("");
		expect(label).toBe("unlabelled cluster");
	});

	it("handles code fence content", () => {
		const label = extractLabel(
			"Error in ```const x = 1;\nconsole.log(x);``` deployment pipeline configuration",
		);
		expect(label).not.toContain("const");
	});

	it("strips HTML tags", () => {
		const label = extractLabel(
			'<p>Storage provider <a href="https://example.com">selection</a> algorithm details</p>',
		);
		expect(label).not.toContain("<p>");
		expect(label).not.toContain("<a ");
	});
});

describe("isCodeHeavy", () => {
	it("detects code fence content", () => {
		expect(isCodeHeavy("```suggestion\nconst x = 1;\n```")).toBe(true);
	});

	it("detects HTML-heavy content", () => {
		expect(
			isCodeHeavy(
				'<details><summary>Release notes</summary><p>Sourced from <a href="url">repo</a></p></details>',
			),
		).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(isCodeHeavy("This is a normal discussion about upload timeouts")).toBe(false);
	});

	it("returns true for empty content", () => {
		expect(isCodeHeavy("")).toBe(true);
	});

	it("detects import/export statements", () => {
		expect(isCodeHeavy("import { Foo } from './bar';\nexport class Baz {}")).toBe(true);
	});
});

describe("extractLabelFromCandidates", () => {
	it("prefers non-code candidates", () => {
		const label = extractLabelFromCandidates([
			"```suggestion\nconst x = 1;\n```",
			"Storage provider selection algorithm handles multi-copy durability",
		]);
		expect(label).toContain("Storage");
	});

	it("falls back to code candidate if all are code", () => {
		const label = extractLabelFromCandidates([
			"```suggestion\nconst x = 1;\n```",
			"```suggestion\nlet y = 2;\n```",
		]);
		// Should produce something, not unlabelled
		expect(label.length).toBeGreaterThan(0);
	});

	it("returns unlabelled for empty candidates", () => {
		expect(extractLabelFromCandidates([])).toBe("unlabelled cluster");
	});

	it("returns unlabelled for all-empty candidates", () => {
		expect(extractLabelFromCandidates(["", ""])).toBe("unlabelled cluster");
	});
});
