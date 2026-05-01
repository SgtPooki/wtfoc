import type { DocumentCatalog } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import {
	type PreflightCatalogEntry,
	renderPreflightMarkdown,
	runPreflight,
} from "./catalog-applicability-preflight.js";
import type { GoldQuery } from "./gold-standard-queries.js";

function makeCatalog(corpusId: string, ids: string[]): DocumentCatalog {
	const documents: DocumentCatalog["documents"] = {};
	for (const id of ids) {
		documents[id] = {
			documentId: id,
			currentVersionId: "v1",
			previousVersionIds: [],
			chunkIds: [`${id}#0`],
			contentFingerprints: ["x"],
			sourceType: "code",
			mutability: "append-only",
			state: "active",
			supersededChunkIds: [],
			updatedAt: new Date().toISOString(),
		};
	}
	return { schemaVersion: 1, collectionId: corpusId, documents };
}

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

describe("runPreflight", () => {
	const alpha: PreflightCatalogEntry = {
		corpusId: "alpha",
		catalog: makeCatalog("alpha", ["doc/a.ts", "doc/b.ts"]),
	};
	const beta: PreflightCatalogEntry = {
		corpusId: "beta",
		catalog: makeCatalog("beta", ["other/c.ts"]),
	};

	it("classifies a query whose required gold is in the catalog as applicable", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/a.ts", required: true }],
				}),
			],
			catalogs: [alpha, beta],
		});
		const result = summary.results.find((r) => r.queryId === "q1" && r.corpusId === "alpha");
		expect(result?.status).toBe("applicable");
		expect(result?.missingRequiredArtifacts).toEqual([]);
	});

	it("classifies a query as skipped on a corpus not in applicableCorpora", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/a.ts", required: true }],
				}),
			],
			catalogs: [alpha, beta],
		});
		const result = summary.results.find((r) => r.queryId === "q1" && r.corpusId === "beta");
		expect(result?.status).toBe("skipped");
	});

	it("classifies a query as invalid when required gold is missing from the catalog", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/missing.ts", required: true }],
				}),
			],
			catalogs: [alpha, beta],
		});
		const result = summary.results.find((r) => r.queryId === "q1" && r.corpusId === "alpha");
		expect(result?.status).toBe("invalid");
		expect(result?.missingRequiredArtifacts).toEqual(["doc/missing.ts"]);
	});

	it("classifies as applicable when at least one required artifact resolves (OR semantics)", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [
						{ artifactId: "doc/a.ts", required: true },
						{ artifactId: "doc/missing.ts", required: true },
					],
				}),
			],
			catalogs: [alpha],
		});
		const result = summary.results[0];
		expect(result?.status).toBe("applicable");
		// Diagnostic info still surfaces the unresolved row.
		expect(result?.missingRequiredArtifacts).toEqual(["doc/missing.ts"]);
	});

	it("classifies as invalid only when ALL required artifacts are unresolved", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [
						{ artifactId: "doc/missing-a.ts", required: true },
						{ artifactId: "doc/missing-b.ts", required: true },
					],
				}),
			],
			catalogs: [alpha],
		});
		expect(summary.results[0]?.status).toBe("invalid");
	});

	it("does not count required:false rows toward applicability", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [
						{ artifactId: "doc/a.ts", required: true },
						{ artifactId: "doc/missing.ts", required: false },
					],
				}),
			],
			catalogs: [alpha],
		});
		expect(summary.results[0]?.status).toBe("applicable");
	});

	it("hard-errors on duplicate query IDs", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({ id: "dupe", applicableCorpora: ["alpha"] }),
				makeQuery({ id: "dupe", applicableCorpora: ["alpha"] }),
			],
			catalogs: [alpha],
		});
		expect(summary.hardErrors.some((e) => e.includes("duplicate"))).toBe(true);
	});

	it("hard-errors on empty applicableCorpora", () => {
		const summary = runPreflight({
			queries: [makeQuery({ id: "empty", applicableCorpora: [] })],
			catalogs: [alpha],
		});
		expect(summary.hardErrors.some((e) => e.includes("empty applicableCorpora"))).toBe(true);
	});

	it("hard-errors when a query references a corpus not in the matrix", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["unknown-corpus"],
				}),
			],
			catalogs: [alpha],
		});
		expect(summary.hardErrors.some((e) => e.includes("unknown-corpus"))).toBe(true);
	});

	it("flags a corpus exceeding the invalid threshold", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "ok",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/a.ts", required: true }],
				}),
				makeQuery({
					id: "broken",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/missing.ts", required: true }],
				}),
			],
			catalogs: [alpha],
			invalidThresholdPercent: 20,
		});
		expect(summary.exceededInvalidThreshold).toContain("alpha");
	});

	it("reports zero invalid% when all applicable queries pass", () => {
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "ok",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/a.ts", required: true }],
				}),
			],
			catalogs: [alpha],
		});
		const corpus = summary.perCorpus.find((c) => c.corpusId === "alpha");
		expect(corpus?.invalidPercent).toBe(0);
		expect(summary.exceededInvalidThreshold).not.toContain("alpha");
	});

	it("ignores non-active documents in the catalog", () => {
		const cat = makeCatalog("alpha", ["doc/a.ts"]);
		const entry = cat.documents["doc/a.ts"];
		if (entry) entry.state = "archived";
		const summary = runPreflight({
			queries: [
				makeQuery({
					id: "q1",
					applicableCorpora: ["alpha"],
					expectedEvidence: [{ artifactId: "doc/a.ts", required: true }],
				}),
			],
			catalogs: [{ corpusId: "alpha", catalog: cat }],
		});
		expect(summary.results[0]?.status).toBe("invalid");
	});
});

describe("renderPreflightMarkdown", () => {
	it("emits a per-corpus stats table", () => {
		const md = renderPreflightMarkdown({
			results: [],
			perCorpus: [
				{
					corpusId: "alpha",
					total: 10,
					applicable: 7,
					skipped: 1,
					invalid: 2,
					invalidQueries: [],
					invalidPercent: 22,
				},
			],
			hardErrors: [],
			invalidThresholdPercent: 20,
			exceededInvalidThreshold: ["alpha"],
		});
		expect(md).toContain("`alpha`");
		expect(md).toContain("22%");
		expect(md).toContain("⚠️");
	});

	it("includes a hard-errors section when present", () => {
		const md = renderPreflightMarkdown({
			results: [],
			perCorpus: [],
			hardErrors: ["something broke"],
			invalidThresholdPercent: 20,
			exceededInvalidThreshold: [],
		});
		expect(md).toContain("Hard errors");
		expect(md).toContain("something broke");
	});
});
