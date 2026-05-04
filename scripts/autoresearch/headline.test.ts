import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport, RunConfig } from "../lib/run-config.js";
import { DEFAULT_GATES } from "./decision.js";
import { computeHeadline } from "./headline.js";

const baseConfig: RunConfig = {
	collectionId: "t",
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
	portable?: number;
	overall?: number;
	demoCritical?: number;
	workLineage?: number;
	fileLevel?: number;
	hardNegative?: number;
	paraphraseInvariant?: number | null;
	applicableRate?: number;
}): ExtendedDogfoodReport {
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: "",
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
					passRate: opts.overall ?? 0.7,
					applicableRate: opts.applicableRate ?? 1,
					portabilityBreakdown: { portable: { passRate: opts.portable ?? 0.5 } },
					tierBreakdown: { "demo-critical": { passRate: opts.demoCritical ?? 1 } },
					categoryBreakdown: {
						"work-lineage": { passRate: opts.workLineage ?? 0.7 },
						"file-level": { passRate: opts.fileLevel ?? 0.8 },
						"hard-negative": { passRate: opts.hardNegative ?? 0 },
					},
					paraphraseInvariance:
						opts.paraphraseInvariant === null
							? { checked: false, invariantFraction: 0 }
							: { checked: true, invariantFraction: opts.paraphraseInvariant ?? 0.81 },
				},
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig: baseConfig,
		runConfigFingerprint: "fp",
		fingerprintVersion: 1,
	};
}

describe("computeHeadline", () => {
	it("computes geo-mean of portable rates across two corpora", () => {
		const headline = computeHeadline({
			v12: makeReport({ portable: 0.8 }),
			v3: makeReport({ portable: 0.5 }),
		});
		expect(headline.scalar).toBeCloseTo(Math.sqrt(0.8 * 0.5), 6);
		expect(headline.singleCorpus).toBe(false);
		expect(headline.portableV12).toBe(0.8);
		expect(headline.portableV3).toBe(0.5);
	});

	it("falls back to portable_v12 when v3 absent", () => {
		const headline = computeHeadline({ v12: makeReport({ portable: 0.46 }) });
		expect(headline.scalar).toBe(0.46);
		expect(headline.singleCorpus).toBe(true);
		expect(headline.portableV3).toBeNull();
	});

	it("flags every gate ok when v12 passes default floors", () => {
		const headline = computeHeadline({
			v12: makeReport({
				overall: 0.7,
				portable: 0.5,
				demoCritical: 1,
				workLineage: 0.8,
				fileLevel: 0.8,
				hardNegative: 0.1,
				paraphraseInvariant: 0.85,
			}),
		});
		expect(headline.allGatesPassed).toBe(true);
		for (const g of headline.gates) expect(g.ok).toBe(true);
	});

	it("flags failing gates by name", () => {
		// DEFAULT_GATES.demoCriticalMin is 0 post-recalibration (#364, 2026-05-04);
		// override to test the gate-flagging path.
		const headline = computeHeadline({
			v12: makeReport({ demoCritical: 0.6 }),
			gates: { ...DEFAULT_GATES, demoCriticalMin: 0.67 },
		});
		expect(headline.allGatesPassed).toBe(false);
		const dc = headline.gates.find((g) => g.name === "demoCritical");
		expect(dc?.ok).toBe(false);
		expect(dc?.actual).toBeCloseTo(0.6);
	});

	it("does not gate on paraphraseInvariant when checks were not run", () => {
		const headline = computeHeadline({
			v12: makeReport({ paraphraseInvariant: null }),
		});
		const names = headline.gates.map((g) => g.name);
		expect(names).not.toContain("paraphraseInvariant");
	});

	it("scalar == 0 when portable passes are 0", () => {
		const headline = computeHeadline({
			v12: makeReport({ portable: 0 }),
			v3: makeReport({ portable: 0.5 }),
		});
		expect(headline.scalar).toBe(0);
	});
});
