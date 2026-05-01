import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	analyzeAndProposePatch,
	buildPatchUserPrompt,
	parseEditsBlock,
} from "./analyze-and-propose-patch.js";

function tmpRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "wtfoc-patch-"));
	mkdirSync(join(dir, "packages", "search", "src"), { recursive: true });
	writeFileSync(
		join(dir, "packages", "search", "src", "query.ts"),
		"export function query() { return 0; }\n",
	);
	mkdirSync(join(dir, ".git"));
	return dir;
}

function seedHead(repo: string, sha = "1234567890abcdef"): void {
	writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
	mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
	writeFileSync(join(repo, ".git", "refs", "heads", "main"), `${sha}\n`);
}

describe("buildPatchUserPrompt", () => {
	it("includes baseSha, issues section, tried-log section, finding context, and curated files", () => {
		const prompt = buildPatchUserPrompt({
			matrixName: "retrieval-baseline",
			explainMarkdown: "## Identity\nvariant: x",
			triedRows: [],
			openIssues: [
				{
					number: 99,
					title: "wl-1 brittleness",
					labels: ["regression"],
					bodyPreview: "wl-1 fails on paraphrase 3",
					createdAt: "2026-04-01",
				},
			],
			curatedFileContents: [{ path: "packages/search/src/x.ts", body: "export const a = 1;" }],
			baseSha: "abc1234567",
		});
		expect(prompt).toContain("baseSha: abc1234567");
		expect(prompt).toContain("Open GitHub issues");
		expect(prompt).toContain("#99 wl-1 brittleness");
		expect(prompt).toContain("Past attempts");
		expect(prompt).toContain("Finding context");
		expect(prompt).toContain("variant: x");
		expect(prompt).toContain("Curated source files");
		expect(prompt).toContain("packages/search/src/x.ts");
		expect(prompt).toContain("export const a = 1;");
	});
});

describe("parseEditsBlock", () => {
	it("extracts a fenced JSON edits block", () => {
		const content = `## Analysis\nlooks like diversity is too tight.\n\n## Edits\n\n\`\`\`json\n[\n  {"file":"packages/search/src/query.ts","old":"return 0;","new":"return 1;"}\n]\n\`\`\``;
		const edits = parseEditsBlock(content);
		expect(edits).not.toBeNull();
		expect(edits).toHaveLength(1);
		expect(edits?.[0]?.file).toBe("packages/search/src/query.ts");
		expect(edits?.[0]?.new).toBe("return 1;");
	});

	it("returns empty array on intentional no-proposal", () => {
		const content = "## Analysis\nuncertain.\n\n## Edits\n\n```json\n[]\n```";
		const edits = parseEditsBlock(content);
		expect(edits).toEqual([]);
	});

	it("returns null when no Edits section", () => {
		expect(parseEditsBlock("## Analysis only")).toBeNull();
	});

	it("returns null on malformed JSON", () => {
		expect(parseEditsBlock("## Edits\n```json\n{not json\n```")).toBeNull();
	});

	it("filters out malformed edit objects", () => {
		const content = `## Edits\n\`\`\`json\n[{"file":"a","old":"o","new":"n"},{"file":"b"}]\n\`\`\``;
		const edits = parseEditsBlock(content);
		expect(edits).toHaveLength(1);
	});
});

describe("analyzeAndProposePatch", () => {
	function mockLlm(content: string): typeof fetch {
		return vi.fn(async () =>
			new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;
	}

	it("returns a valid proposal on a successful LLM response (json_schema)", async () => {
		const repo = tmpRepo();
		seedHead(repo);
		const llm = mockLlm(
			JSON.stringify({
				analysis: "tweaking return value.",
				edits: [{ file: "packages/search/src/query.ts", old: "return 0;", new: "return 1;" }],
			}),
		);
		const res = await analyzeAndProposePatch({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			openIssues: [],
			curatedFiles: ["packages/search/src/query.ts"],
			repoRoot: repo,
			baseShaOverride: "1234567890abcdef",
			fetchFn: llm,
		});
		expect(res.ok).toBe(true);
		expect(res.proposal).not.toBeNull();
		expect(res.proposal?.kind).toBe("patch");
		expect(res.proposal?.edits).toHaveLength(1);
		expect(res.proposal?.edits[0]?.new).toBe("return 1;");
	});

	it("rejects an LLM proposal outside the allowlist", async () => {
		const repo = tmpRepo();
		seedHead(repo);
		const llm = mockLlm(
			JSON.stringify({
				analysis: "x",
				edits: [{ file: "scripts/dogfood.ts", old: "a", new: "b" }],
			}),
		);
		const res = await analyzeAndProposePatch({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			openIssues: [],
			curatedFiles: ["packages/search/src/query.ts"],
			repoRoot: repo,
			baseShaOverride: "1234567890abcdef",
			fetchFn: llm,
		});
		expect(res.proposal).toBeNull();
		expect(res.error).toMatch(/outside allowlist/);
	});

	it("returns null proposal on empty edits array (no error)", async () => {
		const repo = tmpRepo();
		seedHead(repo);
		const llm = mockLlm(JSON.stringify({ analysis: "uncertain.", edits: [] }));
		const res = await analyzeAndProposePatch({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			openIssues: [],
			curatedFiles: ["packages/search/src/query.ts"],
			repoRoot: repo,
			baseShaOverride: "1234567890abcdef",
			fetchFn: llm,
		});
		expect(res.ok).toBe(true);
		expect(res.proposal).toBeNull();
		expect(res.error).toBeUndefined();
	});

	it("fails soft when no curated files exist", async () => {
		const repo = tmpRepo();
		seedHead(repo);
		const llm = mockLlm("...");
		const res = await analyzeAndProposePatch({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			openIssues: [],
			curatedFiles: ["packages/nonexistent/src/foo.ts"],
			repoRoot: repo,
			baseShaOverride: "1234567890abcdef",
			fetchFn: llm,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/no curated files readable/);
	});

	it("fails soft on LLM HTTP error", async () => {
		const repo = tmpRepo();
		seedHead(repo);
		const llm = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
		const res = await analyzeAndProposePatch({
			matrixName: "retrieval-baseline",
			explainMarkdown: "stub",
			triedRows: [],
			openIssues: [],
			curatedFiles: ["packages/search/src/query.ts"],
			repoRoot: repo,
			baseShaOverride: "1234567890abcdef",
			fetchFn: llm,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/HTTP 500/);
	});
});
