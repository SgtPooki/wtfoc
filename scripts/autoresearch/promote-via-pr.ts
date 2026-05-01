/**
 * PR-based promotion. Maintainer-only.
 *
 * Given an accepted variant proposal, mutate the production matrix
 * file (under repo) to the proposed value, commit on a fresh branch,
 * and `gh pr create --draft`. Maintainer reviews + merges manually —
 * never silent auto-merge.
 *
 * Hard guardrails:
 *   - Only repo-text files may be touched. The diff MUST be limited
 *     to the production matrix file at
 *     `scripts/autoresearch/matrices/<matrixName>.ts`. Anything else
 *     fails-closed before commit.
 *   - Collection bytes / archived reports / runs.jsonl NEVER enter
 *     the commit. They live under `~/.wtfoc/autoresearch/` (out of
 *     repo) and stay there.
 *   - The branch name encodes the proposal id so concurrent runs
 *     can't collide.
 *
 * The mutation strategy is intentionally simple: regex-replace the
 * single-axis assignment in the matrix file. Knobs not currently
 * present as TS literals (e.g. `topK` lives in dogfood CLI flags, not
 * in matrix.ts axes) cannot be promoted via this path yet — the loop
 * surfaces them as "needs maintainer code change" and skips PR
 * creation. That's intentional: code-shape changes to the matrix file
 * deserve manual review, not regex surgery.
 */

import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Proposal } from "./analyze-and-propose.js";

export interface PromoteInputs {
	proposalId: string;
	matrixName: string;
	proposal: Proposal;
	candidateVariantId: string;
	rationale: string;
	verdictSummary: string;
	dryRun?: boolean;
	/** Path to the wtfoc repo root. Defaults to walking up from this file. */
	repoRoot?: string;
	spawnFn?: (cmd: string, args: string[], opts?: { cwd?: string }) => Buffer | string;
}

export interface PromoteResult {
	prUrl: string | null;
	branch: string;
	matrixFilePath: string;
	diff: string;
	dryRun: boolean;
	skippedReason?: string;
}

const HERE = (() => {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return process.cwd();
	}
})();

function defaultRepoRoot(): string {
	// scripts/autoresearch/promote-via-pr.ts → repo root is two
	// levels up.
	return resolve(HERE, "..", "..");
}

function matrixFilePath(repoRoot: string, matrixName: string): string {
	return join(repoRoot, "scripts", "autoresearch", "matrices", `${matrixName}.ts`);
}

/**
 * Apply a `{ axis, value }` proposal to the matrix file source via
 * targeted regex replacement. Returns the new file body, or null when
 * no replacement was possible (axis not represented as a literal in
 * the file).
 */
export function applyProposalToMatrixSource(
	source: string,
	axis: string,
	value: boolean | number | string,
): { newSource: string; replaced: boolean } {
	const valueLiteral =
		typeof value === "boolean"
			? String(value)
			: typeof value === "number"
				? String(value)
				: JSON.stringify(value);

	switch (axis) {
		case "autoRoute":
		case "diversityEnforce": {
			// matches: "<axis>: [false]" / "[true]" / "[false, true]" etc.
			const re = new RegExp(`(${axis}\\s*:\\s*)\\[[^\\]]*\\]`);
			if (!re.test(source)) return { newSource: source, replaced: false };
			return {
				newSource: source.replace(re, `$1[${valueLiteral}]`),
				replaced: true,
			};
		}
		case "reranker": {
			// matches the reranker array. Reduce to a single element matching the proposal.
			const re = /(reranker\s*:\s*)\[[\s\S]*?\]/;
			if (!re.test(source)) return { newSource: source, replaced: false };
			let element: string;
			if (value === "off") element = '"off"';
			else if (value === "llm:haiku")
				element = '{ type: "llm", url: "http://127.0.0.1:4523/v1", model: "haiku" }';
			else if (value === "bge") element = '{ type: "bge", url: "http://127.0.0.1:8386" }';
			else return { newSource: source, replaced: false };
			return {
				newSource: source.replace(re, `$1[${element}]`),
				replaced: true,
			};
		}
		default:
			return { newSource: source, replaced: false };
	}
}

function git(args: string[], opts: { cwd: string }, spawnFn: PromoteInputs["spawnFn"]): string {
	const fn = spawnFn ?? execFileSync;
	const out = fn("git", args, { cwd: opts.cwd });
	return typeof out === "string" ? out : out.toString("utf-8");
}

export async function promoteViaPr(input: PromoteInputs): Promise<PromoteResult> {
	const repoRoot = input.repoRoot ?? defaultRepoRoot();
	const filePath = matrixFilePath(repoRoot, input.matrixName);
	if (!existsSync(filePath)) {
		return {
			prUrl: null,
			branch: "",
			matrixFilePath: filePath,
			diff: "",
			dryRun: input.dryRun ?? false,
			skippedReason: `matrix file not found at ${filePath}`,
		};
	}

	const original = readFileSync(filePath, "utf-8");
	const { newSource, replaced } = applyProposalToMatrixSource(
		original,
		input.proposal.axis,
		input.proposal.value,
	);
	if (!replaced) {
		return {
			prUrl: null,
			branch: "",
			matrixFilePath: filePath,
			diff: "",
			dryRun: input.dryRun ?? false,
			skippedReason: `axis "${input.proposal.axis}" not promotable via regex on this matrix file`,
		};
	}
	if (newSource === original) {
		return {
			prUrl: null,
			branch: "",
			matrixFilePath: filePath,
			diff: "",
			dryRun: input.dryRun ?? false,
			skippedReason: "no diff after applying proposal (already at target value?)",
		};
	}

	const branch = `autoresearch/${input.proposalId}`;
	const relPath = relative(repoRoot, filePath);

	if (input.dryRun) {
		// Compute a synthetic diff for visibility.
		const diffLines: string[] = [];
		const oa = original.split("\n");
		const na = newSource.split("\n");
		for (let i = 0; i < Math.max(oa.length, na.length); i++) {
			if (oa[i] !== na[i]) {
				diffLines.push(`-${oa[i] ?? ""}`);
				diffLines.push(`+${na[i] ?? ""}`);
			}
		}
		return {
			prUrl: null,
			branch,
			matrixFilePath: filePath,
			diff: diffLines.join("\n"),
			dryRun: true,
		};
	}

	// Hard guardrail: working tree must be clean OR have only this file
	// modified — never sweep up unrelated work.
	const status = git(["status", "--porcelain", "--", relPath, "."], { cwd: repoRoot }, input.spawnFn);
	const dirtyLines = status
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const allowed = (l: string) => l.endsWith(relPath);
	const stray = dirtyLines.filter((l) => !allowed(l));
	if (stray.length > 0) {
		return {
			prUrl: null,
			branch,
			matrixFilePath: filePath,
			diff: "",
			dryRun: false,
			skippedReason: `working tree has unrelated changes — refusing to commit: ${stray.join("; ")}`,
		};
	}

	git(["checkout", "-b", branch], { cwd: repoRoot }, input.spawnFn);
	writeFileSync(filePath, newSource);
	git(["add", "--", relPath], { cwd: repoRoot }, input.spawnFn);

	const subject = `feat(autoresearch): promote ${input.proposal.axis}=${JSON.stringify(input.proposal.value)} (proposal ${input.proposalId})`;
	const body = [
		"Autoresearch loop accepted this variant. Maintainer review required before merge.",
		"",
		`Proposal: ${input.proposal.axis} = ${JSON.stringify(input.proposal.value)}`,
		`Candidate variant: ${input.candidateVariantId}`,
		`Matrix: ${input.matrixName}`,
		"",
		"## Rationale (LLM-generated)",
		"",
		input.rationale,
		"",
		"## Verdict",
		"",
		input.verdictSummary,
	].join("\n");
	git(["commit", "-m", subject, "-m", body], { cwd: repoRoot }, input.spawnFn);

	const fn = input.spawnFn ?? execFileSync;
	fn("git", ["push", "-u", "origin", branch], { cwd: repoRoot });

	const prOut = fn(
		"gh",
		[
			"pr",
			"create",
			"--draft",
			"--title",
			subject,
			"--body",
			body,
			"--label",
			"enhancement",
			"--head",
			branch,
		],
		{ cwd: repoRoot },
	);
	const prText = typeof prOut === "string" ? prOut : prOut.toString("utf-8");
	const prUrl = prText.split("\n").find((l) => l.startsWith("https://")) ?? null;

	const finalDiff = `+${input.proposal.axis}=${JSON.stringify(input.proposal.value)}`;
	return {
		prUrl,
		branch,
		matrixFilePath: filePath,
		diff: finalDiff,
		dryRun: false,
	};
}
