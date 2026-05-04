import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import { type HardGates } from "./decision.js";
import { BRIDGE_GATES, PRIMARY_CORPUS, verifySp1 } from "./gate3-seeded-positive.js";

const runConfig: RunConfig = {
	collectionId: "test",
	corpusDigest: "abc",
	goldFixtureVersion: "2.0.0",
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

function alignedScore(id: string, passed: boolean) {
	return {
		id,
		category: "synthesis",
		queryText: id,
		passed,
		passedQueryOnly: passed,
		requiredTypesFound: true,
		requiredTypesFoundQueryOnly: true,
		resultCount: 10,
		substringFound: true,
		edgeHopFound: true,
		crossSourceFound: true,
		sourceTypesReached: [] as string[],
		lineage: null,
		distinctDocs: 5,
		distinctSourceTypes: 3,
		recallAtK: null,
		recallK: null,
		topScore: null,
	};
}

function makeReport(opts: {
	passRate: number;
	scores: ReturnType<typeof alignedScore>[];
	applicableRate?: number;
	workLineage?: number;
	fileLevel?: number;
	demoCritical?: number;
}): ExtendedDogfoodReport {
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
				metrics: {
					passRate: opts.passRate,
					applicableRate: opts.applicableRate ?? 0.6,
					tierBreakdown: { "demo-critical": { passRate: opts.demoCritical ?? 0 } },
					categoryBreakdown: {
						"work-lineage": { passRate: opts.workLineage ?? 0.5 },
						"file-level": { passRate: opts.fileLevel ?? 0.7 },
						"hard-negative": { passRate: 0 },
					},
					paraphraseInvariance: { checked: false, invariantFraction: 0 },
					scores: opts.scores,
				},
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig,
		runConfigFingerprint: "fp",
		fingerprintVersion: 1,
	};
}

/** Build paired baseline/candidate scores. `flips` controls how many
 * queries flip fail→pass between baseline and candidate. */
function pairedScores(total: number, baselinePassed: number, flips: number) {
	const ids = Array.from({ length: total }, (_, i) => `q${i}`);
	const baseline = ids.map((id, i) => alignedScore(id, i < baselinePassed));
	const candidate = ids.map((id, i) =>
		alignedScore(id, i < baselinePassed || (i >= baselinePassed && i < baselinePassed + flips)),
	);
	return { baseline, candidate };
}

describe("gate3 seeded-positive verifier", () => {
	it("accepts when primary corpus shows confident lift + auxiliary directional positive", () => {
		// Primary: 100 queries, 40 → 50 (+10pp lift, all flips real)
		const primary = pairedScores(100, 40, 10);
		// Auxiliary: 50 queries, 30 → 31 (+2pp directional but underpowered)
		const aux = pairedScores(50, 30, 1);

		const baseline = new Map<string, ExtendedDogfoodReport>([
			[
				PRIMARY_CORPUS,
				makeReport({ passRate: 0.4, scores: primary.baseline }),
			],
			[
				"wtfoc-dogfood-2026-04-v3",
				makeReport({ passRate: 0.6, scores: aux.baseline }),
			],
		]);
		const candidate = new Map<string, ExtendedDogfoodReport>([
			[
				PRIMARY_CORPUS,
				makeReport({ passRate: 0.5, scores: primary.candidate }),
			],
			[
				"wtfoc-dogfood-2026-04-v3",
				makeReport({ passRate: 0.62, scores: aux.candidate }),
			],
		]);

		const result = verifySp1({
			baseline,
			candidate,
			gates: BRIDGE_GATES,
			primaryCorpus: PRIMARY_CORPUS,
		});

		expect(result.multi.accept).toBe(true);
		expect(result.primaryBootstrapPass).toBe(true);
		expect(result.auxiliaryDirectional).toBe(true);
		expect(result.accept).toBe(true);
	});

	it("rejects when primary corpus bootstrap underpowered (small lift)", () => {
		// Primary lift is only +2pp (underpowered), should fail primary bootstrap
		const primary = pairedScores(100, 40, 2);
		const aux = pairedScores(50, 30, 5);

		const baseline = new Map<string, ExtendedDogfoodReport>([
			[PRIMARY_CORPUS, makeReport({ passRate: 0.4, scores: primary.baseline })],
			["wtfoc-dogfood-2026-04-v3", makeReport({ passRate: 0.6, scores: aux.baseline })],
		]);
		const candidate = new Map<string, ExtendedDogfoodReport>([
			[PRIMARY_CORPUS, makeReport({ passRate: 0.42, scores: primary.candidate })],
			["wtfoc-dogfood-2026-04-v3", makeReport({ passRate: 0.7, scores: aux.candidate })],
		]);

		const result = verifySp1({
			baseline,
			candidate,
			gates: BRIDGE_GATES,
			primaryCorpus: PRIMARY_CORPUS,
		});

		expect(result.primaryBootstrapPass).toBe(false);
		expect(result.accept).toBe(false);
	});

	it("rejects when auxiliary regresses (negative directional)", () => {
		const primary = pairedScores(100, 40, 10);
		// Auxiliary regression: candidate has fewer passes than baseline
		const auxBaseline = pairedScores(50, 35, 0).baseline;
		const auxCandidate = pairedScores(50, 30, 0).baseline;

		const baseline = new Map<string, ExtendedDogfoodReport>([
			[PRIMARY_CORPUS, makeReport({ passRate: 0.4, scores: primary.baseline })],
			["wtfoc-dogfood-2026-04-v3", makeReport({ passRate: 0.7, scores: auxBaseline })],
		]);
		const candidate = new Map<string, ExtendedDogfoodReport>([
			[PRIMARY_CORPUS, makeReport({ passRate: 0.5, scores: primary.candidate })],
			["wtfoc-dogfood-2026-04-v3", makeReport({ passRate: 0.6, scores: auxCandidate })],
		]);

		const result = verifySp1({
			baseline,
			candidate,
			gates: BRIDGE_GATES,
			primaryCorpus: PRIMARY_CORPUS,
		});

		expect(result.auxiliaryDirectional).toBe(false);
		expect(result.accept).toBe(false);
	});

	it("rejects when bridge gate fails (e.g., applicableRate floor)", () => {
		const primary = pairedScores(100, 40, 10);
		const aux = pairedScores(50, 30, 5);

		const baseline = new Map<string, ExtendedDogfoodReport>([
			[
				PRIMARY_CORPUS,
				makeReport({ passRate: 0.4, applicableRate: 0.6, scores: primary.baseline }),
			],
			[
				"wtfoc-dogfood-2026-04-v3",
				makeReport({ passRate: 0.6, applicableRate: 0.6, scores: aux.baseline }),
			],
		]);
		// candidate has applicableRate 0.4 — below BRIDGE_GATES.applicableRateMin=0.5
		const candidate = new Map<string, ExtendedDogfoodReport>([
			[
				PRIMARY_CORPUS,
				makeReport({ passRate: 0.5, applicableRate: 0.4, scores: primary.candidate }),
			],
			[
				"wtfoc-dogfood-2026-04-v3",
				makeReport({ passRate: 0.7, applicableRate: 0.4, scores: aux.candidate }),
			],
		]);

		const result = verifySp1({
			baseline,
			candidate,
			gates: BRIDGE_GATES,
			primaryCorpus: PRIMARY_CORPUS,
		});

		expect(result.multi.accept).toBe(false);
		expect(result.accept).toBe(false);
	});

	it("BRIDGE_GATES.demoCriticalMin=0 — auxiliary corpus with no demo-critical tier passes", () => {
		// Regression check: previous version of bridge gates had
		// demoCriticalMin=0.33 which falsely tripped on dogfood corpus
		// (no demo-critical queries; passRate defaults to 0).
		const gates: HardGates = { ...BRIDGE_GATES };
		expect(gates.demoCriticalMin).toBe(0);
	});
});
