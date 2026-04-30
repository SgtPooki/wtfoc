import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import type { RunLogRow } from "../lib/run-log.js";
import {
	detectRegression,
	REGRESSION_MIN_MEAN_DELTA,
	REGRESSION_MIN_PROB,
} from "./detect-regression.js";

interface ScoreFixture {
	id: string;
	passed: boolean;
	skipped?: boolean;
}

interface RowFixture {
	sweepId: string;
	loggedAt: string;
	fingerprint?: string;
	corpus?: string;
	corpusDigest?: string;
	stage?: string;
	passRate?: number;
	demoCriticalPassRate?: number | null;
	hardNegativePassRate?: number | null;
	scores: ScoreFixture[];
	workLineagePassRate?: number;
	fileLevelPassRate?: number;
	applicableRate?: number;
}

const VARIANT = "noar_div_rrOff";
const MATRIX = "retrieval-baseline";
const CORPUS = "filoz-ecosystem-2026-04-v12";
const FP = "fingerprint-canonical";
const DIGEST = "digest-canonical";

function row(input: RowFixture): RunLogRow {
	const corpus = input.corpus ?? CORPUS;
	const corpusDigest = input.corpusDigest ?? DIGEST;
	const fingerprint = input.fingerprint ?? FP;
	const runConfig: RunConfig = {
		collectionId: corpus,
		corpusDigest,
		goldFixtureVersion: "1.9.0",
		goldFixtureHash: "hash",
		embedder: { url: "http://x/v1", model: "test" },
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
			diversityEnforce: true,
		},
		evaluation: { checkParaphrases: false, groundCheck: false },
		promptHashes: {},
		seed: 0,
		gitSha: null,
		packageVersions: {},
		nodeVersion: "24.11",
		cacheNamespaceSchemeVersion: 1,
	};
	const r: RunLogRow = {
		schemaVersion: 1,
		loggedAt: input.loggedAt,
		sweepId: input.sweepId,
		matrixName: MATRIX,
		variantId: VARIANT,
		runConfig,
		runConfigFingerprint: fingerprint,
		fingerprintVersion: 1,
		summary: {
			passRate: input.passRate ?? 0.65,
			passCount: 100,
			applicableTotal: 153,
			portablePassRate: null,
			demoCriticalPassRate: input.demoCriticalPassRate ?? 1,
			hardNegativePassRate: input.hardNegativePassRate ?? 0,
			paraphraseInvariantFraction: null,
			recallAtKMean: 0.7,
			costComparable: true,
			costUsdTotal: 0,
			latencyP95Ms: 1100,
		},
		durationMs: 100,
		reportPath: `/virtual/${input.sweepId}.json`,
	};
	if (input.stage !== undefined) r.stage = input.stage;
	return r;
}

function reportFor(input: RowFixture): ExtendedDogfoodReport {
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: input.loggedAt,
		collectionId: input.corpus ?? CORPUS,
		collectionName: input.corpus ?? CORPUS,
		stages: [
			{
				stage: "quality-queries",
				startedAt: input.loggedAt,
				durationMs: 0,
				verdict: "pass",
				summary: "synthetic",
				metrics: {
					passRate: input.passRate ?? 0.65,
					passCount: 100,
					applicableTotal: 153,
					applicableRate: input.applicableRate ?? 0.85,
					tierBreakdown: {
						"demo-critical": { passRate: input.demoCriticalPassRate ?? 1 },
					},
					categoryBreakdown: {
						"work-lineage": { passRate: input.workLineagePassRate ?? 0.7 },
						"file-level": { passRate: input.fileLevelPassRate ?? 0.85 },
						"hard-negative": { passRate: input.hardNegativePassRate ?? 0 },
					},
					scores: input.scores,
				},
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig: row(input).runConfig,
		runConfigFingerprint: input.fingerprint ?? FP,
		fingerprintVersion: 1,
		costComparable: { value: true, reasons: [] },
	};
}

function makeLoader(byPath: Map<string, ExtendedDogfoodReport>) {
	return (r: RunLogRow) => byPath.get(r.reportPath ?? "") ?? null;
}

const ALL_PASS_FIXTURES: ScoreFixture[] = Array.from({ length: 50 }, (_, i) => ({
	id: `q-${i}`,
	passed: true,
}));
const STABLE_75 = (n = 100): ScoreFixture[] =>
	Array.from({ length: n }, (_, i) => ({ id: `q-${i}`, passed: i < n * 0.75 }));
const STABLE_60 = (n = 100): ScoreFixture[] =>
	Array.from({ length: n }, (_, i) => ({ id: `q-${i}`, passed: i < n * 0.6 }));

describe("detectRegression", () => {
	it("returns insufficient-history when no rows match", () => {
		const out = detectRegression({
			rows: [],
			variantId: VARIANT,
			corpora: [CORPUS],
		});
		expect(out.status).toBe("insufficient-history");
	});

	it("returns insufficient-history when baseline window too small", () => {
		const fixtures: RowFixture[] = [
			{ sweepId: "s1", loggedAt: "2026-04-25T03:00:00Z", scores: STABLE_75() },
			{ sweepId: "s2", loggedAt: "2026-04-26T03:00:00Z", scores: STABLE_75() },
		];
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("insufficient-history");
		expect(out.corpora[0]?.baselineCount).toBe(1);
	});

	it("returns ok when latest run matches baseline", () => {
		const fixtures: RowFixture[] = Array.from({ length: 5 }, (_, i) => ({
			sweepId: `s${i}`,
			loggedAt: `2026-04-2${5 + i}T03:00:00Z`,
			scores: STABLE_75(),
			passRate: 0.75,
		}));
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("ok");
		expect(out.findings).toHaveLength(0);
	});

	it("flags a breach when overall pass rate falls below floor", () => {
		const fixtures: RowFixture[] = [
			{ sweepId: "s1", loggedAt: "2026-04-25T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "s2", loggedAt: "2026-04-26T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "s3", loggedAt: "2026-04-27T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "s4", loggedAt: "2026-04-28T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			// latest collapses below 0.55 floor
			{
				sweepId: "s5",
				loggedAt: "2026-04-29T03:00:00Z",
				scores: Array.from({ length: 100 }, (_, i) => ({ id: `q-${i}`, passed: i < 30 })),
				passRate: 0.3,
			},
		];
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(["breach", "both"]).toContain(out.status);
		const overall = out.findings.find((f) => f.type === "breach" && f.metric === "overall");
		expect(overall).toBeDefined();
		expect(overall?.latestValue).toBe(0.3);
	});

	it("does not false-positive on noise (stable 75% across 5 nights)", () => {
		// Reuse the SAME score array across all baseline + latest. Identical
		// score arrays produce zero per-family delta, hence probBgreaterA=0
		// on strict d>0. This is the noise-immunity test the design called
		// for.
		const stable = STABLE_75();
		const fixtures: RowFixture[] = Array.from({ length: 5 }, (_, i) => ({
			sweepId: `s${i}`,
			loggedAt: `2026-04-2${5 + i}T03:00:00Z`,
			scores: stable,
			passRate: 0.75,
		}));
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("ok");
		expect(
			out.findings.filter((f) => f.type === "regression"),
		).toHaveLength(0);
	});

	it("flags a regression when a synthetic bad run drops 75% → 60% with majority of baseline", () => {
		const fixtures: RowFixture[] = [
			{ sweepId: "b1", loggedAt: "2026-04-25T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b2", loggedAt: "2026-04-26T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b3", loggedAt: "2026-04-27T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b4", loggedAt: "2026-04-28T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			// latest drops to 60% with the SAME query ids — pure regression
			{ sweepId: "bad", loggedAt: "2026-04-29T03:00:00Z", scores: STABLE_60(), passRate: 0.6 },
		];
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		// Could be "regression" or "both" if a gate also breaks; we just
		// require regression to be flagged.
		expect(out.findings.some((f) => f.type === "regression")).toBe(true);
		const reg = out.findings.find((f) => f.type === "regression");
		expect(reg?.bootstrapMeanDelta).toBeGreaterThanOrEqual(REGRESSION_MIN_MEAN_DELTA);
		expect(reg?.probBgreaterA).toBeGreaterThanOrEqual(REGRESSION_MIN_PROB);
		expect(reg?.baselineSweepIds?.length).toBeGreaterThanOrEqual(3);
	});

	it("treats fingerprint mismatch as baseline rollover (insufficient history)", () => {
		const fixtures: RowFixture[] = [
			// Old fingerprint
			{ sweepId: "o1", loggedAt: "2026-04-20T03:00:00Z", scores: STABLE_75(), fingerprint: "old-fp" },
			{ sweepId: "o2", loggedAt: "2026-04-21T03:00:00Z", scores: STABLE_75(), fingerprint: "old-fp" },
			{ sweepId: "o3", loggedAt: "2026-04-22T03:00:00Z", scores: STABLE_75(), fingerprint: "old-fp" },
			// New fingerprint, only 1 run so far
			{ sweepId: "n1", loggedAt: "2026-04-29T03:00:00Z", scores: STABLE_60(), fingerprint: "new-fp", passRate: 0.6 },
		];
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("insufficient-history");
		expect(out.notes.some((n) => n.includes("rollover"))).toBe(true);
	});

	it("detects regression on secondary corpus when primary is clean", () => {
		const SECONDARY = "wtfoc-dogfood-2026-04-v3";
		const primary: RowFixture[] = Array.from({ length: 5 }, (_, i) => ({
			sweepId: `p${i}`,
			loggedAt: `2026-04-2${5 + i}T03:00:00Z`,
			scores: STABLE_75(),
			passRate: 0.75,
		}));
		const secondary: RowFixture[] = [
			{ sweepId: "sb1", loggedAt: "2026-04-25T03:01:00Z", scores: STABLE_75(), passRate: 0.75, corpus: SECONDARY },
			{ sweepId: "sb2", loggedAt: "2026-04-26T03:01:00Z", scores: STABLE_75(), passRate: 0.75, corpus: SECONDARY },
			{ sweepId: "sb3", loggedAt: "2026-04-27T03:01:00Z", scores: STABLE_75(), passRate: 0.75, corpus: SECONDARY },
			{ sweepId: "sb4", loggedAt: "2026-04-28T03:01:00Z", scores: STABLE_75(), passRate: 0.75, corpus: SECONDARY },
			{ sweepId: "sbBad", loggedAt: "2026-04-29T03:01:00Z", scores: STABLE_60(), passRate: 0.6, corpus: SECONDARY },
		];
		const all = [...primary, ...secondary];
		const reports = new Map(all.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: all.map(row),
			variantId: VARIANT,
			corpora: [CORPUS, SECONDARY],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(["regression", "both"]).toContain(out.status);
		expect(out.corpora).toHaveLength(2);
		const primaryCorpus = out.corpora.find((c) => c.corpus === CORPUS);
		const secondaryCorpus = out.corpora.find((c) => c.corpus === SECONDARY);
		expect(primaryCorpus?.status).toBe("ok");
		expect(["regression", "both"]).toContain(secondaryCorpus?.status ?? "");
		expect(out.findings.every((f) => f.corpus === SECONDARY)).toBe(true);
	});

	it("treats missing baseline reports as insufficient-history (does not silently report ok)", () => {
		// 4 baseline rows, but reports map intentionally omits 3 of them so
		// only 1 is loadable. With minBaseline=3, the regression check must
		// NOT silently emit "ok" — it should surface the loss of coverage.
		const fixtures: RowFixture[] = [
			{ sweepId: "b1", loggedAt: "2026-04-25T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b2", loggedAt: "2026-04-26T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b3", loggedAt: "2026-04-27T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "b4", loggedAt: "2026-04-28T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
			{ sweepId: "latest", loggedAt: "2026-04-29T03:00:00Z", scores: STABLE_75(), passRate: 0.75 },
		];
		// Only b1 + latest have reports; b2/b3/b4 missing → unloadable.
		const reports = new Map([
			[`/virtual/b1.json`, reportFor(fixtures[0]!)],
			[`/virtual/latest.json`, reportFor(fixtures[4]!)],
		]);
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("insufficient-history");
		expect(
			out.notes.some((n) => n.includes("usable for paired bootstrap")),
		).toBe(true);
	});

	it("filters by stage tag when supplied", () => {
		const fixtures: RowFixture[] = [
			{ sweepId: "manual1", loggedAt: "2026-04-25T03:00:00Z", scores: STABLE_75(), stage: "discovery" },
			{ sweepId: "manual2", loggedAt: "2026-04-26T03:00:00Z", scores: STABLE_75(), stage: "discovery" },
			{ sweepId: "manual3", loggedAt: "2026-04-27T03:00:00Z", scores: STABLE_75(), stage: "discovery" },
			{ sweepId: "n1", loggedAt: "2026-04-28T03:00:00Z", scores: STABLE_75(), stage: "nightly-cron" },
		];
		const reports = new Map(fixtures.map((f) => [`/virtual/${f.sweepId}.json`, reportFor(f)]));
		const out = detectRegression({
			rows: fixtures.map(row),
			variantId: VARIANT,
			corpora: [CORPUS],
			stage: "nightly-cron",
			minBaseline: 3,
			loadReport: makeLoader(reports),
		});
		expect(out.status).toBe("insufficient-history");
		expect(out.corpora[0]?.baselineCount).toBe(0);
	});
});
