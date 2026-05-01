import { describe, expect, it } from "vitest";
import {
	type Difficulty,
	GOLD_STANDARD_QUERIES,
	GOLD_STANDARD_QUERIES_LEGACY_VIEW,
	GOLD_STANDARD_QUERIES_VERSION,
	type LayerHint,
	type QueryType,
	toLegacyView,
} from "./gold-standard-queries.js";

const VALID_QUERY_TYPES: QueryType[] = [
	"lookup",
	"trace",
	"compare",
	"temporal",
	"causal",
	"howto",
	"entity-resolution",
];
const VALID_DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const VALID_LAYER_HINTS: LayerHint[] = [
	"chunking",
	"embedding",
	"edge-extraction",
	"ranking",
	"trace",
];

describe("GoldQuery schema invariants (#344 step 1)", () => {
	it("version is 2.0.0 (post-overhaul)", () => {
		expect(GOLD_STANDARD_QUERIES_VERSION).toBe("2.0.0");
	});

	it("has at least 20 queries (preserved from #261)", () => {
		expect(GOLD_STANDARD_QUERIES.length).toBeGreaterThanOrEqual(20);
	});

	it("every query id is unique", () => {
		const ids = GOLD_STANDARD_QUERIES.map((q) => q.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
	});

	it("every query has a non-empty applicableCorpora", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			expect(q.applicableCorpora.length, `${q.id}: applicableCorpora empty`).toBeGreaterThan(0);
		}
	});

	it("every query has a valid queryType", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			expect(VALID_QUERY_TYPES, `${q.id}: queryType=${q.queryType}`).toContain(q.queryType);
		}
	});

	it("every query has a valid difficulty", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			expect(VALID_DIFFICULTIES, `${q.id}: difficulty=${q.difficulty}`).toContain(q.difficulty);
		}
	});

	it("every targetLayerHints entry is valid", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			for (const hint of q.targetLayerHints) {
				expect(VALID_LAYER_HINTS, `${q.id}: hint=${hint}`).toContain(hint);
			}
		}
	});

	it("every expectedEvidence row has artifactId + boolean required", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			for (const ev of q.expectedEvidence) {
				expect(ev.artifactId.length, `${q.id}: empty artifactId`).toBeGreaterThan(0);
				expect(typeof ev.required, `${q.id}: required not boolean`).toBe("boolean");
			}
		}
	});
});

describe("toLegacyView adapter", () => {
	it("derives expectedSourceSubstrings from required:true rows", () => {
		const view = toLegacyView({
			id: "t1",
			authoredFromCollectionId: "c1",
			applicableCorpora: ["c1"],
			query: "q",
			queryType: "lookup",
			difficulty: "easy",
			targetLayerHints: ["ranking"],
			expectedEvidence: [
				{ artifactId: "a", required: true },
				{ artifactId: "b", required: false },
			],
			acceptableAnswerFacts: [],
			requiredSourceTypes: [],
			minResults: 1,
		});
		expect(view.expectedSourceSubstrings).toEqual(["a"]);
		expect(view.goldSupportingSources).toEqual(["a", "b"]);
	});

	it("synthesizes a collectionScopePattern that exactly matches applicableCorpora", () => {
		const view = toLegacyView({
			id: "t2",
			authoredFromCollectionId: "c1",
			applicableCorpora: ["alpha", "beta"],
			query: "q",
			queryType: "lookup",
			difficulty: "easy",
			targetLayerHints: ["ranking"],
			expectedEvidence: [],
			acceptableAnswerFacts: [],
			requiredSourceTypes: [],
			minResults: 1,
		});
		expect(view.collectionScopePattern).toBeDefined();
		const re = new RegExp(view.collectionScopePattern as string);
		expect(re.test("alpha")).toBe(true);
		expect(re.test("beta")).toBe(true);
		expect(re.test("alpha-suffix")).toBe(false);
		expect(re.test("gamma")).toBe(false);
	});

	it("legacy materialized view has the same length as the new fixture", () => {
		expect(GOLD_STANDARD_QUERIES_LEGACY_VIEW.length).toBe(GOLD_STANDARD_QUERIES.length);
	});
});
