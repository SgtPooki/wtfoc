import { describe, expect, it } from "vitest";
import { type Edit, type PatchProposal, validatePatch } from "./patch-proposal.js";

const ALLOWED_FILE = "packages/search/src/clustering/greedy-clusterer.ts";
const OUT_FILE = "scripts/dogfood.ts";

function patch(edits: readonly Edit[], sha = "abc1234"): PatchProposal {
	return { kind: "patch", baseSha: sha, edits, rationale: "test" };
}

describe("validatePatch (search/replace)", () => {
	it("accepts a single in-allowlist edit", () => {
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: "const threshold = 0.5;", new: "const threshold = 0.6;" }]),
		);
		expect(r.ok).toBe(true);
		expect(r.touchedPaths).toEqual([ALLOWED_FILE]);
		expect(r.errors).toEqual([]);
	});

	it("rejects edits touching files outside allowlist", () => {
		const r = validatePatch(patch([{ file: OUT_FILE, old: "x", new: "y" }]));
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("outside allowlist"))).toBe(true);
	});

	it("rejects empty edits array", () => {
		const r = validatePatch(patch([]));
		expect(r.ok).toBe(false);
		expect(r.errors).toContain("empty edits");
	});

	it("rejects missing/short baseSha", () => {
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: "a", new: "b" }], "x"),
		);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("baseSha"))).toBe(true);
	});

	it("rejects edit where old === new (no-op)", () => {
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: "same", new: "same" }]),
		);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("no-op"))).toBe(true);
	});

	it("rejects edit with empty old anchor", () => {
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: "", new: "x" }]),
		);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("old string is empty"))).toBe(true);
	});

	it("counts line deltas across edits and respects maxDiffLines cap", () => {
		const huge = "x\n".repeat(150).slice(0, -1);
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: huge, new: huge + "\nadded" }]),
			{ maxDiffLines: 200 },
		);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("exceeds maxDiffLines"))).toBe(true);
	});

	it("respects custom allowedPaths override", () => {
		const r = validatePatch(
			patch([{ file: ALLOWED_FILE, old: "a", new: "b" }]),
			{ allowedPaths: ["scripts/"] },
		);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("outside allowlist"))).toBe(true);
	});
});
