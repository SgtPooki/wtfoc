import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { statusFilePath } from "./extraction-status.js";

describe("statusFilePath", () => {
	it("uses flat layout: {manifestDir}/{collection}.extraction-status.json (#148)", () => {
		const result = statusFilePath("/data/manifests", "my-collection");
		const expected = join("/data/manifests", "my-collection.extraction-status.json");
		expect(result).toBe(expected);
	});

	it("does not create a per-collection subdirectory", () => {
		const result = statusFilePath("/data/manifests", "test");
		// Should NOT contain /test/.extraction-status.json (old subdir layout)
		const forbiddenSubpath = `${sep}test${sep}.extraction-status.json`;
		expect(result).not.toContain(forbiddenSubpath);
	});
});
