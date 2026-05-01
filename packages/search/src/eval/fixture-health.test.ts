import type { DocumentCatalog, Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import {
	buildCoverageReport,
	DEFAULT_GINI_FLOOR,
	DEFAULT_MIN_UNCOVERED_STRATA,
	deriveFixtureHealthSignal,
	estimateHopCount,
	giniCoefficient,
	inferOperatorFamily,
	isCrossSource,
} from "./fixture-health.js";
import type { GoldQuery } from "./gold-standard-queries.js";

function makeQuery(overrides: Partial<GoldQuery> = {}): GoldQuery {
	return {
		id: overrides.id ?? "q1",
		authoredFromCollectionId: "alpha",
		applicableCorpora: ["alpha"],
		query: "x",
		queryType: "lookup",
		difficulty: "easy",
		targetLayerHints: ["ranking"],
		expectedEvidence: [{ artifactId: "doc/x.ts", required: true }],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		...overrides,
	};
}

function makeCatalog(docs: Array<{ id: string; sourceType: string }>): DocumentCatalog {
	const documents: DocumentCatalog["documents"] = {};
	for (const d of docs) {
		documents[d.id] = {
			documentId: d.id,
			currentVersionId: "v1",
			previousVersionIds: [],
			chunkIds: [],
			supersededChunkIds: [],
			contentFingerprints: [],
			state: "active",
			mutability: "mutable-state",
			sourceType: d.sourceType,
			updatedAt: new Date().toISOString(),
		};
	}
	return { schemaVersion: 1, collectionId: "alpha", documents };
}

function makeSegment(edgeTypes: string[] = []): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 1,
		chunks: [],
		edges: edgeTypes.map((type) => ({
			type,
			sourceId: "a",
			targetType: "x",
			targetId: "b",
			evidence: "",
			confidence: 1,
		})),
	};
}

describe("inferOperatorFamily", () => {
	it("maps queryType 1:1", () => {
		expect(inferOperatorFamily("lookup")).toBe("lookup");
		expect(inferOperatorFamily("trace")).toBe("trace");
		expect(inferOperatorFamily("entity-resolution")).toBe("entity-resolution");
	});
});

describe("estimateHopCount", () => {
	it("lookup with single artifact = 1", () => {
		expect(estimateHopCount(makeQuery({ queryType: "lookup" }))).toBe(1);
	});
	it("trace with single artifact = 2 (min 2 for trace family)", () => {
		expect(estimateHopCount(makeQuery({ queryType: "trace" }))).toBe(2);
	});
	it("compare with 3 required artifacts = 3", () => {
		expect(
			estimateHopCount(
				makeQuery({
					queryType: "compare",
					expectedEvidence: [
						{ artifactId: "a", required: true },
						{ artifactId: "b", required: true },
						{ artifactId: "c", required: true },
					],
				}),
			),
		).toBe(3);
	});
});

describe("isCrossSource", () => {
	it("false for single source type", () => {
		expect(isCrossSource(makeQuery({ requiredSourceTypes: ["code"] }))).toBe(false);
	});
	it("true for >1 source types", () => {
		expect(isCrossSource(makeQuery({ requiredSourceTypes: ["code", "github-issue"] }))).toBe(true);
	});
});

describe("giniCoefficient", () => {
	it("returns 0 for empty input", () => {
		expect(giniCoefficient([])).toBe(0);
	});
	it("returns 0 for all-equal counts", () => {
		expect(giniCoefficient([5, 5, 5, 5])).toBe(0);
	});
	it("returns 0 for all-zero counts", () => {
		expect(giniCoefficient([0, 0, 0])).toBe(0);
	});
	it("approaches 1 for max-skew", () => {
		// Single bucket carries all mass; n=10 → gini = (n-1)/n = 0.9.
		const arr = Array.from({ length: 10 }, (_, i) => (i === 0 ? 100 : 0));
		expect(giniCoefficient(arr)).toBeCloseTo(0.9, 2);
	});
	it("monotonic in skew", () => {
		const even = giniCoefficient([10, 10, 10, 10]);
		const skew = giniCoefficient([1, 2, 3, 30]);
		expect(skew).toBeGreaterThan(even);
	});
});

describe("buildCoverageReport", () => {
	it("counts semantic strata per (sourceType, queryType)", () => {
		const queries = [
			makeQuery({ id: "a", queryType: "lookup", requiredSourceTypes: ["code"] }),
			makeQuery({ id: "b", queryType: "lookup", requiredSourceTypes: ["code"] }),
			makeQuery({ id: "c", queryType: "trace", requiredSourceTypes: ["code"] }),
		];
		const report = buildCoverageReport({
			queries,
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [],
		});
		expect(report.totalQueries).toBe(3);
		const codeLookup = report.semantic.find(
			(c) => c.key.sourceType === "code" && c.key.queryType === "lookup",
		);
		expect(codeLookup?.count).toBe(2);
	});

	it("emits one cell per requiredSourceType for cross-source queries", () => {
		const queries = [
			makeQuery({ queryType: "trace", requiredSourceTypes: ["code", "github-issue"] }),
		];
		const report = buildCoverageReport({
			queries,
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [],
		});
		expect(report.semantic).toHaveLength(2);
	});

	it("flags uncovered (sourceType, queryType) cells from catalog", () => {
		const report = buildCoverageReport({
			queries: [makeQuery({ queryType: "lookup", requiredSourceTypes: ["code"] })],
			catalog: makeCatalog([
				{ id: "d1", sourceType: "code" },
				{ id: "d2", sourceType: "github-issue" },
			]),
			segments: [],
		});
		expect(report.uncoveredStrata.length).toBeGreaterThan(0);
		const ghIssueTrace = report.uncoveredStrata.find(
			(u) => u.key.sourceType === "github-issue" && u.key.queryType === "trace",
		);
		expect(ghIssueTrace).toBeDefined();
		expect(ghIssueTrace?.artifactsInCorpus).toBe(1);
		// `code/lookup` covered, must NOT appear:
		const codeLookup = report.uncoveredStrata.find(
			(u) => u.key.sourceType === "code" && u.key.queryType === "lookup",
		);
		expect(codeLookup).toBeUndefined();
	});

	it("structural strata bucket by (hopCount, crossSource, operatorFamily)", () => {
		const queries = [
			makeQuery({ id: "a", queryType: "lookup", requiredSourceTypes: ["code"] }),
			makeQuery({
				id: "b",
				queryType: "trace",
				requiredSourceTypes: ["code", "github-issue"],
			}),
		];
		const report = buildCoverageReport({
			queries,
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [],
		});
		const traceCross = report.structural.find(
			(c) => c.key.operatorFamily === "trace" && c.key.crossSource === true,
		);
		expect(traceCross).toBeDefined();
		expect(traceCross?.key.hopCount).toBe(2);
	});

	it("gini = 0 when all strata equally populated", () => {
		const queries = [
			makeQuery({ id: "a", queryType: "lookup", requiredSourceTypes: ["code"] }),
			makeQuery({ id: "b", queryType: "trace", requiredSourceTypes: ["github-issue"] }),
		];
		const report = buildCoverageReport({
			queries,
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [],
		});
		expect(report.giniCoefficient).toBe(0);
	});

	it("ingests segment edge types without throwing (reserved for future structural axis)", () => {
		const report = buildCoverageReport({
			queries: [makeQuery()],
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [makeSegment(["closes", "references"])],
		});
		expect(report.totalQueries).toBe(1);
	});
});

describe("deriveFixtureHealthSignal", () => {
	it("flags coverage gap when uncovered strata exceed min", () => {
		const report = buildCoverageReport({
			queries: [makeQuery()],
			catalog: makeCatalog([
				{ id: "d1", sourceType: "code" },
				{ id: "d2", sourceType: "github-issue" },
				{ id: "d3", sourceType: "slack-message" },
			]),
			segments: [],
		});
		const sig = deriveFixtureHealthSignal({ collectionId: "alpha", coverage: report });
		expect(sig.hasCoverageGap).toBe(true);
		expect(sig.thresholds.giniFloor).toBe(DEFAULT_GINI_FLOOR);
		expect(sig.thresholds.minUncoveredStrata).toBe(DEFAULT_MIN_UNCOVERED_STRATA);
	});

	it("respects custom thresholds", () => {
		const report = buildCoverageReport({
			queries: [makeQuery()],
			catalog: makeCatalog([{ id: "d1", sourceType: "code" }]),
			segments: [],
		});
		const sig = deriveFixtureHealthSignal({
			collectionId: "alpha",
			coverage: report,
			minUncoveredStrata: 999,
			giniFloor: 0.99,
		});
		// One source type * 7 queryTypes = 7 cells - 1 covered (code/lookup) = 6 uncovered;
		// below threshold of 999, and gini=0 below 0.99.
		expect(sig.hasCoverageGap).toBe(false);
	});
});
