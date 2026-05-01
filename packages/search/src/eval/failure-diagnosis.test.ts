import { describe, expect, it } from "vitest";
import {
	aggregateDiagnoses,
	type DiagnosisScoreInput,
	diagnoseFailure,
} from "./failure-diagnosis.js";
import type { GoldQuery } from "./gold-standard-queries.js";

function makeQuery(partial: Partial<GoldQuery> & { id: string }): GoldQuery {
	return {
		authoredFromCollectionId: "alpha",
		applicableCorpora: ["alpha"],
		query: "q",
		queryType: "lookup",
		difficulty: "easy",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 1,
		...partial,
	};
}

function makeScore(partial: Partial<DiagnosisScoreInput> & { id: string }): DiagnosisScoreInput {
	return {
		passed: false,
		passedQueryOnly: false,
		resultCount: 0,
		requiredTypesFound: false,
		substringFound: false,
		edgeHopFound: true,
		crossSourceFound: true,
		...partial,
	};
}

describe("diagnoseFailure", () => {
	it("returns null when the query passed", () => {
		const result = diagnoseFailure({
			score: makeScore({ id: "q1", passed: true, passedQueryOnly: true }),
			query: makeQuery({ id: "q1" }),
		});
		expect(result).toBeNull();
	});

	it("returns null when the query was skipped", () => {
		const result = diagnoseFailure({
			score: makeScore({ id: "q1", skipped: true }),
			query: makeQuery({ id: "q1" }),
		});
		expect(result).toBeNull();
	});

	it("classifies preflight-invalid as fixture-invalid + fixture layer", () => {
		const result = diagnoseFailure({
			score: makeScore({ id: "q1" }),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "invalid",
			corpusId: "alpha",
		});
		expect(result?.failureClass).toBe("fixture-invalid");
		expect(result?.layer).toBe("fixture");
		expect(result?.evidence.goldInCatalog).toBe(false);
		expect(result?.corpusId).toBe("alpha");
	});

	it("classifies a failed hard-negative as hard-negative-violated", () => {
		const result = diagnoseFailure({
			score: makeScore({ id: "hn-1" }),
			query: makeQuery({ id: "hn-1", isHardNegative: true }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("hard-negative-violated");
		expect(result?.layer).toBe("ranking");
	});

	it("classifies absent-from-widerK as gold-not-indexed + embedding layer", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				goldProximity: {
					widerK: 50,
					topKCutoff: 10,
					goldRank: null,
					goldScore: null,
					topKLastScore: 0.4,
				},
			}),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("gold-not-indexed");
		expect(result?.layer).toBe("embedding");
		expect(result?.evidence.retrievedInWiderK).toBe(false);
	});

	it("classifies retrieved-but-below-cutoff as retrieved-not-ranked + ranking layer", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				goldProximity: {
					widerK: 50,
					topKCutoff: 10,
					goldRank: 14,
					goldScore: 0.7,
					topKLastScore: 0.5,
				},
			}),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("retrieved-not-ranked");
		expect(result?.layer).toBe("ranking");
		expect(result?.evidence.finalRank).toBe(14);
	});

	it("classifies query-only-pass-but-trace-fail as missing-edge + edge-extraction when edgeHop required", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				passed: false,
				passedQueryOnly: true,
				requiredTypesFound: true,
				substringFound: true,
				edgeHopFound: false,
			}),
			query: makeQuery({ id: "q1", requireEdgeHop: true }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("missing-edge");
		expect(result?.layer).toBe("edge-extraction");
	});

	it("classifies query-only-pass-but-trace-fail as missing-edge + trace when no edgeHop required", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				passed: false,
				passedQueryOnly: true,
				requiredTypesFound: true,
				substringFound: true,
				crossSourceFound: false,
			}),
			query: makeQuery({ id: "q1", requireCrossSourceHops: true }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("missing-edge");
		expect(result?.layer).toBe("trace");
	});

	it("classifies missing-substring as retrieved-not-ranked + ranking", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				resultCount: 5,
				requiredTypesFound: true,
				substringFound: false,
			}),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("retrieved-not-ranked");
		expect(result?.layer).toBe("ranking");
	});

	it("falls through to answer-synthesis + trace when the rubric is otherwise satisfied", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				resultCount: 5,
				requiredTypesFound: true,
				substringFound: true,
				edgeHopFound: true,
				crossSourceFound: false,
			}),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "applicable",
		});
		expect(result?.failureClass).toBe("answer-synthesis");
		expect(result?.layer).toBe("trace");
	});

	it("populates evidence.retrievedInWiderK as null when goldProximity is unrecorded", () => {
		const result = diagnoseFailure({
			score: makeScore({
				id: "q1",
				resultCount: 1,
				substringFound: false,
			}),
			query: makeQuery({ id: "q1" }),
			preflightStatus: "applicable",
		});
		expect(result?.evidence.retrievedInWiderK).toBeNull();
	});
});

describe("aggregateDiagnoses", () => {
	it("counts per-class and per-layer totals", () => {
		const agg = aggregateDiagnoses([
			{
				queryId: "q1",
				corpusId: "alpha",
				failureClass: "fixture-invalid",
				layer: "fixture",
				evidence: {} as never,
			},
			{
				queryId: "q2",
				corpusId: "alpha",
				failureClass: "retrieved-not-ranked",
				layer: "ranking",
				evidence: {} as never,
			},
			{
				queryId: "q3",
				corpusId: "alpha",
				failureClass: "retrieved-not-ranked",
				layer: "ranking",
				evidence: {} as never,
			},
		]);
		expect(agg.totalFailures).toBe(3);
		expect(agg.byFailureClass["retrieved-not-ranked"]).toBe(2);
		expect(agg.byFailureClass["fixture-invalid"]).toBe(1);
		expect(agg.byLayer.ranking).toBe(2);
		expect(agg.byLayer.fixture).toBe(1);
		expect(agg.dominantLayer).toBe("ranking");
		expect(agg.dominantLayerShare).toBeCloseTo(2 / 3);
	});

	it("returns dominantLayer null when no diagnoses", () => {
		const agg = aggregateDiagnoses([]);
		expect(agg.totalFailures).toBe(0);
		expect(agg.dominantLayer).toBeNull();
		expect(agg.dominantLayerShare).toBe(0);
	});
});
