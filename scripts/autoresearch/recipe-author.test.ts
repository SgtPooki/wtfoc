import type { CatalogArtifact, RecipeSample } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import {
	catalogToArtifacts,
	parseArgs,
	planAuthoring,
	seededRng,
	stubAuthor,
} from "./recipe-author.js";
import { RECIPE_TEMPLATES, templatesForStratum } from "./recipe-templates.js";

describe("seededRng", () => {
	it("is deterministic given the same seed", () => {
		const a = seededRng(7);
		const b = seededRng(7);
		expect(a()).toBeCloseTo(b());
		expect(a()).toBeCloseTo(b());
	});
	it("produces values in [0, 1)", () => {
		const r = seededRng(1);
		for (let i = 0; i < 100; i++) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe("catalogToArtifacts", () => {
	it("filters out non-active documents", () => {
		const arts = catalogToArtifacts({
			documents: {
				"a.ts": { state: "active", chunkIds: ["a#0"], sourceType: "code" },
				"b.ts": { state: "archived", chunkIds: ["b#0"], sourceType: "code" },
				"c.ts": { state: "superseded", chunkIds: ["c#0"], sourceType: "code" },
			},
		});
		expect(arts).toHaveLength(1);
		expect(arts[0]?.artifactId).toBe("a.ts");
	});
	it("defaults sourceType to 'unknown' when missing", () => {
		const arts = catalogToArtifacts({
			documents: { "x": { state: "active", chunkIds: ["x#0"] } },
		});
		expect(arts[0]?.sourceType).toBe("unknown");
	});
	it("estimates content length from chunk count", () => {
		const arts = catalogToArtifacts({
			documents: { "x": { state: "active", chunkIds: ["x#0", "x#1", "x#2"] } },
		});
		expect(arts[0]?.contentLength).toBe(3000);
	});
});

describe("templatesForStratum", () => {
	it("filters templates by sourceType", () => {
		const ts = templatesForStratum({
			sourceType: "code",
			edgeType: null,
			rarity: "common",
		});
		const ids = ts.map((t) => t.id);
		expect(ids).toContain("lookup-by-symbol");
		expect(ids).not.toContain("lookup-doc-section");
	});
	it("filters templates by rarity tag", () => {
		const ts = templatesForStratum({
			sourceType: "code",
			edgeType: null,
			rarity: "rare",
		});
		expect(ts.map((t) => t.id)).toContain("lookup-rare-edge");
	});
	it("includes always-applies templates (empty appliesToStrata)", () => {
		const ts = templatesForStratum({
			sourceType: "exotic",
			edgeType: null,
			rarity: "common",
		});
		// trace-cross-source has no appliesToStrata filter -> always present.
		expect(ts.map((t) => t.id)).toContain("trace-cross-source");
	});
});

function makeSample(partial: Partial<CatalogArtifact> & { artifactId: string }): RecipeSample {
	return {
		stratum: { sourceType: "code", edgeType: null, lengthBucket: "short", rarity: "common" },
		artifact: { sourceType: "code", contentLength: 100, ...partial },
	};
}

describe("planAuthoring", () => {
	it("pairs each sample with templates applicable to its stratum", () => {
		const samples = [makeSample({ artifactId: "a.ts" })];
		const plan = planAuthoring(samples, 100);
		expect(plan).toHaveLength(1);
		expect(plan[0]?.templates.length).toBeGreaterThan(0);
		// All resulting templates must apply to the code/common stratum.
		for (const t of plan[0]?.templates ?? []) {
			expect(
				!t.appliesToStrata ||
					t.appliesToStrata.length === 0 ||
					t.appliesToStrata.some(
						(p) =>
							(!p.sourceType || p.sourceType === "code") &&
							(!p.rarity || p.rarity === "common"),
					),
			).toBe(true);
		}
	});

	it("respects maxCandidates global cap", () => {
		const samples = Array.from({ length: 20 }, (_, i) =>
			makeSample({ artifactId: `a${i}.ts` }),
		);
		const plan = planAuthoring(samples, 5);
		const total = plan.reduce((acc, p) => acc + p.templates.length, 0);
		// We stop adding more samples once cumulative templates hits the cap.
		expect(total).toBeGreaterThanOrEqual(5);
		// We don't add EVERY sample's templates — break early.
		expect(plan.length).toBeLessThan(samples.length);
	});

	it("always-applies templates ensure every stratum gets at least one template", () => {
		// Every stratum is covered by the always-applies templates
		// (`trace-cross-source`, `howto-task`, etc.), so planAuthoring
		// never silently drops a sample. If a future template change
		// removes always-applies and exposes a real "no templates"
		// edge case, this test should be replaced with one that
		// constructs that stratum explicitly.
		const samples = [makeSample({ artifactId: "a.ts" })];
		const plan = planAuthoring(samples, 100);
		expect(plan.length).toBeGreaterThan(0);
	});
});

describe("stubAuthor", () => {
	it("emits a candidate id that includes the template id (artifactId is hashed)", () => {
		const tpl = RECIPE_TEMPLATES[0];
		if (!tpl) throw new Error("no templates");
		const c = stubAuthor(makeSample({ artifactId: "src/foo.ts" }), tpl, "alpha");
		expect(c.draft.id).toContain(tpl.id);
		// The artifactId is preserved on the evidence row, not the id, so
		// reviewers can map an id back via the evidence array.
		expect(c.draft.expectedEvidence[0]?.artifactId).toBe("src/foo.ts");
	});

	it("propagates template fields onto the draft", () => {
		const tpl = RECIPE_TEMPLATES[0];
		if (!tpl) throw new Error("no templates");
		const c = stubAuthor(makeSample({ artifactId: "x" }), tpl, "alpha");
		expect(c.draft.queryType).toBe(tpl.queryType);
		expect(c.draft.difficulty).toBe(tpl.difficulty);
		expect(c.draft.targetLayerHints).toEqual(tpl.targetLayerHints);
	});

	it("populates expectedEvidence from the sample's artifactId", () => {
		const c = stubAuthor(
			makeSample({ artifactId: "doc/specific.md" }),
			RECIPE_TEMPLATES[0],
			"alpha",
		);
		expect(c.draft.expectedEvidence).toEqual([
			{ artifactId: "doc/specific.md", required: true },
		]);
	});

	it("flags itself as a stub via migrationNotes", () => {
		const c = stubAuthor(makeSample({ artifactId: "x" }), RECIPE_TEMPLATES[0], "alpha");
		expect(c.draft.migrationNotes).toContain("stub-authored");
	});
});

describe("parseArgs", () => {
	it("requires --collection", () => {
		expect(() => parseArgs([])).toThrow(/usage/);
	});
	it("rejects unknown flags", () => {
		expect(() => parseArgs(["--collection", "x", "--bogus"])).toThrow(/unknown flag/);
	});
	it("rejects non-numeric --samples-per-stratum", () => {
		expect(() => parseArgs(["--collection", "x", "--samples-per-stratum", "abc"])).toThrow(
			/positive integer/,
		);
	});
	it("rejects zero or negative --max-candidates", () => {
		expect(() => parseArgs(["--collection", "x", "--max-candidates", "0"])).toThrow(
			/positive integer/,
		);
	});
	it("accepts --seed=0 (integer, not positive)", () => {
		const a = parseArgs(["--collection", "x", "--seed", "0"]);
		expect(a.seed).toBe(0);
	});
	it("--dry-run is a boolean flag", () => {
		const a = parseArgs(["--collection", "x", "--dry-run"]);
		expect(a.dryRun).toBe(true);
	});
});

describe("stub candidate id stability", () => {
	it("produces collision-free ids for artifacts that share a 24-char prefix", () => {
		const a = stubAuthor(
			makeSample({ artifactId: "very/long/path/that/has/a/common/prefix/file-A.ts" }),
			RECIPE_TEMPLATES[0]!,
			"alpha",
		);
		const b = stubAuthor(
			makeSample({ artifactId: "very/long/path/that/has/a/common/prefix/file-B.ts" }),
			RECIPE_TEMPLATES[0]!,
			"alpha",
		);
		expect(a.draft.id).not.toBe(b.draft.id);
	});
	it("emits the same id for identical inputs (deterministic)", () => {
		const a = stubAuthor(
			makeSample({ artifactId: "foo.ts" }),
			RECIPE_TEMPLATES[0]!,
			"alpha",
		);
		const b = stubAuthor(
			makeSample({ artifactId: "foo.ts" }),
			RECIPE_TEMPLATES[0]!,
			"alpha",
		);
		expect(a.draft.id).toBe(b.draft.id);
	});
});

describe("RECIPE_TEMPLATES set", () => {
	it("has between 8 and 15 templates (peer-review constraint)", () => {
		expect(RECIPE_TEMPLATES.length).toBeGreaterThanOrEqual(8);
		expect(RECIPE_TEMPLATES.length).toBeLessThanOrEqual(15);
	});

	it("every template has a distinct id", () => {
		const ids = RECIPE_TEMPLATES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every template has a non-empty exampleSurface and intent", () => {
		for (const t of RECIPE_TEMPLATES) {
			expect(t.intent.length).toBeGreaterThan(0);
			expect(t.exampleSurface.length).toBeGreaterThan(0);
		}
	});
});
