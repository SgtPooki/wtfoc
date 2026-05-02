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

	it("picks a sourceType-applicable template (regression: codex peer-review)", () => {
		// Pre-fix, github-issue/lookup paired with `lookup-by-symbol` (code-only).
		// Post-fix, the picker selects `lookup-discussion` (issue/PR/slack).
		const fh = makeFixtureHealth([
			{ sourceType: "github-issue", queryType: "lookup", artifactsInCorpus: 10 },
		]);
		const catalog = makeCatalog([{ id: "owner/repo#42", sourceType: "github-issue" }]);
		const { plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 1,
		});
		expect(plannedPairs).toHaveLength(1);
		expect(plannedPairs[0]?.template.id).toBe("lookup-discussion");
	});

	it("skips strata whose sourceType has no applicable template", () => {
		// `compare-implementations` applies only to `code`. For a markdown
		// stratum with queryType=compare, the picker returns null and the
		// planner skips the stratum cleanly.
		const fh = makeFixtureHealth([
			{ sourceType: "markdown", queryType: "compare", artifactsInCorpus: 10 },
		]);
		const catalog = makeCatalog([{ id: "docs/x.md", sourceType: "markdown" }]);
		const { targetedStrata, plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 1,
		});
		expect(targetedStrata).toEqual([]);
		expect(plannedPairs).toEqual([]);
	});

	it("prefers rarity-gated template for rare strata (regression: #372 Copilot)", () => {
		// 99 code docs + 1 markdown doc → markdown is rare. With queryType
		// `lookup`, both `lookup-doc-section` (markdown/html, no rarity)
		// AND `lookup-rare-edge` (rarity=rare, no sourceType) apply.
		// Source-order fallback would pick `lookup-doc-section`. The
		// rarity-aware picker must select `lookup-rare-edge`.
		const docs = [
			...Array.from({ length: 99 }, (_, i) => ({
				id: `src/code-${i}.ts`,
				sourceType: "code",
			})),
			{ id: "docs/rare.md", sourceType: "markdown" },
		];
		const catalog = makeCatalog(docs);
		const fh = makeFixtureHealth([
			{ sourceType: "markdown", queryType: "lookup", artifactsInCorpus: 1 },
		]);
		const { plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 1,
		});
		expect(plannedPairs).toHaveLength(1);
		expect(plannedPairs[0]?.template.id).toBe("lookup-rare-edge");
	});

	it("propagates real rarity from stratifyArtifacts (peer-review #2 follow-up)", () => {
		// 99 code docs + 1 markdown doc → markdown is `rare` (1% < 5%
		// default rarityFraction). The planner's lookup pick for
		// markdown should carry rarity=rare, not the previously-
		// hardcoded "common".
		const docs = [
			...Array.from({ length: 99 }, (_, i) => ({
				id: `src/code-${i}.ts`,
				sourceType: "code",
			})),
			{ id: "docs/rare.md", sourceType: "markdown" },
		];
		const catalog = makeCatalog(docs);
		const fh = makeFixtureHealth([
			{ sourceType: "markdown", queryType: "lookup", artifactsInCorpus: 1 },
		]);
		const { plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 1,
		});
		expect(plannedPairs).toHaveLength(1);
		expect(plannedPairs[0]?.sample.stratum.rarity).toBe("rare");
		expect(plannedPairs[0]?.sample.stratum.sourceType).toBe("markdown");
	});

	it("dominant sourceType comes back as common rarity", () => {
		const docs = Array.from({ length: 10 }, (_, i) => ({
			id: `src/code-${i}.ts`,
			sourceType: "code",
		}));
		const catalog = makeCatalog(docs);
		const fh = makeFixtureHealth([
			{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 10 },
		]);
		const { plannedPairs } = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 1,
		});
		expect(plannedPairs).toHaveLength(1);
		expect(plannedPairs[0]?.sample.stratum.rarity).toBe("common");
	});

	it("headroomFactor override expands the per-cycle planning budget", () => {
		const uncovered = Array.from({ length: 20 }, (_, i) => ({
			sourceType: `type-${i}`,
			queryType: "lookup" as const,
			artifactsInCorpus: 100 - i,
		}));
		const catalog = makeCatalog(
			uncovered.map((u) => ({ id: `id-${u.sourceType}`, sourceType: u.sourceType })),
		);
		const fh = makeFixtureHealth(uncovered);
		// Note: lookup-by-symbol/lookup-doc-section/lookup-discussion only
		// match for `code/markdown/html/github-issue/...` source types, so
		// the planner naturally skips most synthetic `type-N` strata. Use
		// `entity-resolution-canonical` (no appliesToStrata, applies to all).
		const fhEr = makeFixtureHealth(
			uncovered.map((u) => ({
				sourceType: u.sourceType,
				queryType: "entity-resolution" as const,
				artifactsInCorpus: u.artifactsInCorpus,
			})),
		);
		const tight = planRecipeExpansion({
			fixtureHealth: fhEr,
			catalog,
			maxNew: 3,
			headroomFactor: 1,
		});
		const wide = planRecipeExpansion({
			fixtureHealth: fhEr,
			catalog,
			maxNew: 3,
			headroomFactor: 4,
		});
		expect(tight.plannedPairs.length).toBeLessThanOrEqual(3);
		expect(wide.plannedPairs.length).toBeGreaterThan(tight.plannedPairs.length);
		expect(wide.plannedPairs.length).toBeLessThanOrEqual(12);
		void fh; // unused symbol guard for the prior `uncovered` shape
	});

	it("falls back to default when headroomFactor is invalid (NaN / 0 / negative)", () => {
		const uncovered = Array.from({ length: 10 }, (_, i) => ({
			sourceType: `type-${i}`,
			queryType: "entity-resolution" as const,
			artifactsInCorpus: 100 - i,
		}));
		const catalog = makeCatalog(
			uncovered.map((u) => ({ id: `id-${u.sourceType}`, sourceType: u.sourceType })),
		);
		const fh = makeFixtureHealth(uncovered);
		// NaN / 0 / negative should NOT disable the cap; fall back to default 2x.
		const nan = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 3,
			headroomFactor: Number.NaN,
		});
		const zero = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 3,
			headroomFactor: 0,
		});
		const negative = planRecipeExpansion({
			fixtureHealth: fh,
			catalog,
			maxNew: 3,
			headroomFactor: -5,
		});
		expect(nan.plannedPairs.length).toBeLessThanOrEqual(6);
		expect(zero.plannedPairs.length).toBeLessThanOrEqual(6);
		expect(negative.plannedPairs.length).toBeLessThanOrEqual(6);
		// All three should match the default behavior (maxNew * 2 = 6 cap).
		expect(nan.plannedPairs.length).toBeGreaterThan(0);
	});
});
