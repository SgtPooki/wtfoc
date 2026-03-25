import { describe, expect, it } from "vitest";
import { extractLabel } from "./labels.js";

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
});
