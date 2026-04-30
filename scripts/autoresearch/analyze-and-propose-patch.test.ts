import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	analyzeAndProposePatch,
	buildPatchUserPrompt,
	parsePatchBlock,
} from "./analyze-and-propose-patch.js";
import type { TriedLogRow } from "./tried-log.js";

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

describe("parsePatchBlock", () => {
	it("extracts a fenced diff block", () => {
		const content = `## Analysis\nlooks like diversity is too tight.\n\n## Patch\n\n\`\`\`diff\ndiff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1,1 +1,1 @@\n-old\n+new\n\`\`\``;
		const d = parsePatchBlock(content);
		expect(d).not.toBeNull();
		expect(d).toContain("diff --git");
		expect(d).toContain("+new");
	});

	it("returns null on NO_PATCH literal", () => {
		const content = "## Analysis\nnothing to do.\n\n## Patch\n\nNO_PATCH\n";
		expect(parsePatchBlock(content)).toBeNull();
	});

	it("returns null when no Patch section", () => {
		expect(parsePatchBlock("## Analysis only")).toBeNull();
	});

	it("returns null when Patch section is empty", () => {
		expect(parsePatchBlock("## Patch\n\n```diff\n```")).toBeNull();
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

	it("returns a valid proposal on a successful LLM response", async () => {
		const repo = tmpRepo();
		// Write a fake HEAD ref so git rev-parse can resolve.
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(repo, ".git", "refs", "heads", "main"), "1234567890abcdef\n");

		const validDiff = `diff --git a/packages/search/src/query.ts b/packages/search/src/query.ts
--- a/packages/search/src/query.ts
+++ b/packages/search/src/query.ts
@@ -1,1 +1,1 @@
-export function query() { return 0; }
+export function query() { return 1; }
`;
		const llm = mockLlm(
			`## Analysis\ndiversity threshold is too tight.\n\n## Patch\n\n\`\`\`diff\n${validDiff}\`\`\``,
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
		expect(res.proposal?.unifiedDiff).toContain("diff --git");
	});

	it("rejects an LLM patch outside the allowlist", async () => {
		const repo = tmpRepo();
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(repo, ".git", "refs", "heads", "main"), "1234567890abcdef\n");

		const badDiff = `diff --git a/scripts/dogfood.ts b/scripts/dogfood.ts
--- a/scripts/dogfood.ts
+++ b/scripts/dogfood.ts
@@ -1,1 +1,1 @@
-old
+new
`;
		const llm = mockLlm(`## Analysis\nx\n\n## Patch\n\`\`\`diff\n${badDiff}\`\`\``);
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

	it("returns null proposal on NO_PATCH (no error)", async () => {
		const repo = tmpRepo();
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(repo, ".git", "refs", "heads", "main"), "1234567890abcdef\n");

		const llm = mockLlm("## Analysis\nuncertain.\n\n## Patch\nNO_PATCH\n");
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
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(repo, ".git", "refs", "heads", "main"), "1234567890abcdef\n");

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
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(repo, ".git", "refs", "heads", "main"), "1234567890abcdef\n");

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
