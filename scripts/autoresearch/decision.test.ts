import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import { decide, decideMulti, DEFAULT_GATES, trimmedMean } from "./decision.js";

interface ScoreOpts {
	id: string;
	category?: string;
	passed?: boolean;
	skipped?: boolean;
}

function score(opts: ScoreOpts): {
	id: string;
	category: string;
	queryText: string;
	passed: boolean;
	skipped?: boolean;
	requiredTypesFound: boolean;
	requiredTypesFoundQueryOnly: boolean;
	passedQueryOnly: boolean;
	resultCount: number;
	substringFound: boolean;
	edgeHopFound: boolean;
	crossSourceFound: boolean;
	sourceTypesReached: string[];
	lineage: null;
	distinctDocs: number;
	distinctSourceTypes: number;
	recallAtK: number | null;
	recallK: number | null;
	topScore: number | null;
} {
	return {
		id: opts.id,
		category: opts.category ?? "direct-lookup",
		queryText: opts.id,
		passed: opts.passed ?? true,
		skipped: opts.skipped,
		requiredTypesFound: true,
		requiredTypesFoundQueryOnly: true,
		passedQueryOnly: opts.passed ?? true,
		resultCount: 5,
		substringFound: true,
		edgeHopFound: true,
		crossSourceFound: true,
		sourceTypesReached: [],
		lineage: null,
		distinctDocs: 1,
		distinctSourceTypes: 1,
		recallAtK: null,
		recallK: null,
		topScore: null,
	};
}

const runConfig: RunConfig = {
	collectionId: "test",
	corpusDigest: "abc",
	goldFixtureVersion: "1.9.0",
	goldFixtureHash: "h",
	embedder: { url: "u", model: "m" },
	extractor: null,
	reranker: null,
	grader: null,
	retrieval: {
		topK: 10,
		traceMaxPerSource: 3,
		traceMaxTotal: 15,
		traceMaxHops: 3,
		traceMinScore: 0.3,
		traceMode: "analytical",
		autoRoute: false,
		diversityEnforce: false,
	},
	evaluation: { checkParaphrases: false, groundCheck: false },
	promptHashes: {},
	seed: 0,
	gitSha: null,
	packageVersions: {},
	nodeVersion: "24.11",
	cacheNamespaceSchemeVersion: 1,
};

function makeReport(opts: {
	scores: ReturnType<typeof score>[];
	passRate?: number;
	demoCritical?: number;
	workLineage?: number;
	fileLevel?: number;
	hardNegative?: number;
	applicableRate?: number;
	paraphraseInvariant?: number | null;
	costComparable?: { value: boolean; reasons: string[] };
}): ExtendedDogfoodReport {
	const m = {
		passRate: opts.passRate ?? 0.7,
		applicableRate: opts.applicableRate ?? 1,
		tierBreakdown: { "demo-critical": { passRate: opts.demoCritical ?? 1 } },
		categoryBreakdown: {
			"work-lineage": { passRate: opts.workLineage ?? 1 },
			"file-level": { passRate: opts.fileLevel ?? 1 },
			"hard-negative": { passRate: opts.hardNegative ?? 0 },
		},
		paraphraseInvariance:
			opts.paraphraseInvariant === null
				? { checked: false, invariantFraction: 0 }
				: { checked: true, invariantFraction: opts.paraphraseInvariant ?? 0.81 },
		scores: opts.scores,
	};
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: "t",
		collectionName: "t",
		stages: [
			{
				stage: "quality-queries",
				startedAt: "",
				durationMs: 0,
				verdict: "pass",
				summary: "",
				metrics: m,
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig,
		runConfigFingerprint: "fp",
		fingerprintVersion: 1,
		costComparable: opts.costComparable,
	};
}

function seededRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

describe("decide", () => {
	it("ACCEPTS when bootstrap + gates + cost all pass", () => {
		// 30 queries; baseline 60% pass, candidate 90% pass — 30-point lift.
		const baseScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 18 }),
		);
		const candScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 27 }),
		);
		const verdict = decide({
			baseline: makeReport({
				scores: baseScores,
				passRate: 0.6,
				costComparable: { value: true, reasons: [] },
			}),
			candidate: makeReport({
				scores: candScores,
				passRate: 0.9,
				costComparable: { value: true, reasons: [] },
			}),
			bootstrapIterations: 2000,
			rng: seededRng(7),
		});
		expect(verdict.accept).toBe(true);
		expect(verdict.reasons).toHaveLength(0);
		expect(verdict.bootstrap.probBgreaterA).toBeGreaterThan(0.95);
		expect(verdict.bootstrap.meanDelta).toBeGreaterThan(0.04);
	});

	it("REJECTS when lift is below 4 points (no signal)", () => {
		// Baseline 60%, candidate 62%.
		const baseScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 18 }),
		);
		const candScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 19 }),
		);
		const verdict = decide({
			baseline: makeReport({ scores: baseScores }),
			candidate: makeReport({
				scores: candScores,
				costComparable: { value: true, reasons: [] },
			}),
			bootstrapIterations: 2000,
			rng: seededRng(11),
		});
		expect(verdict.accept).toBe(false);
		expect(verdict.reasons.some((r) => r.includes("lift"))).toBe(true);
	});

	it("REJECTS when demoCritical hard gate breaks", () => {
		const baseScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 18 }),
		);
		const candScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 27 }),
		);
		// DEFAULT_GATES.demoCriticalMin is 0 post-recalibration (2026-05-04);
		// override explicitly to test the gate-breaking path.
		const gates = { ...DEFAULT_GATES, demoCriticalMin: 0.67 };
		const verdict = decide({
			baseline: makeReport({ scores: baseScores }),
			candidate: makeReport({
				scores: candScores,
				demoCritical: 0.6, // < gate floor 0.67 — fail
				costComparable: { value: true, reasons: [] },
			}),
			gates,
			bootstrapIterations: 2000,
			rng: seededRng(7),
		});
		expect(verdict.accept).toBe(false);
		expect(verdict.reasons.some((r) => r.includes("demoCritical"))).toBe(true);
	});

	it("does NOT reject on costComparable=false (gate temporarily disabled per #331)", () => {
		// TODO(#331): cost-comparable gate disabled while autonomous loop
		// runs on local LLM ($0 by definition). When the gate re-enables,
		// flip this back to: expect accept=false + a costComparable reason.
		const baseScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 18 }),
		);
		const candScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 27 }),
		);
		const verdict = decide({
			baseline: makeReport({ scores: baseScores }),
			candidate: makeReport({
				scores: candScores,
				costComparable: { value: false, reasons: ["unknown-price:foo"] },
			}),
			bootstrapIterations: 2000,
			rng: seededRng(7),
		});
		expect(verdict.reasons.some((r) => r.includes("costComparable"))).toBe(false);
	});

	it("uses DEFAULT_GATES when none provided", () => {
		const baseScores = Array.from({ length: 5 }, (_, i) =>
			score({ id: `q${i}`, passed: true }),
		);
		const candScores = Array.from({ length: 5 }, (_, i) =>
			score({ id: `q${i}`, passed: true }),
		);
		const verdict = decide({
			baseline: makeReport({ scores: baseScores }),
			candidate: makeReport({
				scores: candScores,
				costComparable: { value: true, reasons: [] },
			}),
			bootstrapIterations: 1000,
			rng: seededRng(42),
		});
		// With identical baseline+candidate, no lift → reject.
		expect(verdict.accept).toBe(false);
		// Recalibrated 2026-05-04 against post-hygiene empirical rates.
		// Pre-hygiene was 1.0 (mathematically unreachable); now 0 pending
		// per-corpus tier-presence check (#364).
		expect(DEFAULT_GATES.demoCriticalMin).toBe(0);
	});
});

describe("trimmedMean", () => {
	it("returns 0 on empty input", () => {
		expect(trimmedMean([], 0.1)).toBe(0);
	});
	it("returns the single value when length=1", () => {
		expect(trimmedMean([0.5], 0.1)).toBe(0.5);
	});
	it("returns the arithmetic mean when fraction=0", () => {
		expect(trimmedMean([0.1, 0.2, 0.3], 0)).toBeCloseTo(0.2);
	});
	it("drops the highest and lowest tails", () => {
		// 10 values; trim 10% drops 1 from each end → mean of middle 8.
		const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
		const mean = trimmedMean(vals, 0.1);
		// middle 8 = 2..9 → mean 5.5
		expect(mean).toBeCloseTo(5.5);
	});
	it("clamps absurd fractions instead of throwing", () => {
		expect(trimmedMean([1, 2, 3], 0.99)).not.toBeNaN();
	});
});

function makeMultiReport(passRate: number, scoreCount = 30): ExtendedDogfoodReport {
	const scores = Array.from({ length: scoreCount }, (_, i) =>
		score({ id: `q${i}`, passed: i / scoreCount < passRate }),
	);
	const actualPassRate =
		scores.length === 0 ? 0 : scores.filter((entry) => entry.passed).length / scores.length;
	return makeReport({ scores, passRate: actualPassRate });
}

describe("decideMulti", () => {
	it("ACCEPTS when every must-pass corpus delta clears the floor and trimmed-mean clears minLift", () => {
		const baseline = new Map([
			["alpha", makeMultiReport(0.5)],
			["beta", makeMultiReport(0.5)],
		]);
		const candidate = new Map([
			["alpha", makeMultiReport(0.6)],
			["beta", makeMultiReport(0.6)],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		expect(v.accept).toBe(true);
		expect(v.trimmedMeanDelta).toBeCloseTo(0.1, 1);
		expect(v.perCorpus).toHaveLength(2);
	});

	it("REJECTS on per-corpus floor breach", () => {
		const baseline = new Map([
			["alpha", makeMultiReport(0.6)],
			["beta", makeMultiReport(0.6)],
		]);
		// alpha gains 30pp, beta drops 10pp -> trimmed-mean still positive but
		// must-pass floor on beta is -3pp by default.
		const candidate = new Map([
			["alpha", makeMultiReport(0.9)],
			["beta", makeMultiReport(0.5)],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		expect(v.accept).toBe(false);
		expect(v.reasons.some((r) => r.includes('"beta"') && r.includes("below floor"))).toBe(true);
	});

	it("REJECTS on catastrophic loss veto regardless of mean", () => {
		const baseline = new Map([
			["alpha", makeMultiReport(0.6)],
			["beta", makeMultiReport(0.6)],
		]);
		// beta drops 35pp — catastrophic floor is 30pp.
		const candidate = new Map([
			["alpha", makeMultiReport(0.95)],
			["beta", makeMultiReport(0.25)],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		expect(v.accept).toBe(false);
		expect(v.reasons.some((r) => r.includes("catastrophic"))).toBe(true);
	});

	it("REJECTS on minMeaningfulLoC veto when patch is no-op", () => {
		const baseline = new Map([["alpha", makeMultiReport(0.5)]]);
		const candidate = new Map([["alpha", makeMultiReport(0.6)]]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 0 });
		expect(v.accept).toBe(false);
		expect(v.reasons.some((r) => r.includes("LOC change"))).toBe(true);
	});

	it("REJECTS when trimmed-mean delta is below minLift even with no per-corpus breach", () => {
		const baseline = new Map([
			["alpha", makeMultiReport(0.6)],
			["beta", makeMultiReport(0.6)],
		]);
		// Both gain 1pp.
		const candidate = new Map([
			["alpha", makeMultiReport(0.61)],
			["beta", makeMultiReport(0.61)],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		expect(v.accept).toBe(false);
		expect(v.reasons.some((r) => r.includes("minLift"))).toBe(true);
	});

	it("REJECTS when query-type aggregate regresses past typeFloor", () => {
		const baseScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 18, category: "work-lineage" }),
		);
		const candScores = Array.from({ length: 30 }, (_, i) =>
			score({ id: `q${i}`, passed: i < 24, category: "work-lineage" }),
		);
		const baseline = new Map([
			[
				"alpha",
				makeReport({
					scores: baseScores,
					passRate: 0.6,
					workLineage: 0.9,
				}),
			],
		]);
		const candidate = new Map([
			[
				"alpha",
				makeReport({
					scores: candScores,
					passRate: 0.8,
					// work-lineage drops to 0.8, delta -10pp, breaches typeFloor 5pp
					workLineage: 0.8,
				}),
			],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		const wlReason = v.reasons.find((r) => r.includes("work-lineage"));
		expect(wlReason).toBeDefined();
	});

	it("treats single-corpus calls as a special case and accepts cleanly", () => {
		const baseline = new Map([["alpha", makeMultiReport(0.5)]]);
		const candidate = new Map([["alpha", makeMultiReport(0.7)]]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 10 });
		expect(v.accept).toBe(true);
		expect(v.perCorpus).toHaveLength(1);
	});

	it("flags missing must-pass corpora", () => {
		const baseline = new Map([["alpha", makeMultiReport(0.5)]]);
		const candidate = new Map([["alpha", makeMultiReport(0.7)]]);
		const v = decideMulti({
			baseline,
			candidate,
			mustPassCorpora: ["alpha", "missing"],
			cumulativeLocChange: 5,
		});
		expect(v.accept).toBe(false);
		expect(v.reasons.some((r) => r.includes("missing"))).toBe(true);
	});

	it("emits perCorpus deltas in the verdict", () => {
		const baseline = new Map([
			["alpha", makeMultiReport(0.5)],
			["beta", makeMultiReport(0.6)],
		]);
		const candidate = new Map([
			["alpha", makeMultiReport(0.7)],
			["beta", makeMultiReport(0.7)],
		]);
		const v = decideMulti({ baseline, candidate, cumulativeLocChange: 5 });
		expect(v.perCorpus.find((p) => p.corpusId === "alpha")?.delta).toBeCloseTo(0.2, 1);
		expect(v.perCorpus.find((p) => p.corpusId === "beta")?.delta).toBeCloseTo(0.1, 1);
	});
});
