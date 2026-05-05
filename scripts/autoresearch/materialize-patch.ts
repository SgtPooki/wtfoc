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
 *     unchanged) — only the source tree differs. The sweep targets
 *     `targetVariantId` when supplied (typically `finding.variantId`,
 *     #403); otherwise falls back to `productionVariantId`. The
 *     `runConfigFingerprint` differs from baselines because git sha
 *     changes.
 *   - On accept, the caller (autonomous-loop) opens a draft PR from
 *     the worktree's branch.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, type DecisionVerdict } from "./decision.js";
import type { Matrix } from "./matrix.js";
import { type Edit, type PatchProposal, validatePatch } from "./patch-proposal.js";
import { readRunLog, runLogPaths } from "../lib/run-log.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";

export interface MaterializePatchInputs {
	productionMatrix: Matrix;
	productionMatrixName: string;
	proposal: PatchProposal;
	/**
	 * Variant the patch should be evaluated against (typically
	 * `finding.variantId`). When set and different from
	 * `productionMatrix.productionVariantId`, the sweep filters to this
	 * variant and decide() compares against this variant's baseline
	 * window. Mirrors the #394 fix for materialize-variant. Without
	 * this, a patch designed to fix a non-production variant (e.g.
	 * noar_div_rrBge for #327) is measured only on production code paths
	 * and the patch's intended effect is invisible (#403).
	 *
	 * When unset, falls back to `productionVariantId` (legacy behavior).
	 */
	targetVariantId?: string;
	stage?: string;
	minBaseline?: number;
	repoRoot?: string;
	stateDir?: string;
	spawnFn?: (cmd: string, args: string[], opts?: { cwd?: string }) => Buffer | string;
	allowedPaths?: readonly string[];
	maxDiffLines?: number;
	/**
	 * Anti-overfit floor: maximum acceptable per-corpus DEGRADATION
	 * (passRate delta) before the patch is rejected on that corpus
	 * regardless of how much it improves other corpora. Default: 0.02
	 * (2 percentage points). Asymmetric vs the standard accept rule —
	 * a patch may improve filoz by 8pp but if it costs wtfoc-v3 more
	 * than 2pp we refuse to ship.
	 */
	maxPerCorpusDegradationPp?: number;
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

/**
 * Apply a single search/replace edit to `before`. Tries exact match
 * first; on miss, falls back to indent-tolerant match: strip leading
 * whitespace from each line of `old` AND of consecutive line windows
 * in `before`, then re-indent `new` by the original window's indent
 * before substitution. Local LLMs (AEON-class Qwen3.6) frequently
 * emit `old` without the file's leading whitespace, so this is the
 * difference between "patch path works" and "patch path always
 * rejects".
 *
 * Throws when the edit is ambiguous (multiple matches) or absent.
 */
export function applyEdit(
	before: string,
	oldStr: string,
	newStr: string,
	index: number,
	file: string,
): string {
	// Exact match — preferred.
	const exact = before.split(oldStr).length - 1;
	if (exact === 1) return before.replace(oldStr, newStr);
	if (exact > 1) {
		throw new Error(`edit[${index}] file=${file}: old string appears ${exact} times (not unique)`);
	}

	// Indent-tolerant match. Strip per-line leading whitespace from both
	// `old` and the file, then locate `old` as a contiguous block.
	const oldLines = oldStr.split("\n").map((l) => l.replace(/^\s+/, ""));
	const fileLines = before.split("\n");
	const stripped = fileLines.map((l) => l.replace(/^\s+/, ""));
	const matches: number[] = [];
	for (let i = 0; i + oldLines.length <= stripped.length; i++) {
		let ok = true;
		for (let j = 0; j < oldLines.length; j++) {
			if (stripped[i + j] !== oldLines[j]) {
				ok = false;
				break;
			}
		}
		if (ok) matches.push(i);
	}
	if (matches.length === 0) {
		throw new Error(`edit[${index}] file=${file}: old string not found (even ignoring indentation)`);
	}
	if (matches.length > 1) {
		throw new Error(
			`edit[${index}] file=${file}: old string appears ${matches.length} times after indent-strip (not unique)`,
		);
	}
	const start = matches[0]!;
	// Capture the original indentation of the first matched line so we
	// can re-apply it to every line of `new`.
	const firstMatched = fileLines[start] ?? "";
	const indent = firstMatched.match(/^\s*/)?.[0] ?? "";
	const newLines = newStr.split("\n").map((l, idx) => {
		// LLM-emitted `new` may also have stripped leading whitespace.
		// Re-indent every non-empty line to match the original window.
		// Lines that already start with whitespace are kept as-is to
		// preserve the LLM's intentional relative indentation.
		if (l.length === 0) return l;
		if (idx === 0) {
			return l.startsWith(indent) ? l : indent + l.replace(/^\s+/, "");
		}
		return l.startsWith(indent) ? l : indent + l.replace(/^\s+/, "");
	});
	const stitched = [
		...fileLines.slice(0, start),
		...newLines,
		...fileLines.slice(start + oldLines.length),
	];
	return stitched.join("\n");
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
	const editsPath = join(proposalDir, "edits.json");

	const notes: string[] = [];

	// Resolve target variant up-front. Bail before any fs/git work when
	// neither the production matrix nor the caller can name a variant —
	// sweeping with `--variant-filter ""` would run every variant and
	// obscure the patch's intended effect.
	const productionVariantId = input.productionMatrix.productionVariantId ?? "";
	const sweepVariantId = input.targetVariantId ?? productionVariantId;
	if (!sweepVariantId) {
		return {
			proposalId,
			worktreePath,
			branch,
			candidateReports: [],
			decisions: [],
			aggregateAccept: false,
			notes,
			skippedReason:
				"no variant id resolvable: matrix has no productionVariantId and no targetVariantId supplied",
		};
	}
	if (input.targetVariantId && input.targetVariantId !== productionVariantId) {
		notes.push(
			`materialize-patch: target=${input.targetVariantId} (from finding) ` +
				`differs from productionVariantId=${productionVariantId || "(unset)"} — ` +
				`sweep + decide() scoped to target variant (#403)`,
		);
	}

	writeFileSync(editsPath, JSON.stringify(input.proposal.edits, null, 2));

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
		// Install workspace deps in the worktree. Git worktrees share .git
		// but NOT node_modules, and pnpm scatters per-workspace node_modules
		// (e.g. packages/ingest/node_modules) so a top-level symlink isn't
		// sufficient. `--prefer-offline` keeps this fast when the pnpm
		// store is warm — typically <5s on a hot run.
		spawnFn("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: worktreePath });
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
		// Apply each edit. Try exact-match first; fall back to indent-
		// tolerant match because local LLMs often drop or rewrite
		// leading whitespace when emitting `old` strings.
		for (const [i, e] of input.proposal.edits.entries()) {
			const filePath = join(worktreePath, e.file);
			const before = readFileSync(filePath, "utf-8");
			const after = applyEdit(before, e.old, e.new, i, e.file);
			writeFileSync(filePath, after);
		}
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
			skippedReason: `edit apply / commit failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// Run the sweep against the worktree using the existing matrix.
	// Single variant — defaults to production, overridable via
	// `targetVariantId` so that patches authored to fix a non-production
	// variant are actually exercised on that variant (#403). Resolution
	// happened earlier; sweepVariantId is non-empty by this point.
	try {
		spawnFn(
			"pnpm",
			[
				"autoresearch:sweep",
				input.productionMatrixName,
				"--stage",
				stage,
				"--variant-filter",
				sweepVariantId,
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
	// a new runConfigFingerprint, but the variantId is unchanged from
	// the sweep filter.
	const allRows = readRunLog(runLogPaths());
	const candidateRows = allRows.filter(
		(r) =>
			r.stage === stage &&
			r.variantId === sweepVariantId &&
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
		// nightly-cron run for the SAME variant we just swept (target
		// or production, per #403) + corpus, regardless of fingerprint,
		// since the whole point is to compare "code-before vs
		// code-after." Document this caveat.
		const baselineRows = [...allRows]
			.reverse()
			.filter(
				(r) =>
					r.variantId === sweepVariantId &&
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

		// Anti-overfit guard. Reject the patch on this corpus if its
		// passRate drops by more than `maxPerCorpusDegradationPp` points
		// vs ANY baseline in the window — even if it improves on
		// average. The asymmetry is deliberate: the loop must not ship
		// patches that help one corpus while quietly hurting another
		// (over-fitting risk). Stricter than the standard accept rule.
		const maxDegradation = input.maxPerCorpusDegradationPp ?? 0.02;
		const candidateScores = (() => {
			const qq = candidateReport.stages.find((s) => s.stage === "quality-queries");
			const m = qq?.metrics as { passRate?: number } | undefined;
			return m?.passRate ?? null;
		})();
		let worstDegradationVsAnyBaseline = 0;
		if (candidateScores !== null) {
			for (const r of baselineRows) {
				if (!r.reportPath) continue;
				try {
					const b = JSON.parse(fs.readFileSync(r.reportPath, "utf-8")) as ExtendedDogfoodReport;
					const qq = b.stages.find((s) => s.stage === "quality-queries");
					const m = qq?.metrics as { passRate?: number } | undefined;
					const baseRate = m?.passRate ?? null;
					if (baseRate !== null) {
						const drop = baseRate - candidateScores;
						if (drop > worstDegradationVsAnyBaseline) worstDegradationVsAnyBaseline = drop;
					}
				} catch {
					// skip
				}
			}
		}
		const overfitTripped = worstDegradationVsAnyBaseline > maxDegradation;

		const finalCorpusAccept = corpusAccept && !overfitTripped;
		const aggregate: DecisionVerdict = {
			...verdicts[verdicts.length - 1]!,
			accept: finalCorpusAccept,
			reasons: overfitTripped
				? [
						`anti-overfit: worst per-baseline degradation ${(worstDegradationVsAnyBaseline * 100).toFixed(1)}pp > floor ${(maxDegradation * 100).toFixed(1)}pp`,
					]
				: corpusAccept
					? [`patch window: ${accepts}/${verdicts.length} baselines clear decide()`]
					: [`patch window: only ${accepts}/${verdicts.length} clear decide() (need ${majority})`],
		};
		decisions.push({ corpus, verdict: aggregate });
		if (!finalCorpusAccept) allAccept = false;
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
