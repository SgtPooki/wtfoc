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
 * Patch format: SEARCH/REPLACE — each edit is `{ file, old, new }`
 * where `old` must appear EXACTLY ONCE in `file`. The harness applies
 * each edit by exact-string replacement, then commits the result.
 *
 * Why not unified diff: local LLMs (AEON-class Qwen3.6, qwen3-coder)
 * reliably hallucinate `@@` line numbers, drop trailing context lines,
 * and emit malformed hunk headers. Even with the same model, search/
 * replace was 100% applicable on the first try in side-by-side
 * validation against unified-diff (0/3 applicable). Search/replace
 * also matches what aider, Cursor, and other production code-editing
 * AI tools use.
 *
 * Hard rules:
 *   1. Patch path allowlist. Edits MUST only touch files matching the
 *      allowlist (default: `packages/search/src/**`).
 *   2. Patch size cap. Default 200 (added + removed) lines, counted by
 *      diffing each edit's `old` and `new`.
 *   3. baseSha. The patch is applied at a specific commit so two
 *      concurrent proposals don't conflict.
 *   4. No silent merge. Always draft PR.
 */

export const DEFAULT_ALLOWED_PATHS: readonly string[] = ["packages/search/src/"];
export const DEFAULT_MAX_DIFF_LINES = 200;

/**
 * One search/replace edit. The harness applies these by reading
 * `file`, asserting `old` appears exactly once, and replacing with
 * `new`.
 */
export interface Edit {
	file: string;
	old: string;
	new: string;
}

export interface PatchProposal {
	kind: "patch";
	baseSha: string;
	edits: readonly Edit[];
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
 * Count line deltas across all edits without doing a full diff. We
 * approximate by counting newlines: removed = newlines in `old` + 1,
 * added = newlines in `new` + 1. This overcounts when a one-line
 * `old` becomes a one-line `new` (1+1=2 instead of 0/0), but the
 * cap is a sanity guard, not a fairness metric.
 */
function countLines(s: string): number {
	if (s.length === 0) return 0;
	return (s.match(/\n/g) ?? []).length + 1;
}

export function validatePatch(
	proposal: PatchProposal,
	opts: { allowedPaths?: readonly string[]; maxDiffLines?: number } = {},
): PatchValidationResult {
	const allowed = opts.allowedPaths ?? DEFAULT_ALLOWED_PATHS;
	const maxLines = opts.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;
	const errors: string[] = [];

	if (!proposal.edits || proposal.edits.length === 0) {
		errors.push("empty edits");
		return { ok: false, touchedPaths: [], addedLines: 0, removedLines: 0, errors };
	}
	if (!proposal.baseSha || proposal.baseSha.length < 7) {
		errors.push("missing or short baseSha (need >= 7 chars)");
	}

	const touched = new Set<string>();
	let added = 0;
	let removed = 0;

	for (const [i, e] of proposal.edits.entries()) {
		if (!e.file || typeof e.file !== "string") {
			errors.push(`edit[${i}] missing file`);
			continue;
		}
		if (typeof e.old !== "string" || typeof e.new !== "string") {
			errors.push(`edit[${i}] missing old/new strings`);
			continue;
		}
		if (e.old.length === 0) {
			errors.push(`edit[${i}] old string is empty (use a non-empty anchor)`);
			continue;
		}
		if (e.old === e.new) {
			errors.push(`edit[${i}] old === new (no-op)`);
			continue;
		}
		touched.add(e.file);
		removed += countLines(e.old);
		added += countLines(e.new);
	}

	for (const p of touched) {
		const allowedHit = allowed.some((prefix) => p.startsWith(prefix));
		if (!allowedHit) {
			errors.push(`path "${p}" outside allowlist [${allowed.join(", ")}]`);
		}
	}

	const totalLines = added + removed;
	if (totalLines > maxLines) {
		errors.push(
			`patch size ${totalLines} lines (added ${added}, removed ${removed}) exceeds maxDiffLines=${maxLines}`,
		);
	}

	return {
		ok: errors.length === 0,
		touchedPaths: [...touched],
		addedLines: added,
		removedLines: removed,
		errors,
	};
}
