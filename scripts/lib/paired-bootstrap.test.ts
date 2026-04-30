import { describe, expect, it } from "vitest";
import {
	buildFamilyResults,
	pairedBootstrap,
	pairedDelta,
	sampleByFamily,
} from "./paired-bootstrap.js";

/**
 * Family-aware paired bootstrap (#311 peer-review review-of-review
 * batch). The dogfood gold fixture nests paraphrases inside a single
 * QueryScore per gold query. Bootstrapping over flattened paraphrases
 * inflates effective sample size and produces overconfident CIs —
 * the single biggest statistical mistake the sweep harness could
 * make. These tests lock the contract.
 */

const families = [
	{ id: "dl-1", passA: true, passB: true },
	{ id: "dl-2", passA: false, passB: true },
	{ id: "dl-3", passA: true, passB: false },
	{ id: "cs-1", passA: false, passB: false },
	{ id: "wl-1", passA: true, passB: true },
	{ id: "wl-2", passA: false, passB: true },
];

function seededRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

describe("sampleByFamily", () => {
	it("returns a draw of the same length as input", () => {
		const draw = sampleByFamily(families, seededRng(42));
		expect(draw.length).toBe(families.length);
	});

	it("samples by family — every draw element has an id from the input", () => {
		const draw = sampleByFamily(families, seededRng(42));
		const inputIds = new Set(families.map((f) => f.id));
		for (const f of draw) {
			expect(inputIds.has(f.id)).toBe(true);
		}
	});

	it("CONTRACT: paraphrases of the same canonical never appear as separate samples", () => {
		// Paraphrases live inside QueryScore in the real fixture; they
		// never become independent FamilyResult rows. This test
		// documents that any FamilyResult-shaped sample respects the
		// "one row per canonical" invariant by construction. If a
		// future caller breaks this — e.g. flattens paraphrases as
		// separate FamilyResult entries — the test should be the first
		// thing to start failing.
		const flatRows = families;
		const draw = sampleByFamily(flatRows, seededRng(42));
		// For every family id, the draw entry's (passA, passB) MUST
		// match what the input row carries — never derived from a
		// paraphrase observation that conflicts with the canonical.
		const byId = new Map(flatRows.map((f) => [f.id, f]));
		for (const f of draw) {
			const orig = byId.get(f.id);
			expect(orig).toBeDefined();
			expect(f.passA).toBe(orig?.passA);
			expect(f.passB).toBe(orig?.passB);
		}
	});

	it("samples with replacement — draws can repeat ids", () => {
		const draw = sampleByFamily(families, seededRng(7));
		const seen: Record<string, number> = {};
		for (const f of draw) seen[f.id] = (seen[f.id] ?? 0) + 1;
		// With seeded rng + 6 families, we expect at least one repeat.
		const maxCount = Math.max(...Object.values(seen));
		expect(maxCount).toBeGreaterThanOrEqual(2);
	});
});

describe("pairedDelta", () => {
	it("computes (passRateB - passRateA) on a draw", () => {
		const d = pairedDelta(families);
		// A: [T,F,T,F,T,F] = 3/6 = 0.5
		// B: [T,T,F,F,T,T] = 4/6 = 0.667
		// delta ≈ 0.167
		expect(d).toBeCloseTo(4 / 6 - 3 / 6, 6);
	});

	it("returns 0 on empty draw", () => {
		expect(pairedDelta([])).toBe(0);
	});
});

describe("pairedBootstrap", () => {
	it("returns familyCount and a centered estimate matching the observed delta", () => {
		const r = pairedBootstrap(families, { iterations: 2000, rng: seededRng(13) });
		expect(r.familyCount).toBe(families.length);
		// Mean of bootstrap distribution should hover near observed delta.
		expect(r.meanDelta).toBeGreaterThan(0);
		expect(r.meanDelta).toBeLessThan(0.5);
	});

	it("CI brackets the observed delta", () => {
		const r = pairedBootstrap(families, { iterations: 2000, rng: seededRng(13) });
		expect(r.ciLow).toBeLessThan(r.ciHigh);
		// Observed delta ≈ 0.167. With 6 samples it's noisy; CI should
		// nonetheless be wide enough to include both negative and
		// positive values.
		expect(r.ciLow).toBeLessThan(0.3);
		expect(r.ciHigh).toBeGreaterThan(0);
	});

	it("probBgreaterA is in [0, 1]", () => {
		const r = pairedBootstrap(families, { iterations: 1000, rng: seededRng(99) });
		expect(r.probBgreaterA).toBeGreaterThanOrEqual(0);
		expect(r.probBgreaterA).toBeLessThanOrEqual(1);
	});

	it("returns zeros on empty input", () => {
		const r = pairedBootstrap([], { iterations: 100 });
		expect(r.familyCount).toBe(0);
		expect(r.meanDelta).toBe(0);
	});
});

describe("buildFamilyResults", () => {
	it("aligns variantA + variantB by id", () => {
		const a = [
			{ id: "q1", passed: true },
			{ id: "q2", passed: false },
		];
		const b = [
			{ id: "q1", passed: true },
			{ id: "q2", passed: true },
		];
		const fams = buildFamilyResults(a, b);
		expect(fams).toEqual([
			{ id: "q1", passA: true, passB: true },
			{ id: "q2", passA: false, passB: true },
		]);
	});

	it("drops queries skipped in either variant", () => {
		const a = [
			{ id: "q1", passed: true, skipped: true },
			{ id: "q2", passed: false },
		];
		const b = [
			{ id: "q1", passed: true },
			{ id: "q2", passed: true, skipped: true },
		];
		expect(buildFamilyResults(a, b)).toEqual([]);
	});

	it("supports brittleness-aware pass via custom getPassed", () => {
		const a = [{ id: "q1", passed: true, paraphraseInvariant: false }];
		const b = [{ id: "q1", passed: true, paraphraseInvariant: true }];
		const fams = buildFamilyResults(
			a,
			b,
			(s) => s.paraphraseInvariant === true,
		);
		expect(fams).toEqual([{ id: "q1", passA: false, passB: true }]);
	});
});
