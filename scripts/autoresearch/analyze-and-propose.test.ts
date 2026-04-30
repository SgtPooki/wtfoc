import { describe, expect, it, vi } from "vitest";
import { analyzeAndPropose, buildUserPrompt, parseProposalBlock } from "./analyze-and-propose.js";
import type { TriedLogRow } from "./tried-log.js";

describe("buildUserPrompt", () => {
	it("includes knob inventory + tried-log + finding context", () => {
		const prompt = buildUserPrompt({
			matrixName: "retrieval-baseline",
			explainMarkdown: "## Identity\nvariant: x",
			triedRows: [],
		});
		expect(prompt).toContain("Knob inventory");
		expect(prompt).toContain("- topK");
		expect(prompt).toContain("Past attempts");
		expect(prompt).toContain("Finding context");
		expect(prompt).toContain("variant: x");
	});

	it("filters tried-log by matrix", () => {
		const tried: TriedLogRow[] = [
			{
				schemaVersion: 1,
				loggedAt: new Date().toISOString(),
				matrixName: "retrieval-baseline",
				variantId: "x",
				proposal: { axis: "topK", value: 15, rationale: "first try" },
				verdict: "rejected",
				reasons: [],
			},
			{
				schemaVersion: 1,
				loggedAt: new Date().toISOString(),
				matrixName: "OTHER-matrix",
				variantId: "y",
				proposal: { axis: "topK", value: 20, rationale: "wrong matrix" },
				verdict: "rejected",
				reasons: [],
			},
		];
		const prompt = buildUserPrompt({
			matrixName: "retrieval-baseline",
			explainMarkdown: "...",
			triedRows: tried,
		});
		expect(prompt).toContain("topK=15");
		expect(prompt).not.toContain("topK=20");
	});
});

describe("parseProposalBlock", () => {
	it("parses a fenced JSON block", () => {
		const content = `## Analysis\nblah blah\n\n## Proposal\n\n\`\`\`json\n{ "axis": "topK", "value": 15, "rationale": "more candidates" }\n\`\`\``;
		const p = parseProposalBlock(content);
		expect(p?.axis).toBe("topK");
		expect(p?.value).toBe(15);
	});

	it("returns null when axis is null", () => {
		const content = `## Analysis\n...\n## Proposal\n\`\`\`json\n{ "axis": null }\n\`\`\``;
		expect(parseProposalBlock(content)).toBeNull();
	});

	it("returns null when no Proposal section", () => {
		expect(parseProposalBlock("## Analysis only")).toBeNull();
	});

	it("returns null when JSON malformed", () => {
		const content = "## Proposal\n```json\n{ axis: bare-word }\n```";
		expect(parseProposalBlock(content)).toBeNull();
	});

	it("tolerates JSON without fences (best-effort)", () => {
		const content = `## Proposal\n{ "axis": "diversityEnforce", "value": false, "rationale": "test" }`;
		const p = parseProposalBlock(content);
		expect(p?.axis).toBe("diversityEnforce");
		expect(p?.value).toBe(false);
	});
});

describe("analyzeAndPropose", () => {
	function mockLlm(content: string): typeof fetch {
		return vi.fn(async () =>
			new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;
	}

	it("returns parsed proposal on a successful LLM response", async () => {
		const llm = mockLlm(
			`## Analysis\nlooks like K=10 too narrow.\n\n## Proposal\n\`\`\`json\n{ "axis": "topK", "value": 15, "rationale": "wider K" }\n\`\`\``,
		);
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.ok).toBe(true);
		expect(res.llmCallSucceeded).toBe(true);
		expect(res.proposal).not.toBeNull();
		expect(res.proposal?.axis).toBe("topK");
		expect(res.proposal?.value).toBe(15);
	});

	it("rejects LLM proposals that violate the knob inventory (out-of-range)", async () => {
		const llm = mockLlm(
			`## Analysis\n.\n\n## Proposal\n\`\`\`json\n{ "axis": "topK", "value": 100, "rationale": "x" }\n\`\`\``,
		);
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.ok).toBe(true);
		expect(res.llmCallSucceeded).toBe(true);
		expect(res.proposal).toBeNull();
		expect(res.error).toMatch(/outside/);
	});

	it("rejects unknown knob name", async () => {
		const llm = mockLlm(
			`## Analysis\n.\n\n## Proposal\n\`\`\`json\n{ "axis": "embedderModel", "value": "swap-me", "rationale": "x" }\n\`\`\``,
		);
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.proposal).toBeNull();
		expect(res.error).toMatch(/unknown knob/);
	});

	it("returns null proposal when LLM emits axis=null", async () => {
		const llm = mockLlm(`## Analysis\n.\n\n## Proposal\n\`\`\`json\n{ "axis": null }\n\`\`\``);
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.ok).toBe(true);
		expect(res.proposal).toBeNull();
		expect(res.error).toBeUndefined();
	});

	it("fails soft on LLM HTTP error", async () => {
		const llm = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.ok).toBe(false);
		expect(res.llmCallSucceeded).toBe(false);
		expect(res.error).toMatch(/HTTP 500/);
	});

	it("fails soft on LLM transport error", async () => {
		const llm = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const res = await analyzeAndPropose({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			fetchFn: llm,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/ECONNREFUSED/);
	});
});
