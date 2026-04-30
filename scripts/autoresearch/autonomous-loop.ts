#!/usr/bin/env tsx
/**
 * Autonomous loop entry point. Maintainer-only.
 *
 * Reads a finding JSON (from `detect-regression`) and walks the full
 * loop: explain → analyze + propose → tried-log check → materialize →
 * tried-log append → (accept) promote-via-pr OR (reject) noop.
 *
 * Usage:
 *   pnpm autoresearch:autonomous \
 *     --findings /path/to/findings.json \
 *     --matrix retrieval-baseline \
 *     [--dry-run] \
 *     [--skip-llm]    # use a placeholder analysis when LLM unreachable
 *     [--skip-pr]     # skip PR creation even on accept
 *
 * Returns exit 0 on every non-fatal path so the cron wrapper can chain
 * it after `file-regression-issue` without breaking the chain.
 *
 * Hard rules:
 *   - LLM call is best-effort. On failure, the loop exits cleanly with
 *     a `status=llm-unavailable` note. The regression issue is still
 *     filed by the caller (file-regression-issue runs first).
 *   - No PR ever happens unless decide() accepts AND maintainer review
 *     is triggered via `gh pr create --draft`.
 *   - tried-log gets a row regardless of accept/reject (so the LLM has
 *     full memory next cycle).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMode, type GpuMode, resolveModeFromMatrix } from "../lib/mode-switch.js";
import { analyzeAndPropose } from "./analyze-and-propose.js";
import { analyzeAndProposePatch } from "./analyze-and-propose-patch.js";
import type { DetectionOutcome, Finding } from "./detect-regression.js";
import { explainFinding } from "./explain-finding.js";
import { materializePatchProposal } from "./materialize-patch.js";
import { materializeVariant } from "./materialize-variant.js";
import type { Matrix } from "./matrix.js";
import { planNextCandidate, reconcileWithPlanner } from "./planner.js";
import { promotePatchViaPr } from "./promote-patch-via-pr.js";
import { promoteViaPr } from "./promote-via-pr.js";
import { alreadyTried, appendTriedRow, readTriedLog } from "./tried-log.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { readRunLog, type RunLogRow } from "../lib/run-log.js";

interface CliArgs {
	findingsPath: string;
	matrixName: string;
	dryRun: boolean;
	skipLlm: boolean;
	skipPr: boolean;
}

interface LoopOutcome {
	status:
		| "no-finding"
		| "llm-unavailable"
		| "no-proposal"
		| "already-tried"
		| "materialize-failed"
		| "rejected"
		| "accepted-no-pr"
		| "accepted-pr-skipped"
		| "accepted-pr-created"
		| "patch-accepted-pr-created"
		| "patch-rejected"
		| "patch-llm-unavailable"
		| "patch-no-proposal";
	notes: string[];
	prUrl?: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	let findingsPath: string | null = null;
	let matrixName: string | null = null;
	let dryRun = false;
	let skipLlm = false;
	let skipPr = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i] ?? "";
		const eat = (): string => {
			const v = args[++i];
			if (!v) throw new Error(`${a} requires a value`);
			return v;
		};
		if (a === "--findings") findingsPath = eat();
		else if (a.startsWith("--findings=")) findingsPath = a.slice("--findings=".length);
		else if (a === "--matrix") matrixName = eat();
		else if (a.startsWith("--matrix=")) matrixName = a.slice("--matrix=".length);
		else if (a === "--dry-run") dryRun = true;
		else if (a === "--skip-llm") skipLlm = true;
		else if (a === "--skip-pr") skipPr = true;
		else throw new Error(`unknown flag: ${a}`);
	}
	if (!findingsPath || !matrixName) {
		throw new Error("usage: --findings <path> --matrix <name>");
	}
	return { findingsPath, matrixName, dryRun, skipLlm, skipPr };
}

async function loadMatrix(matrixName: string): Promise<Matrix> {
	const here = dirname(fileURLToPath(import.meta.url));
	const matrixPath = join(here, "matrices", `${matrixName}.ts`);
	const mod = (await import(matrixPath)) as { default: Matrix };
	return mod.default;
}

async function swapMode(
	target: GpuMode,
	reason: string,
	notes: string[],
): Promise<boolean> {
	try {
		const r = await ensureMode(target, { reason });
		if (r.skipped) {
			notes.push(`mode-switch skipped (${target}): ${r.skippedReason}`);
		} else {
			notes.push(`mode-switch ok: ${r.from ?? "?"}→${r.to ?? target} phase=${r.finalPhase ?? "?"}`);
		}
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		notes.push(`mode-switch FAILED (${target}): ${msg}`);
		return false;
	}
}

function pickMostRelevantFinding(outcome: DetectionOutcome): Finding | null {
	if (outcome.findings.length === 0) return null;
	// Prefer breach (hard floor violation) over regression for the
	// proposer. Breach is more actionable + has clearer target metric.
	const breach = outcome.findings.find((f) => f.type === "breach");
	return breach ?? outcome.findings[0] ?? null;
}

function findReportForFinding(finding: Finding): ExtendedDogfoodReport | null {
	const baseDir = process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	const candidatePath = join(
		baseDir,
		"reports",
		finding.latestSweepId,
		`${finding.variantId}__${finding.corpus}.json`,
	);
	try {
		return JSON.parse(readFileSync(candidatePath, "utf-8")) as ExtendedDogfoodReport;
	} catch {
		return null;
	}
}

/**
 * Find the most recent comparable nightly-cron baseline run for the
 * (variantId, corpus, fingerprint) tuple of the finding — i.e. the run
 * the LLM should diff the latest against. Returns null when no
 * comparable baseline exists (cold start).
 *
 * Comparability rule mirrors the detector: same variantId + corpus +
 * runConfigFingerprint, stage=nightly-cron, EXCLUDING the latest run
 * itself.
 */
function findBaselineForFinding(finding: Finding): ExtendedDogfoodReport | null {
	const rows = readRunLog();
	const candidates = rows
		.filter(
			(r: RunLogRow) =>
				r.variantId === finding.variantId &&
				r.runConfig.collectionId === finding.corpus &&
				r.runConfigFingerprint === finding.fingerprint &&
				r.stage === "nightly-cron" &&
				r.sweepId !== finding.latestSweepId &&
				r.reportPath,
		)
		.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
	for (const row of candidates) {
		if (!row.reportPath) continue;
		try {
			return JSON.parse(readFileSync(row.reportPath, "utf-8")) as ExtendedDogfoodReport;
		} catch {
			// keep scanning
		}
	}
	return null;
}

async function runPatchPath(input: {
	cli: CliArgs;
	matrix: Matrix;
	finding: Finding;
	explainMd: string;
	triedRows: readonly RunLogRow[] | readonly import("./tried-log.js").TriedLogRow[];
	notes: string[];
}): Promise<LoopOutcome> {
	const { cli, matrix, finding, explainMd, notes } = input;
	const triedRows = input.triedRows as readonly import("./tried-log.js").TriedLogRow[];
	const sweepMode = resolveModeFromMatrix(matrix);

	if (!(await swapMode("chat", "patch-llm-analyze", notes))) {
		return { status: "patch-llm-unavailable", notes };
	}

	const llm = await analyzeAndProposePatch({
		matrixName: cli.matrixName,
		explainMarkdown: explainMd,
		triedRows,
	});
	if (!llm.llmCallSucceeded) {
		notes.push(`patch LLM unavailable: ${llm.error ?? "unknown"}`);
		return { status: "patch-llm-unavailable", notes };
	}
	if (!llm.proposal) {
		notes.push(
			llm.error ? `patch LLM returned no usable proposal: ${llm.error}` : "patch LLM emitted NO_PATCH",
		);
		return { status: "patch-no-proposal", notes };
	}

	if (cli.dryRun) {
		notes.push(
			`DRY-RUN patch proposal: baseSha=${llm.proposal.baseSha}, +${llm.proposal.unifiedDiff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length}/-${llm.proposal.unifiedDiff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length} lines`,
		);
		return { status: "accepted-no-pr", notes };
	}

	if (sweepMode && !(await swapMode(sweepMode, "patch-materialize-sweep", notes))) {
		return { status: "patch-rejected", notes };
	}

	const materialize = await materializePatchProposal({
		productionMatrix: matrix,
		productionMatrixName: cli.matrixName,
		proposal: llm.proposal,
	});

	// Persist a tried-log row regardless of outcome.
	appendTriedRow({
		schemaVersion: 1,
		loggedAt: new Date().toISOString(),
		matrixName: cli.matrixName,
		variantId: `patch_${materialize.proposalId}`,
		proposal: {
			axis: "(code-patch)",
			value: llm.proposal.baseSha,
			rationale: llm.proposal.rationale.slice(0, 200),
		},
		verdict: materialize.aggregateAccept ? "accepted" : "rejected",
		reasons: materialize.decisions.flatMap((d) => d.verdict?.reasons ?? [d.reason ?? ""]).concat(materialize.notes),
	});

	if (!materialize.aggregateAccept) {
		const reason = materialize.skippedReason ?? materialize.decisions.map((d) => `${d.corpus}: ${d.verdict?.accept ? "ok" : "reject"}`).join(", ");
		notes.push(`patch rejected: ${reason}`);
		return { status: "patch-rejected", notes };
	}

	if (cli.skipPr) {
		notes.push("--skip-pr: patch accepted but PR creation skipped");
		return { status: "accepted-pr-skipped", notes };
	}

	const promote = await promotePatchViaPr({
		materializeResult: materialize,
		proposal: llm.proposal,
		matrixName: cli.matrixName,
	});
	if (promote.skippedReason) {
		notes.push(`patch promotion skipped: ${promote.skippedReason}`);
		return { status: "accepted-no-pr", notes };
	}
	notes.push(`patch PR created: ${promote.prUrl ?? promote.branch}`);
	return {
		status: "patch-accepted-pr-created",
		notes,
		...(promote.prUrl !== null ? { prUrl: promote.prUrl } : {}),
	};
}

async function runLoop(cli: CliArgs): Promise<LoopOutcome> {
	const notes: string[] = [];
	const outcome = JSON.parse(readFileSync(cli.findingsPath, "utf-8")) as DetectionOutcome;
	const finding = pickMostRelevantFinding(outcome);
	if (!finding) {
		return { status: "no-finding", notes: ["no actionable finding in detection outcome"] };
	}

	const matrix = await loadMatrix(cli.matrixName);
	const latestReport = findReportForFinding(finding);
	if (!latestReport) {
		notes.push(
			`could not load latest report for sweep=${finding.latestSweepId}; using minimal context`,
		);
	}
	const baselineReport = latestReport ? findBaselineForFinding(finding) : null;
	if (latestReport && !baselineReport) {
		notes.push(
			`no comparable baseline report for finding (variant=${finding.variantId} corpus=${finding.corpus} fp=${finding.fingerprint}); explainFinding will skip flipped queries`,
		);
	}
	const explainMd = latestReport
		? explainFinding({
				finding,
				latest: latestReport,
				...(baselineReport ? { baseline: baselineReport } : {}),
			})
		: `# Finding\n${finding.reason}\n`;

	const triedRows = readTriedLog();

	if (cli.skipLlm) {
		notes.push("--skip-llm: bypassing LLM proposer");
		return { status: "llm-unavailable", notes };
	}

	const sweepMode = resolveModeFromMatrix(matrix);

	if (!(await swapMode("chat", "loop-llm-analyze", notes))) {
		return { status: "llm-unavailable", notes };
	}

	const llmRes = await analyzeAndPropose({
		matrixName: cli.matrixName,
		explainMarkdown: explainMd,
		triedRows,
	});
	if (!llmRes.llmCallSucceeded) {
		notes.push(`LLM unavailable: ${llmRes.error ?? "unknown"}`);
		return { status: "llm-unavailable", notes };
	}

	// Reconcile LLM proposal with the planner. If the LLM emitted a
	// proposal the planner would skip (already-tried, unknown knob),
	// fall back to the planner's queue order. If the LLM emitted no
	// proposal at all (axis: null), still ask the planner — better to
	// run a deterministic next candidate than to skip the cycle.
	let proposal = llmRes.proposal;
	if (!proposal) {
		const plan = planNextCandidate({ matrixName: cli.matrixName, triedRows });
		if (!plan) {
			notes.push("LLM returned no proposal; planner queue exhausted");
			// Config space exhausted. Try the code-patch path when enabled.
			if (process.env.WTFOC_ALLOW_PATCHES === "1") {
				notes.push("WTFOC_ALLOW_PATCHES=1 → attempting code-patch proposal");
				return await runPatchPath({
					cli,
					matrix,
					finding,
					explainMd,
					triedRows,
					notes,
				});
			}
			notes.push("WTFOC_ALLOW_PATCHES is unset — config space exhausted, no patch attempted");
			return { status: "no-proposal", notes };
		}
		notes.push(
			`LLM emitted no proposal — falling back to planner: phase=${plan.phase} ${plan.axis}=${JSON.stringify(plan.value)}`,
		);
		proposal = { axis: plan.axis, value: plan.value, rationale: plan.rationale };
	} else {
		const nudge = reconcileWithPlanner(
			{ matrixName: cli.matrixName, triedRows },
			{ axis: proposal.axis, value: proposal.value },
		);
		if (nudge) {
			notes.push(
				`LLM proposed ${proposal.axis}=${JSON.stringify(proposal.value)} but planner nudges to phase=${nudge.phase} ${nudge.axis}=${JSON.stringify(nudge.value)}`,
			);
			proposal = { axis: nudge.axis, value: nudge.value, rationale: nudge.rationale };
		}
	}

	const prior = alreadyTried(triedRows, cli.matrixName, proposal.axis, proposal.value);
	if (prior) {
		notes.push(
			`proposal already tried on ${prior.loggedAt} (verdict=${prior.verdict}); skipping`,
		);
		return { status: "already-tried", notes };
	}

	if (cli.dryRun) {
		notes.push(
			`DRY-RUN proposal: ${proposal.axis}=${JSON.stringify(proposal.value)} — ${proposal.rationale}`,
		);
		return { status: "accepted-no-pr", notes };
	}

	if (sweepMode && !(await swapMode(sweepMode, "loop-materialize-sweep", notes))) {
		return { status: "materialize-failed", notes };
	}

	let materialize;
	try {
		materialize = await materializeVariant({
			productionMatrix: matrix,
			productionMatrixName: cli.matrixName,
			proposal: proposal,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		notes.push(`materialize failed: ${msg}`);
		appendTriedRow({
			schemaVersion: 1,
			loggedAt: new Date().toISOString(),
			matrixName: cli.matrixName,
			variantId: "(failed)",
			proposal: proposal,
			verdict: "errored",
			reasons: [msg],
		});
		return { status: "materialize-failed", notes };
	}

	// Always log the attempt (accept or reject) so memory persists.
	const candidateRow = materialize.candidateRows[0];
	appendTriedRow({
		schemaVersion: 1,
		loggedAt: new Date().toISOString(),
		matrixName: cli.matrixName,
		variantId: materialize.candidateVariantId,
		proposal: proposal,
		sweepId: candidateRow?.sweepId,
		runConfigFingerprint: candidateRow?.runConfigFingerprint,
		verdict: materialize.aggregateAccept ? "accepted" : "rejected",
		reasons: materialize.decisions.flatMap((d) => d.verdict?.reasons ?? [d.reason ?? ""]),
		metrics: candidateRow?.summary
			? {
					passRate: candidateRow.summary.passRate,
					demoCriticalPassRate: candidateRow.summary.demoCriticalPassRate,
					recallAtKMean: candidateRow.summary.recallAtKMean,
					latencyP95Ms: candidateRow.summary.latencyP95Ms,
				}
			: undefined,
	});

	if (!materialize.aggregateAccept) {
		notes.push(
			`materialized variant rejected by decide(): ${materialize.decisions
				.map((d) => `${d.corpus}=${d.verdict?.accept ? "accept" : "reject"}`)
				.join(", ")}`,
		);
		return { status: "rejected", notes };
	}

	if (cli.skipPr) {
		notes.push(
			`accepted: ${proposal.axis}=${JSON.stringify(proposal.value)} — PR creation skipped`,
		);
		return { status: "accepted-pr-skipped", notes };
	}

	const verdictSummary = materialize.decisions
		.map(
			(d) =>
				`- ${d.corpus}: ${d.verdict?.accept ? "✓ accept" : "✗ reject"} ${d.verdict ? `(meanΔ=${d.verdict.bootstrap.meanDelta.toFixed(3)}, probBgreaterA=${d.verdict.bootstrap.probBgreaterA.toFixed(3)})` : ""}`,
		)
		.join("\n");

	const promote = await promoteViaPr({
		proposalId: materialize.proposalId,
		matrixName: cli.matrixName,
		proposal: proposal,
		candidateVariantId: materialize.candidateVariantId,
		rationale: proposal.rationale,
		verdictSummary,
	});
	if (promote.skippedReason) {
		notes.push(`promotion skipped: ${promote.skippedReason}`);
		return { status: "accepted-no-pr", notes };
	}
	notes.push(`PR created: ${promote.prUrl ?? promote.branch}`);
	return { status: "accepted-pr-created", notes, prUrl: promote.prUrl };
}

async function main(): Promise<void> {
	const cli = parseArgs(process.argv);
	const out = await runLoop(cli);
	console.log(JSON.stringify(out, null, 2));
}

const isMain = (() => {
	try {
		const here = fileURLToPath(import.meta.url);
		return process.argv[1] === here;
	} catch {
		return false;
	}
})();

if (isMain) {
	main().catch((err) => {
		console.error(
			"[autonomous-loop] fatal:",
			err instanceof Error ? err.message : String(err),
		);
		process.exit(1);
	});
}

export { runLoop };
export type { LoopOutcome };
