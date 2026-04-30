import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import type { Finding } from "./detect-regression.js";
import { explainFinding } from "./explain-finding.js";

function runConfig(): RunConfig {
	return {
		collectionId: "x",
		corpusDigest: "d",
		goldFixtureVersion: "1.9.0",
		goldFixtureHash: "h",
		embedder: { url: "http://x/v1", model: "m" },
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
}

interface ScoreFixture {
	id: string;
	passed: boolean;
	question?: string;
	tier?: string;
	category?: string;
	expectedSources?: string[];
	retrieved?: Array<{ source?: string; sourceType?: string; score?: number; excerpt?: string }>;
	goldProximity?: {
		widerK: number;
		topKCutoff: number;
		goldRank: number | null;
		goldScore: number | null;
		topKLastScore: number | null;
	};
}

function report(scores: ScoreFixture[], passRate = 0.6): ExtendedDogfoodReport {
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: "2026-04-30T00:00:00Z",
		collectionId: "x",
		collectionName: "x",
		stages: [
			{
				stage: "quality-queries",
				startedAt: "2026-04-30T00:00:00Z",
				durationMs: 0,
				verdict: "pass",
				summary: "synthetic",
				metrics: {
					passRate,
					applicableTotal: scores.length,
					applicableRate: 0.85,
					tierBreakdown: { "demo-critical": { passRate: 1 } },
					categoryBreakdown: {
						"work-lineage": { passRate: 0.6 },
						"file-level": { passRate: 0.85 },
						"hard-negative": { passRate: 0 },
					},
					recallAtK: { avgRecallAtK: 0.7 },
					timing: { embed: { p95Ms: 1200 } },
					scores,
				},
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig: runConfig(),
		runConfigFingerprint: "fp",
		fingerprintVersion: 1,
		costComparable: { value: true, reasons: [] },
	};
}

const finding: Finding = {
	type: "regression",
	variantId: "noar_div_rrOff",
	corpus: "filoz",
	corpusDigest: "d",
	fingerprint: "fp",
	fingerprintVersion: 1,
	metric: "passRate",
	latestValue: 0.6,
	bootstrapMeanDelta: 0.15,
	probBgreaterA: 0.99,
	latestSweepId: "bad",
	latestLoggedAt: "2026-04-30T00:00:00Z",
	reason: "synthetic",
};

describe("explainFinding", () => {
	it("includes identity, metrics, and flipped queries section", () => {
		const baselineScores: ScoreFixture[] = [
			{
				id: "q1",
				passed: true,
				question: "What is foo?",
				tier: "portable",
				category: "work-lineage",
				expectedSources: ["src/foo.ts"],
				retrieved: [{ source: "src/foo.ts", sourceType: "code", score: 0.9, excerpt: "foo def" }],
			},
			{ id: "q2", passed: true, question: "Q2", tier: "portable" },
		];
		const latestScores: ScoreFixture[] = [
			{
				id: "q1",
				passed: false, // flipped
				question: "What is foo?",
				tier: "portable",
				category: "work-lineage",
				expectedSources: ["src/foo.ts"],
				retrieved: [
					{ source: "src/bar.ts", sourceType: "code", score: 0.8, excerpt: "bar code" },
					{ source: "docs/foo.md", sourceType: "doc", score: 0.7, excerpt: "foo doc" },
				],
			},
			{ id: "q2", passed: true, question: "Q2", tier: "portable" },
		];
		const md = explainFinding({
			finding,
			latest: report(latestScores, 0.6),
			baseline: report(baselineScores, 0.75),
		});
		expect(md).toContain("# Autoresearch finding analysis context");
		expect(md).toContain("## Identity");
		expect(md).toContain("variant: `noar_div_rrOff`");
		expect(md).toContain("## Metrics");
		expect(md).toContain("Flipped queries");
		expect(md).toContain("`q1`");
		expect(md).not.toContain("`q2`"); // not flipped
		expect(md).toContain("Expected sources: src/foo.ts");
		expect(md).toContain("score=0.800");
	});

	it("breach finding without baseline still produces an output with breach section", () => {
		const breach: Finding = { ...finding, type: "breach", metric: "demoCritical", floor: 1 };
		const md = explainFinding({ finding: breach, latest: report([], 0.3) });
		expect(md).toContain("## Breach details");
		expect(md).toContain("gate: demoCritical");
	});

	it("renders gold-proximity verdict when gold ranked just past cutoff", () => {
		const baselineScores: ScoreFixture[] = [
			{ id: "q1", passed: true, question: "Q", tier: "portable" },
		];
		const latestScores: ScoreFixture[] = [
			{
				id: "q1",
				passed: false,
				question: "Q",
				tier: "portable",
				goldProximity: {
					widerK: 50,
					topKCutoff: 10,
					goldRank: 13,
					goldScore: 0.72,
					topKLastScore: 0.78,
				},
			},
		];
		const md = explainFinding({
			finding,
			latest: report(latestScores, 0.5),
			baseline: report(baselineScores, 1.0),
		});
		expect(md).toContain("Gold proximity:");
		expect(md).toContain("rank 13/50");
		expect(md).toContain("JUST PAST top-K cutoff");
	});

	it("renders gold-proximity 'absent' verdict when gold not in top-50", () => {
		const baselineScores: ScoreFixture[] = [
			{ id: "q1", passed: true, question: "Q", tier: "portable" },
		];
		const latestScores: ScoreFixture[] = [
			{
				id: "q1",
				passed: false,
				question: "Q",
				tier: "portable",
				goldProximity: {
					widerK: 50,
					topKCutoff: 10,
					goldRank: null,
					goldScore: null,
					topKLastScore: 0.78,
				},
			},
		];
		const md = explainFinding({
			finding,
			latest: report(latestScores, 0.5),
			baseline: report(baselineScores, 1.0),
		});
		expect(md).toContain("Gold proximity:");
		expect(md).toContain("NOT in top-50");
		expect(md).toContain("embedder/retrieval issue");
	});

	it("truncates output to maxChars", () => {
		const baselineScores: ScoreFixture[] = Array.from({ length: 100 }, (_, i) => ({
			id: `q${i}`,
			passed: true,
			question: `Question ${i} `.repeat(20),
		}));
		const latestScores: ScoreFixture[] = baselineScores.map((s) => ({ ...s, passed: false }));
		const md = explainFinding({
			finding,
			latest: report(latestScores, 0.0),
			baseline: report(baselineScores, 1.0),
			options: { maxChars: 1000 },
		});
		expect(md.length).toBeLessThanOrEqual(1000);
		expect(md).toContain("output truncated");
	});
});
