import type { QueryTemplate, RecipeSample } from "@wtfoc/search";
import { describe, expect, it, vi } from "vitest";
import { authorCandidate } from "./recipe-llm-author.js";

const TEMPLATE: QueryTemplate = {
	id: "trace-issue-to-impl",
	intent: "Walk from a discussion artifact to the code change.",
	queryType: "trace",
	difficulty: "hard",
	targetLayerHints: ["edge-extraction", "trace"],
	exampleSurface: "Which PR closed the issue about X?",
};

const SAMPLE: RecipeSample = {
	stratum: { sourceType: "github-issue", edgeType: "closes", lengthBucket: "short", rarity: "common" },
	artifact: { artifactId: "owner/repo#42", sourceType: "github-issue", contentLength: 500 },
};

function makeFetchOk(content: string): typeof fetch {
	return vi.fn(async () => ({
		ok: true,
		status: 200,
		text: async () => "",
		json: async () => ({ choices: [{ message: { content } }] }),
	})) as unknown as typeof fetch;
}

function makeFetchError(status: number, body: string): typeof fetch {
	return vi.fn(async () => ({
		ok: false,
		status,
		text: async () => body,
		json: async () => ({}),
	})) as unknown as typeof fetch;
}

describe("authorCandidate (live LLM)", () => {
	it("parses a clean JSON response and shapes a CandidateQuery", async () => {
		const fetchFn = makeFetchOk(
			JSON.stringify({
				query: "Which pull request landed the rate-limit policy change?",
				acceptableAnswerFacts: ["The change introduced a 60s window."],
				rationale: "Requires linking PR to issue via closes edge.",
			}),
		);
		const r = await authorCandidate(SAMPLE, TEMPLATE, {
			collectionId: "alpha",
			fetchFn,
		});
		expect(r.ok).toBe(true);
		expect(r.candidate?.draft.query).toBe(
			"Which pull request landed the rate-limit policy change?",
		);
		expect(r.candidate?.draft.queryType).toBe("trace");
		expect(r.candidate?.draft.difficulty).toBe("hard");
		expect(r.candidate?.draft.applicableCorpora).toEqual(["alpha"]);
		expect(r.candidate?.draft.expectedEvidence[0]?.artifactId).toBe("owner/repo#42");
		expect(r.candidate?.draft.acceptableAnswerFacts).toEqual([
			"The change introduced a 60s window.",
		]);
		expect(r.candidate?.draft.migrationNotes).toContain("live-author rationale");
	});

	it("extracts JSON from a fenced code block", async () => {
		const fetchFn = makeFetchOk(
			"Sure, here is the query:\n\n```json\n{\"query\":\"abstract Q\",\"rationale\":\"r\"}\n```\n",
		);
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.ok).toBe(true);
		expect(r.candidate?.draft.query).toBe("abstract Q");
	});

	it("returns ok=false with rawContent when JSON is unparseable", async () => {
		const fetchFn = makeFetchOk("the model emitted only prose, no JSON here");
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.ok).toBe(false);
		expect(r.error).toContain("parseable");
		expect(r.rawContent).toContain("emitted only prose");
	});

	it("returns ok=false with status detail on HTTP error", async () => {
		const fetchFn = makeFetchError(500, "internal server explosion");
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/HTTP 500/);
	});

	it("rejects empty / non-string queries", async () => {
		const fetchFn = makeFetchOk(JSON.stringify({ query: "" }));
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.ok).toBe(false);
	});

	it("filters out non-string acceptableAnswerFacts", async () => {
		const fetchFn = makeFetchOk(
			JSON.stringify({
				query: "abstract Q",
				acceptableAnswerFacts: ["valid", null, 42, "another"],
			}),
		);
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.ok).toBe(true);
		expect(r.candidate?.draft.acceptableAnswerFacts).toEqual(["valid", "another"]);
	});

	it("propagates the template's queryType / difficulty / targetLayerHints", async () => {
		const fetchFn = makeFetchOk(JSON.stringify({ query: "q" }));
		const r = await authorCandidate(SAMPLE, TEMPLATE, { collectionId: "alpha", fetchFn });
		expect(r.candidate?.draft.queryType).toBe(TEMPLATE.queryType);
		expect(r.candidate?.draft.difficulty).toBe(TEMPLATE.difficulty);
		expect(r.candidate?.draft.targetLayerHints).toEqual(TEMPLATE.targetLayerHints);
	});

	it("includes the excerpt in the user prompt when provided", async () => {
		const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(init.body as string) as {
				messages: Array<{ content: string }>;
			};
			expect(body.messages[1]?.content).toContain("excerpt-marker-XYZ");
			return {
				ok: true,
				status: 200,
				text: async () => "",
				json: async () => ({
					choices: [{ message: { content: JSON.stringify({ query: "q" }) } }],
				}),
			};
		}) as unknown as typeof fetch;
		const r = await authorCandidate(SAMPLE, TEMPLATE, {
			collectionId: "alpha",
			fetchFn,
			excerpt: "function foo() { /* excerpt-marker-XYZ */ }",
		});
		expect(r.ok).toBe(true);
	});
});
