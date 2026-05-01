import type { FailureLayer } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import {
	assertNoFrozenLeak,
	selectPatchCapsule,
	TIER_0_FROZEN_PATHS,
	TIER_1_RANKING_PATHS,
	TIER_2_CHUNKING_EMBEDDING_PATHS,
	TIER_3_EXTRACTORS_PATHS,
} from "./patch-capsule.js";

describe("selectPatchCapsule", () => {
	it("returns null for human-only fixture layer", () => {
		expect(selectPatchCapsule("fixture")).toBeNull();
	});

	it("returns null for human-only ingest layer", () => {
		expect(selectPatchCapsule("ingest")).toBeNull();
	});

	it("returns null when dominantLayer is null (no failures)", () => {
		expect(selectPatchCapsule(null)).toBeNull();
	});

	it("ranking layer maps to Tier 1 only", () => {
		const c = selectPatchCapsule("ranking");
		expect(c).not.toBeNull();
		expect(c?.tiers).toEqual([1]);
		expect(c?.allowedPaths).toEqual(TIER_1_RANKING_PATHS);
	});

	it("trace layer maps to Tier 1 only (trace.ts is in Tier 1)", () => {
		const c = selectPatchCapsule("trace");
		expect(c?.tiers).toEqual([1]);
		expect(c?.allowedPaths).toEqual(TIER_1_RANKING_PATHS);
	});

	it("embedding layer opens Tier 1+2", () => {
		const c = selectPatchCapsule("embedding");
		expect(c?.tiers).toEqual([1, 2]);
		expect(c?.allowedPaths).toEqual([
			...TIER_1_RANKING_PATHS,
			...TIER_2_CHUNKING_EMBEDDING_PATHS,
		]);
	});

	it("chunking layer opens Tier 1+2", () => {
		const c = selectPatchCapsule("chunking");
		expect(c?.tiers).toEqual([1, 2]);
	});

	it("edge-extraction layer opens Tier 1+3", () => {
		const c = selectPatchCapsule("edge-extraction");
		expect(c?.tiers).toEqual([1, 3]);
		expect(c?.allowedPaths).toEqual([
			...TIER_1_RANKING_PATHS,
			...TIER_3_EXTRACTORS_PATHS,
		]);
	});

	it("every capsule includes a description and curatedFiles", () => {
		const layers: FailureLayer[] = ["ranking", "trace", "embedding", "chunking", "edge-extraction"];
		for (const layer of layers) {
			const c = selectPatchCapsule(layer);
			expect(c?.description.length, `${layer} description`).toBeGreaterThan(0);
			expect(c?.curatedFiles.length, `${layer} curatedFiles`).toBeGreaterThan(0);
		}
	});
});

describe("Tier 0 frozen invariant", () => {
	it("Tier 1 paths do not overlap Tier 0", () => {
		for (const p of TIER_1_RANKING_PATHS) {
			for (const f of TIER_0_FROZEN_PATHS) {
				expect(p.startsWith(f), `Tier 1 path "${p}" overlaps frozen "${f}"`).toBe(false);
				expect(f.startsWith(p), `Frozen "${f}" overlaps Tier 1 "${p}"`).toBe(false);
			}
		}
	});

	it("Tier 2 paths do not overlap Tier 0", () => {
		for (const p of TIER_2_CHUNKING_EMBEDDING_PATHS) {
			for (const f of TIER_0_FROZEN_PATHS) {
				expect(p.startsWith(f), `Tier 2 "${p}" overlaps frozen "${f}"`).toBe(false);
				expect(f.startsWith(p), `Frozen "${f}" overlaps Tier 2 "${p}"`).toBe(false);
			}
		}
	});

	it("Tier 3 paths do not overlap Tier 0", () => {
		for (const p of TIER_3_EXTRACTORS_PATHS) {
			for (const f of TIER_0_FROZEN_PATHS) {
				expect(p.startsWith(f), `Tier 3 "${p}" overlaps frozen "${f}"`).toBe(false);
				expect(f.startsWith(p), `Frozen "${f}" overlaps Tier 3 "${p}"`).toBe(false);
			}
		}
	});

	it("assertNoFrozenLeak passes for every selectable capsule", () => {
		for (const layer of [
			"ranking",
			"trace",
			"embedding",
			"chunking",
			"edge-extraction",
		] as FailureLayer[]) {
			const c = selectPatchCapsule(layer);
			if (c) expect(() => assertNoFrozenLeak(c)).not.toThrow();
		}
	});

	it("assertNoFrozenLeak throws when a capsule includes a frozen prefix", () => {
		expect(() =>
			assertNoFrozenLeak({
				dominantLayer: "ranking",
				tiers: [1],
				allowedPaths: ["packages/search/src/eval/sneaky.ts"],
				curatedFiles: [],
				description: "leak test",
			}),
		).toThrow(/Tier 0 frozen path leak/);
	});
});
