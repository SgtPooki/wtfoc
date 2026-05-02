import type { DocumentCatalog } from "@wtfoc/common";
import type { FixtureHealthSignal } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import { planRecipeExpansion } from "./recipe-pipeline.js";

function makeCatalog(
	docs: Array<{ id: string; sourceType: string; chunkIds?: string[] }>,
): DocumentCatalog {
	const documents: DocumentCatalog["documents"] = {};
	for (const d of docs) {
		documents[d.id] = {
			documentId: d.id,
			currentVersionId: "v1",
			previousVersionIds: [],
			chunkIds: d.chunkIds ?? ["c1"],
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

function makeFixtureHealth(
	uncovered: Array<{
		sourceType: string;
		queryType: FixtureHealthSignal["coverage"]["uncoveredStrata"][number]["key"]["queryType"];
		artifactsInCorpus: number;
	}>,
): FixtureHealthSignal {
	return {
		collectionId: "alpha",
		coverage: {
			totalQueries: 0,
			semantic: [],
			structural: [],
			uncoveredStrata: uncovered.map((u) => ({
				key: { sourceType: u.sourceType, edgeType: null, queryType: u.queryType },
				artifactsInCorpus: u.artifactsInCorpus,
			})),
			giniCoefficient: 0,
		},
		hasCoverageGap: true,
		thresholds: { giniFloor: 0.6, minUncoveredStrata: 3 },
	};
}

describe("planRecipeExpansion", () => {
	it("targets top-N uncovered strata by artifactsInCorpus desc", () => {
		const fh = makeFixtureHealth([
			{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 100 },
			{ sourceType: "github-issue", queryType: "trace", artifactsInCorpus: 5 },
			{ sourceType: "doc-page", queryType: "howto", artifactsInCorpus: 50 },
		]);
		const catalog = makeCatalog([
			{ id: "src/foo.ts", sourceType: "code" },
			{ id: "owner/repo#1", sourceType: "github-issue" },
			{ id: "docs/x.md", sourceType: "doc-page" },
		]);
		const { targetedStrata } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 2,
		});
		// maxNew=2 → headroom 4; all three strata fit.
		expect(targetedStrata).toHaveLength(3);
		expect(targetedStrata[0]?.artifactsInCorpus).toBe(100);
		expect(targetedStrata[1]?.artifactsInCorpus).toBe(50);
		expect(targetedStrata[2]?.artifactsInCorpus).toBe(5);
	});

	it("caps planned pairs at maxNew * 2 (headroom for adversarial filter)", () => {
		const uncovered = Array.from({ length: 20 }, (_, i) => ({
			sourceType: `type-${i}`,
			queryType: "lookup" as const,
			artifactsInCorpus: 100 - i,
		}));
		const catalog = makeCatalog(
			uncovered.map((u) => ({ id: `id-${u.sourceType}`, sourceType: u.sourceType })),
		);
		const fh = makeFixtureHealth(uncovered);
		const { plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 3,
		});
		expect(plannedPairs.length).toBeLessThanOrEqual(6);
	});

	it("skips strata whose sourceType has zero catalog artifacts", () => {
		const fh = makeFixtureHealth([
			{ sourceType: "missing", queryType: "lookup", artifactsInCorpus: 100 },
			{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 1 },
		]);
		const catalog = makeCatalog([{ id: "src/x.ts", sourceType: "code" }]);
		const { targetedStrata } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 5,
		});
		expect(targetedStrata).toHaveLength(1);
		expect(targetedStrata[0]?.sourceType).toBe("code");
	});

	it("seed produces deterministic artifact pick within a stratum", () => {
		const catalog = makeCatalog([
			{ id: "a", sourceType: "code" },
			{ id: "b", sourceType: "code" },
			{ id: "c", sourceType: "code" },
		]);
		const fh = makeFixtureHealth([
			{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 3 },
		]);
		const a = planRecipeExpansion({ fixtureHealth: fh, catalog, maxNew: 1, seed: 42 });
		const b = planRecipeExpansion({ fixtureHealth: fh, catalog, maxNew: 1, seed: 42 });
		expect(a.plannedPairs[0]?.sample.artifact.artifactId).toBe(
			b.plannedPairs[0]?.sample.artifact.artifactId,
		);
	});

	it("emits an empty plan when uncoveredStrata is empty", () => {
		const fh = makeFixtureHealth([]);
		const { targetedStrata, plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog: makeCatalog([{ id: "x", sourceType: "code" }]),
		});
		expect(targetedStrata).toEqual([]);
		expect(plannedPairs).toEqual([]);
	});
});
