import { describe, expect, it } from "vitest";
import {
	applyAdversarialFilter,
	type CandidateQuery,
	type CatalogArtifact,
	groupByStratum,
	lengthBucketOf,
	type QueryTemplate,
	type RetrieveTopK,
	sampleStratified,
	stratifyArtifacts,
	stratumKey,
} from "./stratified-template-recipe.js";

function makeArtifact(partial: Partial<CatalogArtifact> & { artifactId: string }): CatalogArtifact {
	return {
		sourceType: "code",
		contentLength: 1000,
		...partial,
	};
}

function seededRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

describe("lengthBucketOf", () => {
	it("uses default boundaries 800/4000", () => {
		expect(lengthBucketOf(500)).toBe("short");
		expect(lengthBucketOf(2000)).toBe("medium");
		expect(lengthBucketOf(10_000)).toBe("long");
	});
	it("respects custom boundaries", () => {
		const opts = { lengthBuckets: { short: 100, medium: 500 } };
		expect(lengthBucketOf(50, opts)).toBe("short");
		expect(lengthBucketOf(200, opts)).toBe("medium");
		expect(lengthBucketOf(600, opts)).toBe("long");
	});
});

describe("stratifyArtifacts", () => {
	it("emits one row per (artifact, edgeType) pair", () => {
		const arts = [
			makeArtifact({ artifactId: "a", edgeTypes: ["imports", "references"] }),
			makeArtifact({ artifactId: "b" }),
		];
		const rows = stratifyArtifacts(arts);
		// "a" -> 2 rows (imports, references); "b" -> 1 row (edgeType: null)
		expect(rows).toHaveLength(3);
	});

	it("tags low-frequency combos as `rare` per the rarity threshold", () => {
		const arts = Array.from({ length: 20 }, (_, i) =>
			makeArtifact({ artifactId: `code${i}`, sourceType: "code" }),
		).concat([makeArtifact({ artifactId: "doc1", sourceType: "markdown" })]);
		const rows = stratifyArtifacts(arts, { rarityFraction: 0.1 });
		const docRow = rows.find((r) => r.artifact.artifactId === "doc1");
		const codeRow = rows.find((r) => r.artifact.artifactId === "code0");
		expect(docRow?.stratum.rarity).toBe("rare"); // 1/21 ~= 4.7% < 10%
		expect(codeRow?.stratum.rarity).toBe("common");
	});

	it("returns [] on empty input", () => {
		expect(stratifyArtifacts([])).toEqual([]);
	});
});

describe("groupByStratum + stratumKey", () => {
	it("groups rows sharing the same stratum", () => {
		const rows = stratifyArtifacts([
			makeArtifact({ artifactId: "a", sourceType: "code", contentLength: 200 }),
			makeArtifact({ artifactId: "b", sourceType: "code", contentLength: 300 }),
			makeArtifact({ artifactId: "c", sourceType: "code", contentLength: 9000 }),
		]);
		const grouped = groupByStratum(rows);
		// "a" + "b" share short-bucket stratum; "c" is in long-bucket.
		expect(grouped.size).toBe(2);
	});

	it("stratumKey is stable across runs", () => {
		const k1 = stratumKey({
			sourceType: "code",
			edgeType: "imports",
			lengthBucket: "short",
			rarity: "common",
		});
		const k2 = stratumKey({
			sourceType: "code",
			edgeType: "imports",
			lengthBucket: "short",
			rarity: "common",
		});
		expect(k1).toBe(k2);
	});
});

describe("sampleStratified", () => {
	it("yields up to samplesPerStratum per occupied stratum", () => {
		const arts = Array.from({ length: 10 }, (_, i) =>
			makeArtifact({ artifactId: `c${i}`, sourceType: "code" }),
		);
		const samples = sampleStratified(arts, { samplesPerStratum: 2, rng: seededRng(42) });
		// All 10 share one stratum (code/null/medium/common); cap at 2.
		expect(samples).toHaveLength(2);
	});

	it("is deterministic when rng is seeded", () => {
		const arts = Array.from({ length: 50 }, (_, i) => makeArtifact({ artifactId: `c${i}` }));
		const a = sampleStratified(arts, { samplesPerStratum: 5, rng: seededRng(7) });
		const b = sampleStratified(arts, { samplesPerStratum: 5, rng: seededRng(7) });
		expect(a.map((s) => s.artifact.artifactId)).toEqual(b.map((s) => s.artifact.artifactId));
	});

	it("respects maxTotalSamples cap", () => {
		const arts = Array.from({ length: 30 }, (_, i) =>
			makeArtifact({
				artifactId: `c${i}`,
				sourceType: i < 10 ? "code" : i < 20 ? "markdown" : "github-issue",
			}),
		);
		const samples = sampleStratified(arts, {
			samplesPerStratum: 5,
			maxTotalSamples: 7,
			rng: seededRng(11),
		});
		expect(samples).toHaveLength(7);
	});
});

function makeCandidate(query: string, requiredArtifactIds: string[]): CandidateQuery {
	const template: QueryTemplate = {
		id: "t1",
		intent: "test",
		queryType: "lookup",
		difficulty: "easy",
		targetLayerHints: ["ranking"],
		exampleSurface: "find X",
	};
	return {
		template,
		stratum: { sourceType: "code", edgeType: null, lengthBucket: "short", rarity: "common" },
		draft: {
			authoredFromCollectionId: "alpha",
			applicableCorpora: ["alpha"],
			query,
			queryType: "lookup",
			difficulty: "easy",
			targetLayerHints: ["ranking"],
			expectedEvidence: requiredArtifactIds.map((id) => ({ artifactId: id, required: true })),
			acceptableAnswerFacts: [],
			requiredSourceTypes: [],
			minResults: 1,
		},
	};
}

describe("applyAdversarialFilter", () => {
	it("discards candidates whose required artifact is in vector top-K", async () => {
		const c = makeCandidate("how does X work", ["doc/easy.ts"]);
		const retrieve: RetrieveTopK = async () => [
			{ artifactId: "doc/easy.ts" },
			{ artifactId: "doc/other.ts" },
		];
		const result = await applyAdversarialFilter([c], retrieve, { topK: 3 });
		expect(result.kept).toEqual([]);
		expect(result.discarded).toHaveLength(1);
		expect(result.discarded[0]?.reason).toContain("doc/easy.ts");
	});

	it("keeps candidates whose required artifact is NOT in top-K", async () => {
		const c = makeCandidate("how does X work", ["doc/hard.ts"]);
		const retrieve: RetrieveTopK = async () => [
			{ artifactId: "doc/decoy1.ts" },
			{ artifactId: "doc/decoy2.ts" },
			{ artifactId: "doc/decoy3.ts" },
		];
		const result = await applyAdversarialFilter([c], retrieve, { topK: 3 });
		expect(result.kept).toHaveLength(1);
		expect(result.discarded).toEqual([]);
	});

	it("keeps candidates with no required evidence (cannot judge difficulty)", async () => {
		const c = makeCandidate("how does X work", []);
		const retrieve: RetrieveTopK = async () => [];
		const result = await applyAdversarialFilter([c], retrieve);
		expect(result.kept).toHaveLength(1);
	});
});
