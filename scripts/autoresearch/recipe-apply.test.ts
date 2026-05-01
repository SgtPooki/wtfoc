import type { CandidateQuery, GoldQuery } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import {
	type ApplyEnrichedRecord,
	codegenAuthoredQueries,
	selectKeepers,
	spliceAuthoredQueries,
	validateStructural,
} from "./recipe-apply.js";

function makeRecord(
	label: ApplyEnrichedRecord["label"],
	overrides: Partial<ApplyEnrichedRecord> = {},
	draftOverrides: Partial<GoldQuery> = {},
): ApplyEnrichedRecord {
	const draft: GoldQuery = {
		id: `id-${label}`,
		authoredFromCollectionId: "alpha",
		applicableCorpora: ["alpha"],
		query: "abstract Q",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [{ artifactId: "doc/x", required: true }],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		...draftOverrides,
	};
	const candidate: CandidateQuery = {
		template: {
			id: "lookup-by-symbol",
			intent: "x",
			queryType: "lookup",
			difficulty: "medium",
			targetLayerHints: ["ranking"],
			exampleSurface: "x",
		},
		stratum: { sourceType: "code", edgeType: null, lengthBucket: "short", rarity: "common" },
		draft,
	};
	return {
		candidate,
		label,
		reasons: [],
		probe: {
			goldRank: null,
			widerK: 100,
			requiredTypeCoverage: true,
			traceHopCount: 0,
			goldReachedByTrace: false,
			topResults: [],
		},
		...overrides,
	};
}

describe("selectKeepers", () => {
	it("default policy keeps only keeper-candidate", () => {
		const records = [
			makeRecord("keeper-candidate"),
			makeRecord("human-review"),
			makeRecord("needs-fix"),
			makeRecord("trivial-suspect"),
			makeRecord("auto-reject"),
		];
		const r = selectKeepers(records, {
			includeHumanReview: false,
			includeNeedsFix: false,
			force: false,
		});
		expect(r.keep).toHaveLength(1);
		expect(r.keep[0]?.label).toBe("keeper-candidate");
		expect(r.skip).toHaveLength(4);
	});

	it("--include-human-review adds the human-review label", () => {
		const records = [makeRecord("human-review"), makeRecord("auto-reject")];
		const r = selectKeepers(records, {
			includeHumanReview: true,
			includeNeedsFix: false,
			force: false,
		});
		expect(r.keep).toHaveLength(1);
		expect(r.keep[0]?.label).toBe("human-review");
	});

	it("--include-needs-fix adds the needs-fix label", () => {
		const records = [makeRecord("needs-fix"), makeRecord("trivial-suspect")];
		const r = selectKeepers(records, {
			includeHumanReview: false,
			includeNeedsFix: true,
			force: false,
		});
		expect(r.keep).toHaveLength(1);
		expect(r.keep[0]?.label).toBe("needs-fix");
	});

	it("--force is required for trivial-suspect and auto-reject", () => {
		const records = [
			makeRecord("trivial-suspect"),
			makeRecord("auto-reject"),
			makeRecord("keeper-candidate"),
		];
		const r = selectKeepers(records, {
			includeHumanReview: false,
			includeNeedsFix: false,
			force: true,
		});
		expect(r.keep).toHaveLength(3);
	});

	it("per-entry humanOverride beats label gating", () => {
		const r = selectKeepers(
			[makeRecord("auto-reject", { humanOverride: true })],
			{ includeHumanReview: false, includeNeedsFix: false, force: false },
		);
		expect(r.keep).toHaveLength(1);
	});
});

describe("validateStructural", () => {
	it("flags duplicate ids vs existing GOLD_STANDARD_QUERIES", () => {
		const errors = validateStructural([makeRecord("keeper-candidate")], new Set(["id-keeper-candidate"]));
		expect(errors.some((e) => e.error.includes("collides"))).toBe(true);
	});

	it("flags duplicate ids within the apply set", () => {
		const errors = validateStructural(
			[makeRecord("keeper-candidate"), makeRecord("keeper-candidate")],
			new Set(),
		);
		expect(errors.some((e) => e.error.includes("duplicate"))).toBe(true);
	});

	it("flags missing id", () => {
		const r = makeRecord("keeper-candidate");
		(r.candidate.draft as { id?: string }).id = undefined;
		const errors = validateStructural([r], new Set());
		expect(errors.some((e) => e.error.includes("missing id"))).toBe(true);
	});

	it("flags empty applicableCorpora", () => {
		const errors = validateStructural(
			[makeRecord("keeper-candidate", {}, { applicableCorpora: [] })],
			new Set(),
		);
		expect(errors.some((e) => e.error.includes("applicableCorpora"))).toBe(true);
	});

	it("flags invalid queryType", () => {
		const errors = validateStructural(
			[
				makeRecord("keeper-candidate", {}, {
					queryType: "bogus" as GoldQuery["queryType"],
				}),
			],
			new Set(),
		);
		expect(errors.some((e) => e.error.includes("invalid queryType"))).toBe(true);
	});

	it("flags empty expectedEvidence", () => {
		const errors = validateStructural(
			[makeRecord("keeper-candidate", {}, { expectedEvidence: [] })],
			new Set(),
		);
		expect(errors.some((e) => e.error.includes("expectedEvidence"))).toBe(true);
	});

	it("returns [] for a clean record", () => {
		expect(validateStructural([makeRecord("keeper-candidate")], new Set())).toEqual([]);
	});
});

describe("codegenAuthoredQueries", () => {
	it("emits a tab-indented JSON-style array literal", () => {
		const ts = codegenAuthoredQueries([makeRecord("keeper-candidate")]);
		expect(ts.startsWith("[")).toBe(true);
		expect(ts).toContain("\t{");
		expect(ts).toContain("\"id-keeper-candidate\"");
		expect(ts).toContain("\"queryType\": \"lookup\"");
	});
	it("is deterministic across calls", () => {
		const a = codegenAuthoredQueries([makeRecord("keeper-candidate")]);
		const b = codegenAuthoredQueries([makeRecord("keeper-candidate")]);
		expect(a).toBe(b);
	});
});

describe("spliceAuthoredQueries", () => {
	const FILE = `// header
// === BEGIN AUTHORED-QUERIES MANAGED ARRAY ===
export const AUTHORED_QUERIES: GoldQuery[] = [];
// === END AUTHORED-QUERIES MANAGED ARRAY ===
`;
	it("replaces the block between markers", () => {
		const out = spliceAuthoredQueries(FILE, '\t["new"]');
		expect(out).toContain('\t["new"]');
		expect(out).toContain("// === BEGIN AUTHORED-QUERIES MANAGED ARRAY ===");
		expect(out).toContain("// === END AUTHORED-QUERIES MANAGED ARRAY ===");
	});
	it("throws when markers are missing", () => {
		expect(() => spliceAuthoredQueries("// no markers", "\t[]")).toThrow(/markers missing/);
	});
});
