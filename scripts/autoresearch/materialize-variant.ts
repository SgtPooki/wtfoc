/**
 * Variant materialization. Maintainer-only.
 *
 * Given a `{ axis, value }` proposal, builds a derived single-variant
 * matrix with the production axes everywhere except for the proposed
 * axis (which is set to the proposed value), writes it to a temp file,
 * runs the sweep against it, and returns the resulting reports + a
 * decide() verdict against the most-recent comparable production run.
 *
 * The derived matrix lives at
 *   ~/.wtfoc/autoresearch/proposals/<proposalId>/matrix.ts
 * Outside the repo, so the loop can never accidentally commit it to
 * git. The actual run reports live alongside under reports/.
 *
 * Hard rules:
 *   - One variant per proposal. The matrix is collapsed so axis arrays
 *     contain exactly the value(s) needed to reach that one variant.
 *   - Stage = "autoresearch-proposal" so the sweep harness's existing
 *     filters separate proposal runs from nightly runs.
 *   - No code changes. The proposer can only adjust knobs in the
 *     inventory. Code-change proposals are deliberately out of scope
 *     for this MVP — they need their own safety story.
 */

import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, type DecisionVerdict } from "./decision.js";
import { detectRegression } from "./detect-regression.js";
import { type Knob, getKnob } from "./knobs.js";
import type { Matrix, RerankerSpec, VariantAxes } from "./matrix.js";
import type { Proposal } from "./analyze-and-propose.js";
import { readRunLog, type RunLogPaths, type RunLogRow, runLogPaths } from "../lib/run-log.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";

export interface MaterializeInputs {
	productionMatrix: Matrix;
	productionMatrixName: string;
	proposal: Proposal;
	/**
	 * Variant the patch should target (typically `finding.variantId` from
	 * the regression detector). When set and different from
	 * `productionMatrix.productionVariantId`, base axes are derived from
	 * this variant id and the baseline window for decide() runs against
	 * the same variant. Mapping is surfaced in `notes` for audit (#394).
	 *
	 * When unset, falls back to `productionVariantId` (legacy behavior).
	 */
	targetVariantId?: string;
	/** Stage tag for the run. Default "autoresearch-proposal". */
	stage?: string;
	/**
	 * Minimum number of comparable baseline runs required to accept the
	 * proposal. Mirrors detector's `minBaseline`. Default 3.
	 */
	minBaseline?: number;
	/**
	 * Override the spawn function for tests — call with the same args
	 * as `execFileSync`.
	 */
	spawnFn?: (cmd: string, args: string[]) => Buffer | string;
	/** Override path resolution (tests). */
	stateDir?: string;
}

export interface MaterializeResult {
	proposalId: string;
	matrixPath: string;
	candidateVariantId: string;
	candidateRows: RunLogRow[];
	candidateReports: ExtendedDogfoodReport[];
	/** decide() per corpus, candidate vs most-recent comparable production run. */
	decisions: Array<{ corpus: string; verdict: DecisionVerdict | null; reason?: string }>;
	/** Aggregate accept = all per-corpus decisions accept (or insufficient-history → not-accept). */
	aggregateAccept: boolean;
	notes: string[];
}

function applyAxisToMatrix(
	matrix: Matrix,
	knob: Knob,
	value: boolean | number | string,
	baseVariantId?: string,
): Matrix {
	// Build single-value axes from the base variant id (defaults to the
	// matrix's productionVariantId; #394 lets callers override with a
	// finding's targetVariantId so the derived matrix mutates against the
	// regressed variant rather than unconditionally against production).
	const baseId = baseVariantId ?? matrix.productionVariantId;
	const axes: VariantAxes = {
		autoRoute: [baseId?.includes("ar_") && !baseId.startsWith("noar") ? true : false],
		diversityEnforce: [baseId?.includes("_div_") ?? true],
		reranker: [
			baseId?.includes("rrLlm")
				? ({ type: "llm", url: "http://127.0.0.1:4523/v1", model: "haiku" } as RerankerSpec)
				: baseId?.includes("rrBge")
					? ({ type: "bge", url: "http://127.0.0.1:8386" } as RerankerSpec)
					: ("off" as const),
		],
	};

	switch (knob.name) {
		case "autoRoute":
			axes.autoRoute = [value as boolean];
			break;
		case "diversityEnforce":
			axes.diversityEnforce = [value as boolean];
			break;
		case "reranker": {
			const v = value as string;
			if (v === "off") axes.reranker = ["off" as const];
			else if (v === "llm:haiku")
				axes.reranker = [{ type: "llm", url: "http://127.0.0.1:4523/v1", model: "haiku" }];
			else if (v === "bge") axes.reranker = [{ type: "bge", url: "http://127.0.0.1:8386" }];
			else throw new Error(`unsupported reranker enum value: ${v}`);
			break;
		}
		case "topK":
			axes.topK = [value as number];
			break;
		case "traceMaxPerSource":
			axes.traceMaxPerSource = [value as number];
			break;
		case "traceMaxTotal":
			axes.traceMaxTotal = [value as number];
			break;
		case "traceMinScore":
			axes.traceMinScore = [value as number];
			break;
		default:
			throw new Error(
				`knob "${knob.name}" not yet supported by the materializer — extend the switch in materialize-variant.ts before proposing it`,
			);
	}

	return {
		...matrix,
		axes,
	};
}

function renderMatrixFile(derived: Matrix, sourceProposalId: string): string {
	// Generate a pure-JS module that default-exports the matrix.
	// sweep.ts dynamic-imports it and casts to Matrix at the call site,
	// so the generated file doesn't need to import the type.
	return `// AUTO-GENERATED by autoresearch materialize-variant.
// Proposal: ${sourceProposalId}
// DO NOT EDIT — recreated per proposal run.
export default ${JSON.stringify(derived, null, 2)};
`;
}

function deriveProposalId(proposal: Proposal): string {
	const safeAxis = proposal.axis.replace(/[^a-zA-Z0-9_-]/g, "");
	const safeValue = JSON.stringify(proposal.value).replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${safeAxis}_${safeValue}_${Date.now()}`;
}

export async function materializeVariant(
	input: MaterializeInputs,
): Promise<MaterializeResult> {
	const stage = input.stage ?? "autoresearch-proposal";
	const spawnFn =
		input.spawnFn ??
		((cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] }));

	const knob = getKnob(input.proposal.axis);
	if (!knob) {
		throw new Error(`materialize-variant: unknown axis ${input.proposal.axis}`);
	}

	const proposalId = deriveProposalId(input.proposal);
	const baseDir =
		input.stateDir ?? process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	const proposalDir = join(baseDir, "proposals", proposalId);
	mkdirSync(proposalDir, { recursive: true });
	const matrixPath = join(proposalDir, "matrix.ts");

	const productionVariantId = input.productionMatrix.productionVariantId ?? "";
	const baseVariantId = input.targetVariantId ?? productionVariantId;
	const derived = applyAxisToMatrix(input.productionMatrix, knob, input.proposal.value, baseVariantId);
	writeFileSync(matrixPath, renderMatrixFile(derived, proposalId));

	// Run the sweep.
	const sweepArgs = [
		"autoresearch:sweep",
		matrixPath,
		"--stage",
		stage,
	];
	spawnFn("pnpm", sweepArgs);

	// Read newly-appended run-log rows. The sweep stamps `stage` and
	// `matrixName=<derived.name>` on rows; the matrix name is preserved
	// from production matrix, so we filter on stage + matrixName.
	const runLogP: RunLogPaths = runLogPaths();
	const allRows = readRunLog(runLogP);
	const candidateRows = allRows.filter(
		(r) => r.stage === stage && r.matrixName === derived.name && r.runConfig.collectionId !== "" /* placeholder predicate */,
	);
	// Narrow to rows from THIS sweep — the most-recent rows, by sweepId
	// frequency. There's exactly one sweepId per invocation.
	const sweepIds = candidateRows.map((r) => r.sweepId);
	const lastSweepId = sweepIds[sweepIds.length - 1];
	const thisSweep = candidateRows.filter((r) => r.sweepId === lastSweepId);

	const reports: ExtendedDogfoodReport[] = [];
	for (const row of thisSweep) {
		if (!row.reportPath) continue;
		try {
			reports.push(JSON.parse(readFileSync(row.reportPath, "utf-8")) as ExtendedDogfoodReport);
		} catch {
			// skip
		}
	}

	// For each corpus, decide() against the LAST N comparable production
	// runs (same variant + corpus + fingerprint, stage=nightly-cron).
	// Acceptance requires the candidate to clear decide() vs a MAJORITY
	// of those baseline runs — mirroring the regression detector's
	// majority rule. Single-baseline accept is too noisy given the
	// documented paraphrase brittleness (~48%).
	const minBaseline = input.minBaseline ?? 3;
	const decisions: MaterializeResult["decisions"] = [];
	const corpora = Array.from(new Set(reports.map((r) => r.runConfig.collectionId)));
	const notes: string[] = [];
	if (input.targetVariantId && input.targetVariantId !== productionVariantId) {
		notes.push(
			`materialize: target=${input.targetVariantId} (from finding) ` +
				`differs from productionVariantId=${productionVariantId || "(unset)"} — ` +
				`base axes derived from target; baseline window scoped to target variant (#394)`,
		);
	}
	let allAccept = corpora.length > 0;
	for (const corpus of corpora) {
		const candidateReport = reports.find((r) => r.runConfig.collectionId === corpus);
		if (!candidateReport) {
			decisions.push({ corpus, verdict: null, reason: "no candidate report for corpus" });
			allAccept = false;
			continue;
		}
		// Build baseline window: latest N nightly-cron rows for the
		// production variant on this corpus, sharing the SAME
		// runConfigFingerprint. Comparability rule mirrors detector.
		const candidateFingerprint = candidateReport.runConfigFingerprint;
		const baselineVariantId = input.targetVariantId ?? productionVariantId;
		const baselineRows = [...allRows]
			.reverse()
			.filter(
				(r) =>
					r.variantId === baselineVariantId &&
					r.runConfig.collectionId === corpus &&
					r.stage === "nightly-cron" &&
					r.runConfigFingerprint === candidateFingerprint &&
					r.reportPath,
			);
		const window = baselineRows.slice(0, minBaseline);
		if (window.length < minBaseline) {
			decisions.push({
				corpus,
				verdict: null,
				reason: `only ${window.length} comparable production baseline(s); need >= ${minBaseline}`,
			});
			notes.push(
				`corpus=${corpus}: only ${window.length} comparable baseline(s) — accept blocked`,
			);
			allAccept = false;
			continue;
		}
		// Run decide() against each baseline; require majority acceptance.
		const perBaselineVerdicts: Array<{ ok: boolean; reasons: string[]; meanDelta: number; probBgreaterA: number }> = [];
		let lastFullVerdict: ReturnType<typeof decide> | null = null;
		for (const baseRow of window) {
			if (!baseRow.reportPath) continue;
			try {
				const baselineReport = JSON.parse(
					readFileSync(baseRow.reportPath, "utf-8"),
				) as ExtendedDogfoodReport;
				const verdict = decide({ baseline: baselineReport, candidate: candidateReport });
				lastFullVerdict = verdict;
				perBaselineVerdicts.push({
					ok: verdict.accept,
					reasons: verdict.reasons,
					meanDelta: verdict.bootstrap.meanDelta,
					probBgreaterA: verdict.bootstrap.probBgreaterA,
				});
			} catch (err) {
				notes.push(
					`corpus=${corpus}: failed to load baseline ${baseRow.sweepId}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		if (perBaselineVerdicts.length === 0) {
			decisions.push({ corpus, verdict: null, reason: "all baseline reports failed to load" });
			allAccept = false;
			continue;
		}
		const accepts = perBaselineVerdicts.filter((v) => v.ok).length;
		const majority = Math.floor(perBaselineVerdicts.length / 2) + 1;
		const corpusAccept = accepts >= majority;
		// Surface a synthetic verdict that summarises the window-level
		// decision. The .reasons string captures the per-baseline tally
		// so the LLM + tried-log have full context.
		const aggregateVerdict = lastFullVerdict
			? {
					...lastFullVerdict,
					accept: corpusAccept,
					reasons: corpusAccept
						? [
								`window accept: ${accepts}/${perBaselineVerdicts.length} baselines clear decide() (majority ${majority})`,
							]
						: [
								`window reject: only ${accepts}/${perBaselineVerdicts.length} baselines clear decide() (need ${majority})`,
								...perBaselineVerdicts.flatMap((v, i) =>
									v.ok ? [] : [`baseline[${i}]: ${v.reasons.join("; ")}`],
								),
							],
				}
			: null;
		decisions.push({ corpus, verdict: aggregateVerdict });
		if (!corpusAccept) allAccept = false;
	}

	const candidateVariantId = thisSweep[0]?.variantId ?? "(unknown)";

	return {
		proposalId,
		matrixPath,
		candidateVariantId,
		candidateRows: thisSweep,
		candidateReports: reports,
		decisions,
		aggregateAccept: allAccept,
		notes,
	};
}

// Re-export for use by the wiring layer.
export { detectRegression };
