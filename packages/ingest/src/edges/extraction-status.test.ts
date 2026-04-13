import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { overlayFilePath, statusFilePath } from "./overlay-store.js";

describe("overlayFilePath", () => {
	it("uses per-extractor directory layout", () => {
		const result = overlayFilePath("/data/manifests", "my-collection", "regex");
		const expected = join("/data/manifests", "my-collection.edge-overlays", "regex", "edges.json");
		expect(result).toBe(expected);
	});

	it("namespaces different extractors under same collection", () => {
		const a = overlayFilePath("/data", "col", "regex");
		const b = overlayFilePath("/data", "col", "llm-abc123");
		expect(a).not.toBe(b);
		expect(a).toContain("regex");
		expect(b).toContain("llm-abc123");
	});
});

describe("statusFilePath", () => {
	it("uses per-extractor directory layout", () => {
		const result = statusFilePath("/data/manifests", "my-collection", "tree-sitter");
		const expected = join(
			"/data/manifests",
			"my-collection.edge-overlays",
			"tree-sitter",
			"status.json",
		);
		expect(result).toBe(expected);
	});
});
