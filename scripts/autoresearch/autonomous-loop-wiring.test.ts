import type {
	DiagnosisAggregate,
	FailureLayer,
	FixtureHealthSignal,
} from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import {
	decideLoopAction,
	extractDominantLayer,
	extractFixtureHealthSignal,
} from "./autonomous-loop.js";
import { selectPatchCapsule } from "./patch-capsule.js";

/**
 * Wiring integration test for the diagnosis -> capsule routing path
 * (#344 step 5 / #350). Exercises the same function chain `runPatchPath`
 * uses, so a regression that breaks the routing surfaces here in CI
 * without needing a live LLM or homelab GPU.
 *
 * The end-to-end live validation lives in step 6 of #344 and runs against
 * the real autoresearch loop on the maintainer's homelab.
 */

function makeReport(
	dominantLayer: FailureLayer | null,
	overrides?: Partial<DiagnosisAggregate>,
): ExtendedDogfoodReport {
	const aggregate: DiagnosisAggregate = {
		totalFailures: dominantLayer === null ? 0 : 5,
		byFailureClass: {
			"fixture-invalid": 0,
			"gold-not-indexed": 0,
			"retrieved-not-ranked": 0,
			"missing-edge": 0,
			"answer-synthesis": 0,
			"hard-negative-violated": 0,
		},
		byLayer: {
			fixture: 0,
			ingest: 0,
			chunking: 0,
			embedding: 0,
			"edge-extraction": 0,
			ranking: 0,
			trace: 0,
		},
		dominantLayer,
		dominantLayerShare: dominantLayer === null ? 0 : 1,
		...overrides,
	};
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: "alpha",
		collectionName: "alpha",
		stages: [
			{
				stage: "quality-queries",
				startedAt: "",
				durationMs: 0,
				verdict: "pass",
				summary: "",
				metrics: { diagnosisAggregate: aggregate },
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig: {
			collectionId: "alpha",
			corpusDigest: "x",
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
				diversityEnforce: false,
			},
			evaluation: { checkParaphrases: false, groundCheck: false },
			promptHashes: {},
			seed: 0,
			gitSha: null,
			packageVersions: {},
			nodeVersion: "24.11",
			cacheNamespaceSchemeVersion: 1,
		},
		runConfigFingerprint: "fp",
		fingerprintVersion: 1,
	};
}

describe("extractDominantLayer", () => {
	it("returns null when the report is null", () => {
		expect(extractDominantLayer(null)).toBeNull();
	});

	it("returns null when there is no quality-queries stage", () => {
		const report = makeReport("ranking");
		report.stages = [];
		expect(extractDominantLayer(report)).toBeNull();
	});

	it("returns null when the stage has no diagnosisAggregate (older report)", () => {
		const report = makeReport("ranking");
		const stage = report.stages[0];
		if (stage) stage.metrics = {};
		expect(extractDominantLayer(report)).toBeNull();
	});

	it("extracts the dominantLayer from a current report", () => {
		expect(extractDominantLayer(makeReport("ranking"))).toBe("ranking");
		expect(extractDominantLayer(makeReport("chunking"))).toBe("chunking");
		expect(extractDominantLayer(makeReport("fixture"))).toBe("fixture");
		expect(extractDominantLayer(makeReport(null))).toBeNull();
	});
});

describe("diagnosis -> capsule routing chain", () => {
	it("routes fixture-dominant report to a null capsule (skip cycle)", () => {
		const report = makeReport("fixture");
		const layer = extractDominantLayer(report);
		expect(selectPatchCapsule(layer)).toBeNull();
	});

	it("routes ingest-dominant report to a null capsule (human-only)", () => {
		const report = makeReport("ingest");
		const layer = extractDominantLayer(report);
		expect(selectPatchCapsule(layer)).toBeNull();
	});

	it("routes ranking-dominant report to Tier 1 capsule with the legacy curatedFiles", () => {
		const report = makeReport("ranking");
		const capsule = selectPatchCapsule(extractDominantLayer(report));
		expect(capsule?.tiers).toEqual([1]);
		expect(capsule?.curatedFiles).toContain("packages/search/src/query.ts");
		expect(capsule?.curatedFiles).toContain("packages/search/src/trace/trace.ts");
	});

	it("routes chunking-dominant report to Tier 1+2 capsule", () => {
		const capsule = selectPatchCapsule(extractDominantLayer(makeReport("chunking")));
		expect(capsule?.tiers).toEqual([1, 2]);
	});

	it("routes edge-extraction-dominant report to Tier 1+3 capsule", () => {
		const capsule = selectPatchCapsule(extractDominantLayer(makeReport("edge-extraction")));
		expect(capsule?.tiers).toEqual([1, 3]);
	});

	it("falls back to no capsule when the report carries no diagnosis (older sweep)", () => {
		const report = makeReport("ranking");
		const stage = report.stages[0];
		if (stage) stage.metrics = {};
		const layer = extractDominantLayer(report);
		expect(layer).toBeNull();
		// `selectPatchCapsule(null)` returns null — the loop's wiring then
		// falls through to analyzeAndProposePatch's built-in defaults rather
		// than skipping the cycle (backwards compat for pre-#347 reports).
		expect(selectPatchCapsule(layer)).toBeNull();
	});
});

function makeFixtureHealthSignal(
	overrides: Partial<FixtureHealthSignal> = {},
): FixtureHealthSignal {
	return {
		collectionId: "alpha",
		coverage: {
			totalQueries: 1,
			semantic: [],
			structural: [],
			uncoveredStrata: [],
			giniCoefficient: 0,
		},
		hasCoverageGap: false,
		thresholds: { giniFloor: 0.6, minUncoveredStrata: 3 },
		...overrides,
	};
}

describe("extractFixtureHealthSignal", () => {
	it("returns null when the report is null", () => {
		expect(extractFixtureHealthSignal(null)).toBeNull();
	});

	it("returns null when the stage has no fixtureHealthSignal", () => {
		const report = makeReport("ranking");
		expect(extractFixtureHealthSignal(report)).toBeNull();
	});

	it("returns null when the report has no quality-queries stage (older / partial report)", () => {
		const report = makeReport("ranking");
		report.stages = [];
		expect(extractFixtureHealthSignal(report)).toBeNull();
	});

	it("extracts a fixtureHealthSignal when present in metrics", () => {
		const report = makeReport("ranking");
		const stage = report.stages[0];
		const signal = makeFixtureHealthSignal({ hasCoverageGap: true });
		if (stage)
			stage.metrics = { ...stage.metrics, fixtureHealthSignal: signal } as Record<
				string,
				unknown
			>;
		expect(extractFixtureHealthSignal(report)?.hasCoverageGap).toBe(true);
	});
});

describe("decideLoopAction (#360 routing)", () => {
	it("tryPatch=true when dominantLayer is set", () => {
		const d = decideLoopAction({ dominantLayer: "ranking", fixtureHealth: null });
		expect(d.tryPatch).toBe(true);
		expect(d.tryFixtureExpand).toBe(false);
	});

	it("tryFixtureExpand=true when fixtureHealth.hasCoverageGap", () => {
		const d = decideLoopAction({
			dominantLayer: null,
			fixtureHealth: makeFixtureHealthSignal({ hasCoverageGap: true }),
		});
		expect(d.tryFixtureExpand).toBe(true);
		expect(d.tryPatch).toBe(false);
	});

	it("both true when dominantLayer set AND coverage gap present (orthogonal signals)", () => {
		const d = decideLoopAction({
			dominantLayer: "ranking",
			fixtureHealth: makeFixtureHealthSignal({ hasCoverageGap: true }),
		});
		expect(d.tryPatch).toBe(true);
		expect(d.tryFixtureExpand).toBe(true);
	});

	it("both false when neither signal present (clean cycle, fall through to variant flow)", () => {
		const d = decideLoopAction({ dominantLayer: null, fixtureHealth: null });
		expect(d.tryPatch).toBe(false);
		expect(d.tryFixtureExpand).toBe(false);
	});

	it("rationale includes both inputs", () => {
		const d = decideLoopAction({
			dominantLayer: "ranking",
			fixtureHealth: makeFixtureHealthSignal({ hasCoverageGap: false }),
		});
		expect(d.rationale).toContain("dominantLayer=ranking");
		expect(d.rationale).toContain("coverage(");
	});

	it("rationale flags signal-unavailable when fixtureHealth is null", () => {
		const d = decideLoopAction({ dominantLayer: "ranking", fixtureHealth: null });
		expect(d.rationale).toContain("coverage=signal-unavailable");
	});
});
