import type { CandidateQuery, GoldQuery, QueryTemplate } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import {
	classifyValidation,
	type ProbeMetadata,
	renderTriageReport,
	summarizeLabels,
	type ValidationRecord,
} from "./recipe-validate.js";

const TEMPLATE: QueryTemplate = {
	id: "trace-issue-to-impl",
	intent: "x",
	queryType: "trace",
	difficulty: "hard",
	targetLayerHints: ["trace"],
	exampleSurface: "x",
};
const LOOKUP_TEMPLATE: QueryTemplate = {
	...TEMPLATE,
	id: "lookup-by-symbol",
	queryType: "lookup",
};

function makeCandidate(
	queryType: GoldQuery["queryType"] = "trace",
	requiredArtifacts: string[] = ["doc/x.ts"],
	requiredSourceTypes: string[] = ["code"],
): CandidateQuery {
	const draft: GoldQuery = {
		id: "c1",
		authoredFromCollectionId: "alpha",
		applicableCorpora: ["alpha"],
		query: "abstract Q",
		queryType,
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: requiredArtifacts.map((id) => ({ artifactId: id, required: true })),
		acceptableAnswerFacts: [],
		requiredSourceTypes,
		minResults: 1,
	};
	return {
		template: queryType === "lookup" ? LOOKUP_TEMPLATE : TEMPLATE,
		stratum: { sourceType: "code", edgeType: null, lengthBucket: "short", rarity: "common" },
		draft,
	};
}

function makeProbe(partial: Partial<ProbeMetadata> = {}): ProbeMetadata {
	return {
		goldRank: 5,
		widerK: 100,
		requiredTypeCoverage: true,
		traceHopCount: 2,
		goldReachedByTrace: false,
		topResults: [],
		...partial,
	};
}

describe("classifyValidation", () => {
	it("auto-rejects when gold absent from widerK AND not reached by trace", () => {
		const r = classifyValidation(
			makeCandidate(),
			makeProbe({ goldRank: null, goldReachedByTrace: false }),
		);
		expect(r.label).toBe("auto-reject");
		expect(r.reasons).toContain("gold-not-in-widerK");
	});

	it("trivial-suspect when gold rank in vector top-3 (adversarial filter disagreement)", () => {
		const r = classifyValidation(makeCandidate(), makeProbe({ goldRank: 2 }));
		expect(r.label).toBe("trivial-suspect");
		expect(r.reasons).toContain("gold-rank-1-to-3");
	});

	it("human-review when trace rescued gold not in vector top-K (deep-recall stress)", () => {
		const r = classifyValidation(
			makeCandidate(),
			makeProbe({ goldRank: null, goldReachedByTrace: true }),
		);
		expect(r.label).toBe("human-review");
		expect(r.reasons).toContain("gold-deep-recall");
	});

	it("needs-fix when trace template returned zero hops", () => {
		const r = classifyValidation(
			makeCandidate("trace"),
			makeProbe({ goldRank: 10, traceHopCount: 0 }),
		);
		expect(r.label).toBe("needs-fix");
		expect(r.reasons).toContain("trace-empty-but-needed");
	});

	it("does NOT flag trace-empty-but-needed for lookup template (lookup doesn't need hops)", () => {
		const r = classifyValidation(
			makeCandidate("lookup"),
			makeProbe({ goldRank: 10, traceHopCount: 0 }),
		);
		expect(r.reasons).not.toContain("trace-empty-but-needed");
	});

	it("needs-fix when required source types never surface", () => {
		const r = classifyValidation(
			makeCandidate("trace", ["doc/x.ts"], ["github-issue"]),
			makeProbe({ goldRank: 10, requiredTypeCoverage: false }),
		);
		expect(r.label).toBe("needs-fix");
		expect(r.reasons).toContain("required-type-missing");
	});

	it("human-review for mid-rank gold (4..widerK) — borderline", () => {
		const r = classifyValidation(makeCandidate(), makeProbe({ goldRank: 25 }));
		expect(r.label).toBe("human-review");
		expect(r.reasons).toContain("gold-mid-rank");
	});

	it("does NOT auto-reject `goldRank > 50` (peer-review consensus: caps engine ceiling)", () => {
		// goldRank=80 still appears mid-rank, deserving human review; the
		// classifier MUST NOT silently auto-reject it.
		const r = classifyValidation(makeCandidate(), makeProbe({ goldRank: 80 }));
		expect(r.label).not.toBe("auto-reject");
	});

	it("aggregates multiple needs-fix reasons", () => {
		const r = classifyValidation(
			makeCandidate("trace", ["x"], ["github-issue"]),
			makeProbe({
				goldRank: 10,
				traceHopCount: 0,
				requiredTypeCoverage: false,
			}),
		);
		expect(r.label).toBe("needs-fix");
		expect(r.reasons).toContain("trace-empty-but-needed");
		expect(r.reasons).toContain("required-type-missing");
	});
});

describe("summarizeLabels", () => {
	it("counts labels deterministically", () => {
		const records: ValidationRecord[] = [
			{ candidate: makeCandidate(), label: "keeper-candidate", reasons: [], probe: makeProbe() },
			{ candidate: makeCandidate(), label: "keeper-candidate", reasons: [], probe: makeProbe() },
			{ candidate: makeCandidate(), label: "needs-fix", reasons: [], probe: makeProbe() },
		];
		const counts = summarizeLabels(records);
		expect(counts["keeper-candidate"]).toBe(2);
		expect(counts["needs-fix"]).toBe(1);
		expect(counts["auto-reject"]).toBe(0);
	});
});

describe("renderTriageReport", () => {
	it("emits a per-label section + per-candidate packet", () => {
		const records: ValidationRecord[] = [
			{
				candidate: makeCandidate("trace"),
				label: "keeper-candidate",
				reasons: ["keeper"],
				probe: makeProbe({
					goldRank: 7,
					topResults: [
						{ rank: 1, artifactId: "a", sourceType: "code", score: 0.9 },
					],
				}),
			},
			{
				candidate: makeCandidate("lookup"),
				label: "auto-reject",
				reasons: ["gold-not-in-widerK"],
				probe: makeProbe({ goldRank: null, goldReachedByTrace: false }),
			},
		];
		const md = renderTriageReport("alpha", records);
		expect(md).toContain("# Recipe-validate triage report — `alpha`");
		expect(md).toContain("**keeper-candidate**: 1");
		expect(md).toContain("## keeper-candidate (1)");
		expect(md).toContain("## auto-reject (1)");
		expect(md).toContain("**Query**: abstract Q");
		expect(md).toContain("`a`");
	});

	it("skips empty label sections", () => {
		const md = renderTriageReport("alpha", [
			{
				candidate: makeCandidate(),
				label: "keeper-candidate",
				reasons: [],
				probe: makeProbe(),
			},
		]);
		expect(md).not.toContain("## auto-reject");
	});
});
