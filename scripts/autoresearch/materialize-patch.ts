/**
 * Materialize a code-patch proposal: create a git worktree at the
 * proposal's `baseSha`, apply the unified diff, run the sweep against
 * that tree, and return the decide() verdict per corpus.
 *
 * Hard rules (mirrors materialize-variant.ts but for code changes):
 *   - Worktree lives outside the repo's working dir
 *     (~/.wtfoc/autoresearch/proposals/<id>/worktree).
 *   - `git apply` is run with `--check` first; refuse to materialize
 *     if the diff doesn't apply cleanly.
 *   - The sweep runs against the production matrix (knob axes
 *     unchanged) — only the source tree differs. Variant id stays
 *     the production variant id; only `runConfigFingerprint` differs
 *     because git sha changes.
 *   - On accept, the caller (autonomous-loop) opens a draft PR from
 *     the worktree's branch.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, type DecisionVerdict } from "./decision.js";
import type { Matrix } from "./matrix.js";
import { type PatchProposal, validatePatch } from "./patch-proposal.js";
import { readRunLog, runLogPaths } from "../lib/run-log.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";

export interface MaterializePatchInputs {
	productionMatrix: Matrix;
	productionMatrixName: string;
	proposal: PatchProposal;
	stage?: string;
	minBaseline?: number;
	repoRoot?: string;
	stateDir?: string;
	spawnFn?: (cmd: string, args: string[], opts?: { cwd?: string }) => Buffer | string;
	allowedPaths?: readonly string[];
	maxDiffLines?: number;
}

export interface MaterializePatchResult {
	proposalId: string;
	worktreePath: string;
	branch: string;
	candidateReports: ExtendedDogfoodReport[];
	decisions: Array<{ corpus: string; verdict: DecisionVerdict | null; reason?: string }>;
	aggregateAccept: boolean;
	notes: string[];
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
	return resolve(HERE, "..", "..");
}

function deriveProposalId(proposal: PatchProposal): string {
	const sha = proposal.baseSha.slice(0, 7);
	return `patch_${sha}_${Date.now()}`;
}

export async function materializePatchProposal(
	input: MaterializePatchInputs,
): Promise<MaterializePatchResult> {
	const repoRoot = input.repoRoot ?? defaultRepoRoot();
	const stage = input.stage ?? "autoresearch-patch-proposal";
	const spawnFn =
		input.spawnFn ??
		((cmd: string, args: string[], opts: { cwd?: string } = {}) =>
			execFileSync(cmd, args, { ...opts, stdio: ["ignore", "pipe", "inherit"] }));

	const validation = validatePatch(input.proposal, {
		...(input.allowedPaths ? { allowedPaths: input.allowedPaths } : {}),
		...(input.maxDiffLines !== undefined ? { maxDiffLines: input.maxDiffLines } : {}),
	});
	const proposalId = deriveProposalId(input.proposal);
	const baseDir =
		input.stateDir ?? process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	const proposalDir = join(baseDir, "proposals", proposalId);
	mkdirSync(proposalDir, { recursive: true });

	if (!validation.ok) {
		return {
			proposalId,
			worktreePath: "",
			branch: "",
			candidateReports: [],
			decisions: [],
			aggregateAccept: false,
			notes: validation.errors,
			skippedReason: `patch validation failed: ${validation.errors.join("; ")}`,
		};
	}

	const branch = `autoresearch/${proposalId}`;
	const worktreePath = join(proposalDir, "worktree");
	const diffPath = join(proposalDir, "patch.diff");
	writeFileSync(diffPath, input.proposal.unifiedDiff);

	const notes: string[] = [];
	notes.push(
		`patch touches ${validation.touchedPaths.length} file(s): ${validation.touchedPaths.slice(0, 3).join(", ")}${validation.touchedPaths.length > 3 ? "…" : ""}`,
	);
	notes.push(`+${validation.addedLines}/-${validation.removedLines} lines`);

	try {
		spawnFn(
			"git",
			["worktree", "add", "--detach", worktreePath, input.proposal.baseSha],
			{ cwd: repoRoot },
		);
	} catch (err) {
		return {
			proposalId,
			worktreePath,
			branch,
			candidateReports: [],
			decisions: [],
			aggregateAccept: false,
			notes,
			skippedReason: `git worktree add failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	try {
		// Dry-run check first.
		spawnFn("git", ["apply", "--check", diffPath], { cwd: worktreePath });
		spawnFn("git", ["apply", diffPath], { cwd: worktreePath });
		spawnFn("git", ["checkout", "-b", branch], { cwd: worktreePath });
		spawnFn("git", ["add", "-A"], { cwd: worktreePath });
		spawnFn(
			"git",
			[
				"-c",
				"user.email=autoresearch@local",
				"-c",
				"user.name=autoresearch",
				"commit",
				"-m",
				`autoresearch: candidate patch (proposal ${proposalId})`,
			],
			{ cwd: worktreePath },
		);
	} catch (err) {
		// Clean up failed worktree before returning.
		try {
			spawnFn("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoRoot });
		} catch {
			rmSync(worktreePath, { recursive: true, force: true });
		}
		return {
			proposalId,
			worktreePath,
			branch,
			candidateReports: [],
			decisions: [],
			aggregateAccept: false,
			notes,
			skippedReason: `git apply / commit failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// Run the sweep against the worktree using the existing matrix.
	// Production variant only — the patch is the variable, not the
	// knob configuration.
	try {
		spawnFn(
			"pnpm",
			[
				"autoresearch:sweep",
				input.productionMatrixName,
				"--stage",
				stage,
				"--variant-filter",
				input.productionMatrix.productionVariantId ?? "",
			],
			{ cwd: worktreePath },
		);
	} catch (err) {
		return {
			proposalId,
			worktreePath,
			branch,
			candidateReports: [],
			decisions: [],
			aggregateAccept: false,
			notes,
			skippedReason: `sweep against worktree failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// Read newly-appended runs.jsonl rows. Same approach as
	// materialize-variant.ts; the patched run has a NEW git sha, hence
	// a new runConfigFingerprint, but the variantId is unchanged.
	const allRows = readRunLog(runLogPaths());
	const productionVariantId = input.productionMatrix.productionVariantId ?? "";
	const candidateRows = allRows.filter(
		(r) =>
			r.stage === stage &&
			r.variantId === productionVariantId &&
			r.matrixName === input.productionMatrix.name &&
			r.reportPath,
	);
	// Take rows from THIS sweep — most recent contiguous group.
	const lastSweepId = candidateRows[candidateRows.length - 1]?.sweepId;
	const thisSweep = candidateRows.filter((r) => r.sweepId === lastSweepId);

	const reports: ExtendedDogfoodReport[] = [];
	for (const row of thisSweep) {
		if (!row.reportPath) continue;
		try {
			const text = (await import("node:fs")).readFileSync(row.reportPath, "utf-8");
			reports.push(JSON.parse(text) as ExtendedDogfoodReport);
		} catch {
			// skip
		}
	}

	// decide() per corpus against the same baseline window as
	// materialize-variant. Single-row baseline would be too noisy.
	const minBaseline = input.minBaseline ?? 3;
	const corpora = Array.from(new Set(reports.map((r) => r.runConfig.collectionId)));
	const decisions: MaterializePatchResult["decisions"] = [];
	let allAccept = corpora.length > 0;
	const fs = await import("node:fs");
	for (const corpus of corpora) {
		const candidateReport = reports.find((r) => r.runConfig.collectionId === corpus);
		if (!candidateReport) {
			decisions.push({ corpus, verdict: null, reason: "no candidate report for corpus" });
			allAccept = false;
			continue;
		}
		// Patches change runConfigFingerprint via gitSha. Comparability
		// rule for patches is RELAXED: we compare against any recent
		// nightly-cron run for the production variant + corpus,
		// regardless of fingerprint, since the whole point is to compare
		// "code-before vs code-after." Document this caveat.
		const baselineRows = [...allRows]
			.reverse()
			.filter(
				(r) =>
					r.variantId === productionVariantId &&
					r.runConfig.collectionId === corpus &&
					r.stage === "nightly-cron" &&
					r.reportPath,
			)
			.slice(0, minBaseline);
		if (baselineRows.length < minBaseline) {
			decisions.push({
				corpus,
				verdict: null,
				reason: `only ${baselineRows.length} baseline runs; need >= ${minBaseline}`,
			});
			allAccept = false;
			continue;
		}
		const verdicts = baselineRows
			.map((r) => {
				if (!r.reportPath) return null;
				try {
					const baseReport = JSON.parse(fs.readFileSync(r.reportPath, "utf-8")) as ExtendedDogfoodReport;
					return decide({ baseline: baseReport, candidate: candidateReport });
				} catch {
					return null;
				}
			})
			.filter((v): v is DecisionVerdict => v !== null);
		if (verdicts.length === 0) {
			decisions.push({ corpus, verdict: null, reason: "all baselines failed to load" });
			allAccept = false;
			continue;
		}
		const accepts = verdicts.filter((v) => v.accept).length;
		const majority = Math.floor(verdicts.length / 2) + 1;
		const corpusAccept = accepts >= majority;
		const aggregate: DecisionVerdict = {
			...verdicts[verdicts.length - 1]!,
			accept: corpusAccept,
			reasons: corpusAccept
				? [`patch window: ${accepts}/${verdicts.length} baselines clear decide()`]
				: [`patch window: only ${accepts}/${verdicts.length} clear decide() (need ${majority})`],
		};
		decisions.push({ corpus, verdict: aggregate });
		if (!corpusAccept) allAccept = false;
	}

	return {
		proposalId,
		worktreePath,
		branch,
		candidateReports: reports,
		decisions,
		aggregateAccept: allAccept,
		notes,
	};
}
