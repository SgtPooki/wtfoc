/**
 * Local-LLM code-patch proposer for the autonomous loop.
 * Maintainer-only.
 *
 * Companion to `analyze-and-propose.ts`. When the planner queue of
 * config knobs is exhausted (or when env-flagged), the loop calls this
 * module to ask the LLM for a unified-diff against a curated set of
 * `packages/search/src/` files.
 *
 * Hard rules:
 *   - LLM endpoint comes from env (`WTFOC_PATCH_LLM_URL`, falls back to
 *     `WTFOC_ANALYSIS_LLM_URL`, then `http://127.0.0.1:4523/v1`).
 *   - The diff MUST stay inside the allowlist enforced by
 *     `patch-proposal.ts:validatePatch`. Default allowlist:
 *     `packages/search/src/`.
 *   - Diff size capped (default 200 lines added+removed).
 *   - One patch per cycle. The materializer runs the SAME A/B harness
 *     as config proposals; promotion is a draft PR.
 *
 * The prompt includes:
 *   - The flipped-queries explainFinding markdown (so the LLM has
 *     evidence of WHAT broke and where).
 *   - A curated set of source files inlined verbatim, so the LLM can
 *     emit diffs against real line numbers and avoid hallucinating
 *     symbols.
 *   - The current `git rev-parse HEAD` SHA so the proposal carries a
 *     real `baseSha` and the materializer can `git worktree add` at
 *     that point cleanly.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOpenIssues, openIssuesToPromptLines, type OpenIssueSummary } from "./open-issues.js";
import {
	DEFAULT_ALLOWED_PATHS,
	DEFAULT_MAX_DIFF_LINES,
	type PatchProposal,
	validatePatch,
} from "./patch-proposal.js";
import { type TriedLogRow, triedLogPromptLines } from "./tried-log.js";

export const DEFAULT_PATCH_LLM_URL = "http://127.0.0.1:4523/v1";
export const DEFAULT_PATCH_LLM_MODEL = "haiku";

/**
 * Default curated file set. The patch proposer inlines these so the
 * LLM can reason about line numbers + types without hallucinating.
 * Keep it small — total prompt size matters. Override via the
 * `curatedFiles` input or the WTFOC_PATCH_CURATED_FILES env (comma-
 * separated paths relative to repo root).
 */
export const DEFAULT_CURATED_FILES: readonly string[] = [
	"packages/search/src/query.ts",
	"packages/search/src/trace/trace.ts",
	"packages/search/src/diversity.ts",
];

const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_PROMPT_CHARS = 60_000;

export interface AnalyzeProposePatchInputs {
	matrixName: string;
	explainMarkdown: string;
	triedRows: readonly TriedLogRow[];
	llmUrl?: string;
	llmModel?: string;
	llmApiKey?: string;
	timeoutMs?: number;
	repoRoot?: string;
	curatedFiles?: readonly string[];
	allowedPaths?: readonly string[];
	maxDiffLines?: number;
	fetchFn?: typeof fetch;
	/**
	 * Open GitHub issues to surface to the LLM as proposal context.
	 * When unset, fetched lazily via `gh issue list`. Tests pass [] to
	 * disable.
	 */
	openIssues?: readonly OpenIssueSummary[];
	/** Override git rev-parse HEAD lookup (testing). */
	baseShaOverride?: string;
}

export interface AnalyzeProposePatchResult {
	ok: boolean;
	analysisMarkdown: string;
	proposal: PatchProposal | null;
	llmCallSucceeded: boolean;
	error?: string;
	rawContent?: string;
}

const SYSTEM_PROMPT = `You are an autoresearch agent for a retrieval system called wtfoc. You propose CODE CHANGES (not config tweaks) to fix regressions.

You will receive:
- A regression finding with flipped queries, retrieved chunks, and gold-source proximity diagnostics.
- A summary of past attempts on this matrix (so you don't repeat yourself).
- A curated set of source files inlined verbatim. Their paths are fixed; you can only modify files in this set.
- A baseSha (current HEAD) — your patch will be applied at that commit.

Your job: emit ONE unified diff that you believe will fix the regression OR explain that no proposal is appropriate.

Output rules:
1. Two sections, in order:
   - "## Analysis" — root-cause hypothesis (under 300 words)
   - "## Patch" — a single fenced block tagged \`diff\` containing a unified diff, OR the literal string "NO_PATCH" when you have no high-confidence proposal.
2. The diff MUST:
   - Touch only files from the curated set (paths exactly as listed).
   - Use \`diff --git a/<path> b/<path>\` headers and \`@@ ... @@\` hunk headers.
   - Be minimal — one focused change. Multi-file refactors are out of scope.
   - Stay under 200 added+removed lines.
3. Do NOT include the baseSha in the diff — the harness applies it at that commit automatically.
4. Do NOT propose changes that already appear in the tried-log (same axis-equivalent change). The maintainer would rather see "I don't know" than a duplicate.
5. If the regression is a hard-gate breach, your patch must target the breached metric specifically.

Worked example of an acceptable patch:

\`\`\`diff
diff --git a/packages/search/src/diversity.ts b/packages/search/src/diversity.ts
--- a/packages/search/src/diversity.ts
+++ b/packages/search/src/diversity.ts
@@ -42,7 +42,7 @@ export function applyDiversity(results, opts) {
   for (const r of results) {
-    if (seen.has(r.sourceType)) continue;
+    if (seen.has(r.sourceType) && r.score < topScore * 0.7) continue;
     out.push(r);
     seen.add(r.sourceType);
   }
\`\`\`

If you cannot propose a confident, focused patch, emit:

## Patch

NO_PATCH`;

export function buildPatchUserPrompt(input: {
	matrixName: string;
	explainMarkdown: string;
	triedRows: readonly TriedLogRow[];
	openIssues: readonly OpenIssueSummary[];
	curatedFileContents: ReadonlyArray<{ path: string; body: string }>;
	baseSha: string;
}): string {
	const triedLines = triedLogPromptLines(input.triedRows, input.matrixName);
	const issueLines = openIssuesToPromptLines(input.openIssues);
	const fileBlocks: string[] = [];
	for (const f of input.curatedFileContents) {
		fileBlocks.push(`### \`${f.path}\``);
		fileBlocks.push("```typescript");
		fileBlocks.push(f.body);
		fileBlocks.push("```");
		fileBlocks.push("");
	}
	return [
		`# baseSha: ${input.baseSha}`,
		"",
		"# Open GitHub issues (proposal source — correlate with the regression)",
		"",
		...issueLines,
		"",
		"# Past attempts on this matrix (config + patch proposals)",
		"",
		...triedLines,
		"",
		"# Finding context",
		"",
		input.explainMarkdown,
		"",
		"# Curated source files (only these may be modified)",
		"",
		...fileBlocks,
	].join("\n");
}

const HERE = (() => {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return process.cwd();
	}
})();

function defaultRepoRoot(): string {
	return resolve(HERE, "..", "..");
}

function readCuratedFiles(
	repoRoot: string,
	paths: readonly string[],
): Array<{ path: string; body: string }> {
	const out: Array<{ path: string; body: string }> = [];
	let totalChars = 0;
	for (const p of paths) {
		const abs = join(repoRoot, p);
		if (!existsSync(abs)) continue;
		try {
			const st = statSync(abs);
			if (!st.isFile()) continue;
			let body = readFileSync(abs, "utf-8");
			if (body.length > MAX_FILE_CHARS) {
				body = `${body.slice(0, MAX_FILE_CHARS)}\n// ... (file truncated to ${MAX_FILE_CHARS} chars)`;
			}
			if (totalChars + body.length > MAX_TOTAL_PROMPT_CHARS) break;
			totalChars += body.length;
			out.push({ path: p, body });
		} catch {
			// skip
		}
	}
	return out;
}

function readGitHead(repoRoot: string): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
}

interface OpenAIChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Pull the unified diff out of the LLM's "## Patch" section. Tolerant
 * of formatting drift (extra prose around the fenced block, leading
 * whitespace, alternative fence labels). Returns null when no diff
 * found OR when the LLM emitted "NO_PATCH" intentionally.
 */
export function parsePatchBlock(content: string): string | null {
	const idx = content.indexOf("## Patch");
	if (idx < 0) return null;
	const after = content.slice(idx);
	if (/NO_PATCH/i.test(after)) return null;
	const fence = after.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/);
	if (!fence || !fence[1]) return null;
	const raw = fence[1].trim();
	if (raw.length === 0) return null;
	return raw;
}

export async function analyzeAndProposePatch(
	input: AnalyzeProposePatchInputs,
): Promise<AnalyzeProposePatchResult> {
	const url =
		input.llmUrl ??
		process.env.WTFOC_PATCH_LLM_URL ??
		process.env.WTFOC_ANALYSIS_LLM_URL ??
		DEFAULT_PATCH_LLM_URL;
	const model = input.llmModel ?? process.env.WTFOC_PATCH_LLM_MODEL ?? DEFAULT_PATCH_LLM_MODEL;
	const apiKey =
		input.llmApiKey ?? process.env.WTFOC_PATCH_LLM_API_KEY ?? process.env.WTFOC_ANALYSIS_LLM_API_KEY ?? "";
	const fetchFn = input.fetchFn ?? fetch;
	const timeoutMs = input.timeoutMs ?? 90_000;
	const repoRoot = input.repoRoot ?? defaultRepoRoot();
	const curatedPaths =
		input.curatedFiles ??
		(process.env.WTFOC_PATCH_CURATED_FILES
			? process.env.WTFOC_PATCH_CURATED_FILES.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
			: DEFAULT_CURATED_FILES);
	const curatedFileContents = readCuratedFiles(repoRoot, curatedPaths);
	const baseSha = input.baseShaOverride ?? readGitHead(repoRoot);
	if (!baseSha) {
		return {
			ok: false,
			analysisMarkdown: "",
			proposal: null,
			llmCallSucceeded: false,
			error: "could not resolve git HEAD — patch proposer requires a clean repo",
		};
	}
	if (curatedFileContents.length === 0) {
		return {
			ok: false,
			analysisMarkdown: "",
			proposal: null,
			llmCallSucceeded: false,
			error: `no curated files readable; checked ${curatedPaths.join(", ")}`,
		};
	}

	const openIssues = input.openIssues ?? fetchOpenIssues();
	const userPrompt = buildPatchUserPrompt({
		matrixName: input.matrixName,
		explainMarkdown: input.explainMarkdown,
		triedRows: input.triedRows,
		openIssues,
		curatedFileContents,
		baseSha,
	});

	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const res = await fetchFn(`${url.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				temperature: 0.2,
				max_tokens: 3000,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: userPrompt },
				],
			}),
			signal: ac.signal,
		});
		if (!res.ok) {
			return {
				ok: false,
				analysisMarkdown: "",
				proposal: null,
				llmCallSucceeded: false,
				error: `LLM HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`,
			};
		}
		const body = (await res.json()) as OpenAIChatCompletionResponse;
		const content = body.choices?.[0]?.message?.content ?? "";
		const diff = parsePatchBlock(content);
		if (!diff) {
			return {
				ok: true,
				analysisMarkdown: content,
				proposal: null,
				llmCallSucceeded: true,
				rawContent: content,
			};
		}
		const candidate: PatchProposal = {
			kind: "patch",
			baseSha,
			unifiedDiff: diff,
			rationale: extractAnalysis(content),
		};
		const validation = validatePatch(candidate, {
			allowedPaths: input.allowedPaths ?? DEFAULT_ALLOWED_PATHS,
			maxDiffLines: input.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES,
		});
		if (!validation.ok) {
			return {
				ok: true,
				analysisMarkdown: content,
				proposal: null,
				llmCallSucceeded: true,
				error: `LLM proposed invalid patch: ${validation.errors.join("; ")}`,
				rawContent: content,
			};
		}
		return {
			ok: true,
			analysisMarkdown: content,
			proposal: candidate,
			llmCallSucceeded: true,
			rawContent: content,
		};
	} catch (err) {
		return {
			ok: false,
			analysisMarkdown: "",
			proposal: null,
			llmCallSucceeded: false,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

function extractAnalysis(content: string): string {
	const idx = content.indexOf("## Analysis");
	if (idx < 0) return content.slice(0, 400);
	const start = idx + "## Analysis".length;
	const patchIdx = content.indexOf("## Patch", start);
	const end = patchIdx > 0 ? patchIdx : content.length;
	return content.slice(start, end).trim().slice(0, 600);
}
