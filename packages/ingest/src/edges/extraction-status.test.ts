import { describe, expect, it } from "vitest";
import { statusFilePath } from "./extraction-status.js";

describe("statusFilePath", () => {
	it("uses flat layout: {manifestDir}/{collection}.extraction-status.json (#148)", () => {
		const result = statusFilePath("/data/manifests", "my-collection");
		expect(result).toBe("/data/manifests/my-collection.extraction-status.json");
	});

	it("does not create a per-collection subdirectory", () => {
		const result = statusFilePath("/data/manifests", "test");
		// Should NOT contain /test/.extraction-status.json (old subdir layout)
		expect(result).not.toContain("/test/.extraction-status.json");
	});
});
