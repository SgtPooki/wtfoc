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

import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOpenIssues, openIssuesToPromptLines, type OpenIssueSummary } from "./open-issues.js";
import {
	DEFAULT_ALLOWED_PATHS,
	DEFAULT_MAX_DIFF_LINES,
	type Edit,
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
];

// Curated files inlined into the prompt. AEON has 64K context; with 2
// curated files at ~16K chars each plus system + finding + tried-log,
// total is well under the model's window. 8K (the prior cap) silently
// truncated relevant code. Override via WTFOC_PATCH_MAX_FILE_CHARS.
const MAX_FILE_CHARS = Number.parseInt(
	process.env.WTFOC_PATCH_MAX_FILE_CHARS ?? "",
	10,
) || 24_000;
const MAX_TOTAL_PROMPT_CHARS = 120_000;

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
- A baseSha (current HEAD) — your edits will be applied at that commit.

Your job: emit ONE focused code edit (or short multi-edit) that you believe will fix the regression OR explain that no proposal is appropriate.

OUTPUT FORMAT (strict):

## Analysis
<root-cause hypothesis, under 300 words>

## Edits
\`\`\`json
[
  {
    "file": "<path from curated set, exactly as shown>",
    "old": "<exact substring to find — must appear EXACTLY ONCE in the file>",
    "new": "<replacement string>"
  }
]
\`\`\`

If you have no confident proposal, emit:

## Edits
\`\`\`json
[]
\`\`\`

RULES:
1. \`old\` MUST appear exactly once in the named file. To guarantee this, include AT LEAST 3 lines of context (the line you're changing plus surrounding lines). Single-token \`old\` strings will be rejected as ambiguous.
2. \`old\` and \`new\` must be byte-exact. Preserve indentation (tabs, not spaces) and trailing whitespace from the source. The harness applies edits by exact-string match; whitespace mismatch causes rejection.
3. \`new\` is the COMPLETE replacement for \`old\` (not a delta). Every line you want to keep must appear in \`new\`. If you only want to add a line, include the surrounding lines in both \`old\` and \`new\`.
4. Touch only files in the curated set. Paths must match exactly.
5. Each edit ≤ 30 lines. Keep changes minimal and focused.
6. Stay under 200 total added+removed lines across all edits.
7. Do NOT include line numbers or unified-diff hunk headers — this is search/replace, not diff.
8. Do NOT propose changes that already appear in the tried-log.

EXAMPLE of a valid edit (note 4 lines of context, full replacement, preserved tabs):

\`\`\`json
[
  {
    "file": "packages/search/src/trace/trace.ts",
    "old": "\\tconst maxPerSource = options?.maxPerSource ?? 3;\\n\\tconst maxTotal = options?.maxTotal ?? 15;\\n\\tconst maxHops = options?.maxHops ?? 3;\\n\\tconst minScore = options?.minScore ?? 0.3;",
    "new": "\\tconst maxPerSource = options?.maxPerSource ?? 5;\\n\\tconst maxTotal = options?.maxTotal ?? 25;\\n\\tconst maxHops = options?.maxHops ?? 4;\\n\\tconst minScore = options?.minScore ?? 0.25;"
  }
]
\`\`\``;

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
 * Parse a JSON-schema-constrained response (whole content is JSON).
 * Used when WTFOC_LLM_NO_JSON_SCHEMA is unset (the default). Returns
 * empty array when the LLM emits `edits: []`, null on parse failure.
 */
export function parseSchemaResponse(content: string): readonly Edit[] | null {
	try {
		const parsed = JSON.parse(content) as { edits?: unknown };
		if (!Array.isArray(parsed.edits)) return null;
		const out: Edit[] = [];
		for (const item of parsed.edits) {
			if (
				item &&
				typeof item === "object" &&
				typeof (item as { file?: unknown }).file === "string" &&
				typeof (item as { old?: unknown }).old === "string" &&
				typeof (item as { new?: unknown }).new === "string"
			) {
				const e = item as Edit;
				out.push({ file: e.file, old: e.old, new: e.new });
			}
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * Pull the search/replace edits out of the LLM's "## Edits" JSON
 * block. Tolerant of formatting drift (extra prose around the fence,
 * leading whitespace, optional language tag, alternative fence
 * labels). Returns null when no parseable block found, empty array
 * when the LLM intentionally emitted `[]`.
 *
 * Used as a fallback when WTFOC_LLM_NO_JSON_SCHEMA=1 (e.g. for an
 * endpoint that doesn't support json_schema response_format).
 */
export function parseEditsBlock(content: string): readonly Edit[] | null {
	const idx = content.indexOf("## Edits");
	if (idx < 0) return null;
	const after = content.slice(idx);
	const fence = after.match(/```(?:json)?\s*\n([\s\S]*?)```/);
	if (!fence || !fence[1]) return null;
	const raw = fence[1].trim();
	if (raw.length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const out: Edit[] = [];
	for (const item of parsed) {
		if (
			item &&
			typeof item === "object" &&
			typeof (item as { file?: unknown }).file === "string" &&
			typeof (item as { old?: unknown }).old === "string" &&
			typeof (item as { new?: unknown }).new === "string"
		) {
			const e = item as Edit;
			out.push({ file: e.file, old: e.old, new: e.new });
		}
	}
	return out;
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
	const envTimeout = process.env.WTFOC_LLM_TIMEOUT_MS
		? Number.parseInt(process.env.WTFOC_LLM_TIMEOUT_MS, 10)
		: undefined;
	const timeoutMs =
		input.timeoutMs ?? (envTimeout && Number.isFinite(envTimeout) ? envTimeout : 600_000);
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
		// Schema-constrained output. Forces valid JSON with byte-exact
		// tabs/whitespace and prevents mid-string truncation (truncated
		// JSON would be invalid; vllm's xgrammar/Outlines guards this).
		// AEON-class Qwen3.6 reliably honors json_schema. Disable via
		// WTFOC_LLM_NO_JSON_SCHEMA=1 if your endpoint rejects it.
		const useJsonSchema = process.env.WTFOC_LLM_NO_JSON_SCHEMA !== "1";
		const responseFormat = useJsonSchema
			? {
					response_format: {
						type: "json_schema",
						json_schema: {
							name: "patch_proposal",
							schema: {
								type: "object",
								required: ["analysis", "edits"],
								properties: {
									analysis: { type: "string" },
									edits: {
										type: "array",
										items: {
											type: "object",
											required: ["file", "old", "new"],
											properties: {
												file: { type: "string" },
												old: { type: "string" },
												new: { type: "string" },
											},
										},
									},
								},
							},
						},
					},
				}
			: {};
		const res = await fetchFn(`${url.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				temperature: 0.2,
				max_tokens: Number.parseInt(process.env.WTFOC_LLM_PATCH_MAX_TOKENS ?? "", 10) || 8000,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: userPrompt },
				],
				...(process.env.WTFOC_LLM_DISABLE_THINKING === "1"
					? { chat_template_kwargs: { enable_thinking: false } }
					: {}),
				...responseFormat,
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
		const edits = useJsonSchema ? parseSchemaResponse(content) : parseEditsBlock(content);
		if (!edits || edits.length === 0) {
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
			edits,
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
	const editsIdx = content.indexOf("## Edits", start);
	const end = editsIdx > 0 ? editsIdx : content.length;
	return content.slice(start, end).trim().slice(0, 600);
}
