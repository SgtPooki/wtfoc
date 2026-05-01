/**
 * Push a materialized patch worktree branch + open a draft PR.
 * Maintainer-only.
 *
 * The materializer (`materialize-patch.ts`) already created a worktree,
 * applied the patch, committed, and ran the sweep. This module finishes
 * the loop:
 *   1. `git push -u origin <branch>` from the worktree
 *   2. `gh pr create --draft --title ... --body ...`
 *
 * Hard rules:
 *   - Always `--draft`. Never auto-merge.
 *   - Push fails-loud — if the branch can't be pushed, surface the
 *     error so the maintainer sees it.
 *   - PR body includes: LLM rationale, per-corpus verdict, anti-overfit
 *     check result, link to materializer notes.
 */

import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import type { MaterializePatchResult } from "./materialize-patch.js";
import type { PatchProposal } from "./patch-proposal.js";

export interface PromotePatchInputs {
	materializeResult: MaterializePatchResult;
	proposal: PatchProposal;
	matrixName: string;
	dryRun?: boolean;
	spawnFn?: (cmd: string, args: string[], opts?: { cwd?: string }) => Buffer | string;
}

export interface PromotePatchResult {
	prUrl: string | null;
	branch: string;
	dryRun: boolean;
	skippedReason?: string;
}

export function buildPatchPrTitle(input: { matrixName: string; proposalId: string }): string {
	return `feat(autoresearch): code patch from autonomous loop (${input.proposalId})`;
}

export function buildPatchPrBody(input: {
	proposal: PatchProposal;
	materializeResult: MaterializePatchResult;
	matrixName: string;
}): string {
	const m = input.materializeResult;
	const lines: string[] = [];
	lines.push("Autoresearch loop accepted this patch. Maintainer review required before merge.");
	lines.push("");
	lines.push(`Proposal: \`${m.proposalId}\``);
	lines.push(`Matrix: \`${input.matrixName}\``);
	lines.push(`Base SHA: \`${input.proposal.baseSha}\``);
	lines.push("");
	lines.push("## LLM rationale");
	lines.push("");
	lines.push(input.proposal.rationale.length > 0 ? input.proposal.rationale : "(no rationale provided)");
	lines.push("");
	if (input.proposal.summary) {
		lines.push("## Patch summary");
		lines.push("");
		lines.push(input.proposal.summary);
		lines.push("");
	}
	lines.push("## Per-corpus verdict");
	lines.push("");
	for (const d of m.decisions) {
		if (!d.verdict) {
			lines.push(`- **${d.corpus}**: no verdict (${d.reason ?? "unknown"})`);
			continue;
		}
		const reasonLine = d.verdict.reasons.length > 0 ? d.verdict.reasons.join("; ") : "—";
		lines.push(
			`- **${d.corpus}**: ${d.verdict.accept ? "✓ accept" : "✗ reject"} — ${reasonLine}`,
		);
		if (d.verdict.bootstrap) {
			lines.push(
				`  - bootstrap: meanΔ=${d.verdict.bootstrap.meanDelta.toFixed(3)}, probBgreaterA=${d.verdict.bootstrap.probBgreaterA.toFixed(3)}`,
			);
		}
	}
	lines.push("");
	if (m.notes.length > 0) {
		lines.push("## Notes from materializer");
		lines.push("");
		for (const n of m.notes) lines.push(`- ${n}`);
		lines.push("");
	}
	lines.push("## How to validate locally");
	lines.push("");
	lines.push("```bash");
	lines.push(`git checkout ${m.branch}`);
	lines.push(`pnpm autoresearch:sweep ${input.matrixName} \\\\`);
	lines.push(`  --variant-filter <production-variant> --stage repro`);
	lines.push("```");
	lines.push("");
	lines.push(
		"This PR must be reviewed by the maintainer. The loop NEVER auto-merges. Close it without merging if the patch is wrong; the tried-log will record the rejection so the LLM doesn't propose it again.",
	);
	return lines.join("\n");
}

export async function promotePatchViaPr(input: PromotePatchInputs): Promise<PromotePatchResult> {
	const m = input.materializeResult;
	if (!m.aggregateAccept) {
		return {
			prUrl: null,
			branch: m.branch,
			dryRun: input.dryRun ?? false,
			skippedReason: "materialize verdict was not accept; no PR to create",
		};
	}
	if (!m.worktreePath || !m.branch) {
		return {
			prUrl: null,
			branch: m.branch,
			dryRun: input.dryRun ?? false,
			skippedReason: "no worktree/branch available — materializer skipped earlier",
		};
	}

	const title = buildPatchPrTitle({ matrixName: input.matrixName, proposalId: m.proposalId });
	const body = buildPatchPrBody({
		proposal: input.proposal,
		materializeResult: m,
		matrixName: input.matrixName,
	});

	if (input.dryRun) {
		return { prUrl: null, branch: m.branch, dryRun: true };
	}

	const spawn =
		input.spawnFn ??
		((cmd: string, args: string[], opts: { cwd?: string } = {}) =>
			execFileSync(cmd, args, { ...opts, encoding: "utf-8" }));

	try {
		spawn("git", ["push", "-u", "origin", m.branch], { cwd: m.worktreePath });
	} catch (err) {
		return {
			prUrl: null,
			branch: m.branch,
			dryRun: false,
			skippedReason: `git push failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	let prUrl: string | null = null;
	try {
		const out = spawn(
			"gh",
			[
				"pr",
				"create",
				"--draft",
				"--title",
				title,
				"--body",
				body,
				"--label",
				"enhancement",
				"--head",
				m.branch,
			],
			{ cwd: m.worktreePath },
		);
		const text = typeof out === "string" ? out : out.toString("utf-8");
		prUrl = text.split("\n").find((l) => l.startsWith("https://")) ?? null;
	} catch (err) {
		return {
			prUrl: null,
			branch: m.branch,
			dryRun: false,
			skippedReason: `gh pr create failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	return { prUrl, branch: m.branch, dryRun: false };
}
