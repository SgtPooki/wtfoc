/**
 * Family-aware paired bootstrap for autoresearch variant comparison.
 * Maintainer-only.
 *
 * # The invariant
 *
 * The dogfood gold fixture nests paraphrases INSIDE each canonical
 * `QueryScore` (one top-level entry per gold query, with optional
 * `paraphraseScores` underneath). Each `QueryScore` IS a family head.
 *
 * Paired bootstrap of (variantA pass-rate vs variantB pass-rate) MUST
 * sample by family — i.e. one row per `QueryScore`. Flattening
 * paraphrases into 202+ separate "queries" and bootstrapping over the
 * flat list inflates the effective sample size and produces
 * overconfident confidence intervals (peer-review of #311 Phase 1
 * flagged this as the single biggest statistical mistake the sweep
 * harness could make).
 *
 * The contract:
 *   - n samples of a draw of size n is correct.
 *   - Each sample contributes ONE pass/fail observation per variant.
 *   - Paraphrases of the same canonical CANNOT appear as separate
 *     samples in a single draw.
 *   - The pass observation may be derived from canonical-only or
 *     canonical-AND-paraphrases (e.g. paraphraseInvariant), but it is
 *     a property of the family, not of an individual paraphrase.
 *
 * This file ships:
 *   - `sampleByFamily()` — reference implementation.
 *   - `pairedDelta()` — computes (passRateB - passRateA) on a draw.
 *   - `pairedBootstrap()` — runs N draws, returns bootstrap CI.
 *
 * Phase 2 sweep harness reads this contract via the test in
 * `paired-bootstrap.test.ts` and consumes these helpers directly.
 */

interface FamilyResult {
	/** Family id — must be the canonical QueryScore.id. */
	id: string;
	/** Pass observation for this family in variant A. */
	passA: boolean;
	/** Pass observation for this family in variant B. */
	passB: boolean;
}

export interface BootstrapOptions {
	/** Number of bootstrap iterations. Default 10000. */
	iterations?: number;
	/** RNG. Default Math.random. */
	rng?: () => number;
}

export interface BootstrapResult {
	/** Mean of bootstrap distribution of (B - A) pass-rate delta. */
	meanDelta: number;
	/** Lower bound of 95% percentile CI. */
	ciLow: number;
	/** Upper bound of 95% percentile CI. */
	ciHigh: number;
	/** Probability that variant B beats variant A under the bootstrap distribution. */
	probBgreaterA: number;
	/** Number of family rows in the input. */
	familyCount: number;
}

/**
 * Sample n family rows with replacement. Each family contributes one
 * (passA, passB) pair per draw; paraphrases never split into separate
 * rows.
 */
export function sampleByFamily(
	families: readonly FamilyResult[],
	rng: () => number = Math.random,
): FamilyResult[] {
	const out: FamilyResult[] = new Array(families.length);
	for (let i = 0; i < families.length; i++) {
		const idx = Math.floor(rng() * families.length);
		const picked = families[idx];
		if (!picked) throw new Error("sampleByFamily: empty input");
		out[i] = picked;
	}
	return out;
}

/** (passRate_B - passRate_A) on a given family draw. */
export function pairedDelta(draw: readonly FamilyResult[]): number {
	if (draw.length === 0) return 0;
	let a = 0;
	let b = 0;
	for (const f of draw) {
		if (f.passA) a++;
		if (f.passB) b++;
	}
	return b / draw.length - a / draw.length;
}

/**
 * Paired bootstrap on (variantB - variantA) pass-rate. Returns mean
 * delta, 95% percentile CI, and the bootstrap-implied probability that
 * variant B beats variant A.
 *
 * Decision rule from #311: accept variant B only if
 *   probBgreaterA >= 0.95 AND (passRateB - passRateA) >= 0.04
 * The harness gates promotion using both conditions; this helper just
 * supplies the inputs.
 */
export function pairedBootstrap(
	families: readonly FamilyResult[],
	options: BootstrapOptions = {},
): BootstrapResult {
	const iterations = options.iterations ?? 10000;
	const rng = options.rng ?? Math.random;
	if (families.length === 0) {
		return {
			meanDelta: 0,
			ciLow: 0,
			ciHigh: 0,
			probBgreaterA: 0,
			familyCount: 0,
		};
	}
	const deltas: number[] = new Array(iterations);
	let bWins = 0;
	for (let i = 0; i < iterations; i++) {
		const d = pairedDelta(sampleByFamily(families, rng));
		deltas[i] = d;
		if (d > 0) bWins++;
	}
	deltas.sort((a, b) => a - b);
	const sum = deltas.reduce((acc, v) => acc + v, 0);
	const meanDelta = sum / iterations;
	const ciLowIdx = Math.floor(iterations * 0.025);
	const ciHighIdx = Math.floor(iterations * 0.975);
	return {
		meanDelta,
		ciLow: deltas[ciLowIdx] ?? 0,
		ciHigh: deltas[ciHighIdx] ?? 0,
		probBgreaterA: bWins / iterations,
		familyCount: families.length,
	};
}

/**
 * Build a `FamilyResult[]` from two parallel score arrays (variantA,
 * variantB). Both arrays must contain QueryScore-shaped objects with
 * `id` and `passed` properties; the function aligns them by `id` and
 * drops any score where either side is skipped.
 *
 * `getPassed` lets the caller pick which observation to use:
 *   - default: `s => s.passed` (canonical-pass)
 *   - alternative: `s => s.paraphraseInvariant === true` (brittleness-
 *     aware pass; family fails if any paraphrase fails)
 */
interface ScoreLike {
	id: string;
	passed: boolean;
	skipped?: boolean;
	paraphraseInvariant?: boolean;
}

export function buildFamilyResults(
	variantA: readonly ScoreLike[],
	variantB: readonly ScoreLike[],
	getPassed: (s: ScoreLike) => boolean = (s) => s.passed,
): FamilyResult[] {
	const byIdA = new Map<string, ScoreLike>();
	for (const s of variantA) byIdA.set(s.id, s);
	const out: FamilyResult[] = [];
	for (const b of variantB) {
		if (b.skipped) continue;
		const a = byIdA.get(b.id);
		if (!a || a.skipped) continue;
		out.push({ id: b.id, passA: getPassed(a), passB: getPassed(b) });
	}
	return out;
}
