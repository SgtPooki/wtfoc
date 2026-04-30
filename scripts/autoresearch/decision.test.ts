import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import { decide, DEFAULT_GATES } from "./decision.js";

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
		const verdict = decide({
			baseline: makeReport({ scores: baseScores }),
			candidate: makeReport({
				scores: candScores,
				demoCritical: 0.6, // <100% — hard gate fail
				costComparable: { value: true, reasons: [] },
			}),
			bootstrapIterations: 2000,
			rng: seededRng(7),
		});
		expect(verdict.accept).toBe(false);
		expect(verdict.reasons.some((r) => r.includes("demoCritical"))).toBe(true);
	});

	it("REJECTS when costComparable is false", () => {
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
		expect(verdict.accept).toBe(false);
		expect(verdict.reasons.some((r) => r.includes("costComparable"))).toBe(true);
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
		expect(DEFAULT_GATES.demoCriticalMin).toBe(1);
	});
});
