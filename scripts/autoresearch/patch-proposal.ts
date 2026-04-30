/**
 * Code-change proposals for the autonomous loop. Maintainer-only.
 *
 * Once the configuration knob space is exhausted (or when a regression
 * cannot plausibly be fixed by a knob change), the LLM may propose a
 * targeted code patch. The patch goes through the SAME A/B harness as
 * config proposals — applied in an isolated git worktree, swept,
 * decide()'d against the baseline window, and (on accept) opened as a
 * draft PR.
 *
 * Hard rules:
 *   1. Patch path allowlist. The diff MUST only touch files matching
 *      the allowlist (default: `packages/search/src/**`). The materializer
 *      refuses to apply a patch that touches anything outside.
 *   2. Diff size cap. Default 200 lines added + removed. Larger
 *      patches require maintainer pre-approval (via env override).
 *   3. baseSha. The patch is applied at a specific commit so two
 *      concurrent proposals don't conflict. Default = HEAD at planner
 *      invocation time.
 *   4. No silent merge. Always draft PR. Maintainer reviews + clicks
 *      merge.
 *
 * The actual git worktree dance lives in materialize-variant.ts —
 * this module supplies the proposal type, allowlist guard, and unified
 * diff parsing.
 */

export const DEFAULT_ALLOWED_PATHS: readonly string[] = ["packages/search/src/"];
export const DEFAULT_MAX_DIFF_LINES = 200;

export interface PatchProposal {
	kind: "patch";
	baseSha: string;
	unifiedDiff: string;
	rationale: string;
	/**
	 * Optional summary the LLM provides describing what the patch
	 * conceptually does. Goes into the draft PR body.
	 */
	summary?: string;
}

export interface PatchValidationResult {
	ok: boolean;
	touchedPaths: string[];
	addedLines: number;
	removedLines: number;
	errors: string[];
}

/**
 * Parse a unified diff and return:
 *   - the file paths it touches
 *   - the line counts it adds + removes
 *   - any structural errors that would prevent `git apply` from
 *     succeeding
 *
 * Best-effort parser, NOT a full unidiff implementation. We accept
 * standard `diff --git`, `--- a/foo`, `+++ b/foo`, `@@ … @@` headers.
 */
export function parseUnifiedDiff(diff: string): {
	touchedPaths: string[];
	addedLines: number;
	removedLines: number;
} {
	const touched = new Set<string>();
	let added = 0;
	let removed = 0;
	const lines = diff.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.startsWith("+++ b/")) {
			touched.add(line.slice("+++ b/".length).trim());
			continue;
		}
		if (line.startsWith("--- a/")) {
			touched.add(line.slice("--- a/".length).trim());
			continue;
		}
		if (line.startsWith("diff --git ")) continue;
		if (line.startsWith("@@")) continue;
		if (line.startsWith("index ")) continue;
		if (line.startsWith("new file mode")) continue;
		if (line.startsWith("deleted file mode")) continue;
		// Hunk body
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return {
		touchedPaths: [...touched].filter((p) => p && p !== "/dev/null"),
		addedLines: added,
		removedLines: removed,
	};
}

export function validatePatch(
	proposal: PatchProposal,
	opts: { allowedPaths?: readonly string[]; maxDiffLines?: number } = {},
): PatchValidationResult {
	const allowed = opts.allowedPaths ?? DEFAULT_ALLOWED_PATHS;
	const maxLines = opts.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;
	const errors: string[] = [];

	if (!proposal.unifiedDiff || proposal.unifiedDiff.trim().length === 0) {
		errors.push("empty unifiedDiff");
		return { ok: false, touchedPaths: [], addedLines: 0, removedLines: 0, errors };
	}
	if (!proposal.baseSha || proposal.baseSha.length < 7) {
		errors.push("missing or short baseSha (need >= 7 chars)");
	}

	const { touchedPaths, addedLines, removedLines } = parseUnifiedDiff(proposal.unifiedDiff);

	if (touchedPaths.length === 0) {
		errors.push("diff touches no files (or paths not parseable)");
	}

	for (const p of touchedPaths) {
		const allowedHit = allowed.some((prefix) => p.startsWith(prefix));
		if (!allowedHit) {
			errors.push(`path "${p}" outside allowlist [${allowed.join(", ")}]`);
		}
	}

	const totalLines = addedLines + removedLines;
	if (totalLines > maxLines) {
		errors.push(
			`diff size ${totalLines} lines (added ${addedLines}, removed ${removedLines}) exceeds maxDiffLines=${maxLines}`,
		);
	}

	return {
		ok: errors.length === 0,
		touchedPaths,
		addedLines,
		removedLines,
		errors,
	};
}
