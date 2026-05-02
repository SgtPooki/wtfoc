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
import { selectPatchCapsule } from "./patch-capsule.js";
import type {
	DiagnosisAggregate,
	FailureLayer,
	FixtureHealthSignal,
} from "@wtfoc/search";
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
	forcePatch: boolean;
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
		| "patch-no-proposal"
		| "coverage-gap-detected"
		| "coverage-gap-skipped";
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
	let forcePatch = false;
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
		else if (a === "--force-patch") forcePatch = true;
		else throw new Error(`unknown flag: ${a}`);
	}
	if (!findingsPath || !matrixName) {
		throw new Error("usage: --findings <path> --matrix <name>");
	}
	return { findingsPath, matrixName, dryRun, skipLlm, skipPr, forcePatch };
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

/**
 * Read `diagnosisAggregate.dominantLayer` from a dogfood report's
 * quality-queries stage metrics. Returns `null` when the field is absent
 * (older reports) or when there are no failures to diagnose. Exported for
 * the wiring integration test.
 */
export function extractDominantLayer(report: ExtendedDogfoodReport | null): FailureLayer | null {
	if (!report) return null;
	const stage = report.stages.find((s) => s.stage === "quality-queries");
	const metrics = stage?.metrics as { diagnosisAggregate?: DiagnosisAggregate } | undefined;
	return metrics?.diagnosisAggregate?.dominantLayer ?? null;
}

/**
 * #360 — read `fixtureHealthSignal` from a dogfood report's quality-queries
 * stage metrics. Orthogonal to `extractDominantLayer`: a coverage gap is
 * a corpus-level observation about MISSING gold queries, not a per-query
 * failure. Returns `null` for older reports without the field, or for
 * runs where no `documentCatalog` was passed to the evaluator.
 */
export function extractFixtureHealthSignal(
	report: ExtendedDogfoodReport | null,
): FixtureHealthSignal | null {
	if (!report) return null;
	const stage = report.stages.find((s) => s.stage === "quality-queries");
	const metrics = stage?.metrics as { fixtureHealthSignal?: FixtureHealthSignal } | undefined;
	return metrics?.fixtureHealthSignal ?? null;
}

export interface LoopActionDecision {
	/** Try the LLM patch path. True when there is a per-query dominant layer. */
	tryPatch: boolean;
	/** Try the recipe-pipeline fixture-expand path. True when the corpus-level
	 *  fixture-health signal flags a coverage gap. */
	tryFixtureExpand: boolean;
	/** Human-readable summary of the routing inputs, for the loop's notes. */
	rationale: string;
}

/**
 * Decide which action paths the loop should attempt this cycle. Per the
 * settled #360 layering, `dominantLayer` and `fixtureHealthSignal` are
 * orthogonal — a single cycle may legitimately want BOTH a code patch
 * (for ranking regressions on existing queries) AND a fixture expansion
 * (for un-measured strata in the catalog). Independent caps elsewhere
 * keep either path from starving the other.
 */
export function decideLoopAction(input: {
	dominantLayer: FailureLayer | null;
	fixtureHealth: FixtureHealthSignal | null;
}): LoopActionDecision {
	const tryPatch = input.dominantLayer !== null;
	const tryFixtureExpand = input.fixtureHealth?.hasCoverageGap === true;
	const parts: string[] = [];
	parts.push(`dominantLayer=${input.dominantLayer ?? "none"}`);
	if (input.fixtureHealth) {
		parts.push(
			`coverage(uncovered=${input.fixtureHealth.coverage.uncoveredStrata.length}, gini=${input.fixtureHealth.coverage.giniCoefficient.toFixed(2)}, gap=${input.fixtureHealth.hasCoverageGap})`,
		);
	} else {
		// Could be: no documentCatalog passed, no quality-queries stage,
		// missing field on older report, or null report. The extractor
		// collapses all of those — surface them as one bucket here.
		parts.push("coverage=signal-unavailable");
	}
	parts.push(`tryPatch=${tryPatch} tryFixtureExpand=${tryFixtureExpand}`);
	return { tryPatch, tryFixtureExpand, rationale: parts.join(" ") };
}

/**
 * Recipe-pipeline fixture-expand path. Programmatically calls
 * recipe-author → adversarial-filter → recipe-validate → recipe-apply
 * against the top under-represented strata. Splicing into
 * `gold-authored-queries.ts` and PR creation are deferred to slice 1f;
 * this slice writes the proposed codegen to a per-cycle artifact and
 * surfaces it via notes.
 *
 * Honors:
 *   - `--dry-run` → never write anything; just report what would happen.
 *   - `WTFOC_ALLOW_FIXTURE_EXPAND=1` → required for production runs;
 *     when unset and not dry-run, this path is unreachable (gated by
 *     `runLoop` before calling).
 *   - `WTFOC_RECIPE_MAX_NEW_QUERIES_PER_RUN` (default 5) → cap.
 */
async function runFixtureExpandPath(input: {
	cli: CliArgs;
	fixtureHealth: FixtureHealthSignal;
	notes: string[];
}): Promise<LoopOutcome> {
	const { cli, fixtureHealth, notes } = input;
	const top = fixtureHealth.coverage.uncoveredStrata.slice(0, 5).map(
		(u) => `${u.key.sourceType}/${u.key.queryType} (artifacts=${u.artifactsInCorpus})`,
	);
	notes.push(
		`fixture-expand path: collection=${fixtureHealth.collectionId} uncovered=${fixtureHealth.coverage.uncoveredStrata.length} gini=${fixtureHealth.coverage.giniCoefficient.toFixed(2)}`,
	);
	if (top.length > 0) {
		notes.push(`fixture-expand top strata: ${top.join("; ")}`);
	}

	// Pull the heavy deps + helpers lazily so the rest of the loop (and
	// its unit tests) doesn't pay the import cost on cycles that never
	// route here. `runRecipePipeline` itself is the orchestrator built in
	// slice 1e (#360); see `recipe-pipeline.ts`.
	const [{ runRecipePipeline, DEFAULT_MAX_NEW_QUERIES_PER_RUN }, { createStore }, search] =
		await Promise.all([
			import("./recipe-pipeline.js"),
			import("@wtfoc/store"),
			import("@wtfoc/search"),
		]);
	const { catalogFilePath, readCatalog } = await import("@wtfoc/ingest");

	const store = createStore({ storage: "local" });
	const head = await store.manifests.getHead(fixtureHealth.collectionId);
	if (!head) {
		notes.push(`fixture-expand: collection "${fixtureHealth.collectionId}" not found in store`);
		return { status: "coverage-gap-skipped", notes };
	}
	const manifestDir =
		(store.manifests as { dir?: string }).dir ?? `${process.env.HOME ?? "."}/.wtfoc/projects`;
	const catalogPath = catalogFilePath(manifestDir, fixtureHealth.collectionId);
	const catalog = await readCatalog(catalogPath);
	if (!catalog) {
		notes.push(`fixture-expand: catalog missing at ${catalogPath} — skipping`);
		return { status: "coverage-gap-skipped", notes };
	}

	const embedderUrl = process.env.WTFOC_EMBEDDER_URL ?? "";
	const embedderModel = process.env.WTFOC_EMBEDDER_MODEL ?? "";
	if (!embedderUrl || !embedderModel) {
		notes.push(
			"fixture-expand: WTFOC_EMBEDDER_URL / WTFOC_EMBEDDER_MODEL unset; cannot author candidates",
		);
		return { status: "coverage-gap-skipped", notes };
	}
	const embedder = new search.OpenAIEmbedder({
		apiKey: process.env.WTFOC_EMBEDDER_KEY ?? "",
		model: embedderModel,
		baseUrl: embedderUrl,
	});
	const vectorIndex = new search.InMemoryVectorIndex();
	const mounted = await search.mountCollection(head.manifest, store.storage, vectorIndex);

	const maxNew = process.env.WTFOC_RECIPE_MAX_NEW_QUERIES_PER_RUN
		? Number(process.env.WTFOC_RECIPE_MAX_NEW_QUERIES_PER_RUN)
		: DEFAULT_MAX_NEW_QUERIES_PER_RUN;

	const result = await runRecipePipeline({
		collectionId: fixtureHealth.collectionId,
		fixtureHealth,
		catalog,
		segments: mounted.segments,
		vectorIndex,
		embedder,
		maxNew,
	});

	notes.push(
		`fixture-expand: targeted=${result.targetedStrata.length} authored=${result.authoredCount} adv-kept=${result.adversarialKept} kept=${result.kept.length} structural-errors=${result.structuralErrors.length}`,
	);
	if (result.authorErrors.length > 0) {
		notes.push(`fixture-expand: ${result.authorErrors.length} author error(s)`);
	}

	if (result.kept.length === 0 || !result.codegen) {
		notes.push("fixture-expand: no keeper candidates this cycle");
		return { status: "coverage-gap-skipped", notes };
	}

	if (cli.dryRun) {
		notes.push(`fixture-expand: --dry-run; would splice ${result.kept.length} new queries`);
		return { status: "coverage-gap-detected", notes };
	}

	// Slice 1e stops short of writing gold-authored-queries.ts + opening
	// a PR — that's slice 1f. For now persist the codegen preview to an
	// autoresearch artifact path so the maintainer can review.
	const { writeFile, mkdir } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const artifactDir =
		process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	const previewDir = join(artifactDir, "fixture-expand-previews");
	await mkdir(previewDir, { recursive: true });
	const previewPath = join(
		previewDir,
		`${fixtureHealth.collectionId}-${new Date().toISOString().replace(/[:.]/g, "-")}.preview.ts`,
	);
	const banner = `// Recipe-pipeline preview — review before splicing into\n// packages/search/src/eval/gold-authored-queries.ts.\n// Generated: ${new Date().toISOString()} collection=${fixtureHealth.collectionId}\n\nexport const RECIPE_PIPELINE_PREVIEW = ${result.codegen};\n`;
	await writeFile(previewPath, banner, "utf-8");
	notes.push(`fixture-expand: codegen preview written to ${previewPath} (slice 1f wires PR)`);
	return { status: "coverage-gap-detected", notes };
}

async function runPatchPath(input: {
	cli: CliArgs;
	matrix: Matrix;
	finding: Finding;
	explainMd: string;
	triedRows: readonly RunLogRow[] | readonly import("./tried-log.js").TriedLogRow[];
	notes: string[];
	latestReport?: ExtendedDogfoodReport | null;
}): Promise<LoopOutcome> {
	const { cli, matrix, finding, explainMd, notes, latestReport } = input;
	const triedRows = input.triedRows as readonly import("./tried-log.js").TriedLogRow[];
	const sweepMode = resolveModeFromMatrix(matrix);

	// #344 step 5 — gate the LLM patch surface on the diagnosed dominant
	// failure layer. Tier 0 (graders / fixtures / scorer / runner) never
	// appears in any capsule; `fixture` and `ingest` layers return null and
	// the loop skips this cycle so a human can triage instead.
	const dominantLayer = extractDominantLayer(latestReport ?? null);
	const capsule = selectPatchCapsule(dominantLayer);
	if (capsule === null && dominantLayer !== null) {
		notes.push(
			`patch path skipped: dominantLayer="${dominantLayer}" is human-only (no LLM patch surface)`,
		);
		return { status: "patch-no-proposal", notes };
	}
	if (capsule) {
		notes.push(
			`patch capsule: layer="${capsule.dominantLayer}" tiers=[${capsule.tiers.join(",")}] paths=${capsule.allowedPaths.length}`,
		);
	}

	if (!(await swapMode("chat", "patch-llm-analyze", notes))) {
		return { status: "patch-llm-unavailable", notes };
	}

	const llm = await analyzeAndProposePatch({
		matrixName: cli.matrixName,
		explainMarkdown: explainMd,
		triedRows,
		...(capsule
			? {
					curatedFiles: capsule.curatedFiles,
					allowedPaths: capsule.allowedPaths,
				}
			: {}),
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
		const filesTouched = new Set(llm.proposal.edits.map((e) => e.file));
		notes.push(
			`DRY-RUN patch proposal: baseSha=${llm.proposal.baseSha}, ${llm.proposal.edits.length} edit(s) across ${filesTouched.size} file(s): ${[...filesTouched].slice(0, 3).join(", ")}`,
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

	// #360 — corpus-level fixture-health signal alongside per-failure
	// dominantLayer. Both feed `decideLoopAction`, which routes between
	// patch and fixture-expand under independent caps. When neither path
	// applies, the loop falls through to the existing variant flow below.
	const fixtureHealth = extractFixtureHealthSignal(latestReport);
	const dominantLayerForRouting = extractDominantLayer(latestReport);
	const decision = decideLoopAction({
		dominantLayer: dominantLayerForRouting,
		fixtureHealth,
	});
	notes.push(`route: ${decision.rationale}`);

	// #360 — fixture-expand path is a NON-patch action. Gated separately
	// from `WTFOC_ALLOW_PATCHES`. The early-return below is conditional on
	// (a) only fixture-expand wants in (no dominantLayer competing) AND
	// (b) `--dry-run` OR `WTFOC_ALLOW_FIXTURE_EXPAND=1` is set. When the
	// gate is closed OR a dominantLayer is also present, the loop continues
	// to the existing variant / patch flow so a single coverage gap can't
	// monopolize cycles.
	const fixtureExpandGateOpen =
		cli.dryRun || process.env.WTFOC_ALLOW_FIXTURE_EXPAND === "1";
	if (
		decision.tryFixtureExpand &&
		!decision.tryPatch &&
		fixtureExpandGateOpen &&
		fixtureHealth
	) {
		return runFixtureExpandPath({ cli, fixtureHealth, notes });
	}
	if (decision.tryFixtureExpand && fixtureHealth) {
		if (decision.tryPatch) {
			notes.push(
				"fixture-expand opportunity detected; dominantLayer also present, deferring fixture-expand and continuing to variant/patch flow",
			);
		} else if (!fixtureExpandGateOpen) {
			notes.push(
				"fixture-expand opportunity detected but gated off; continuing to variant flow (set WTFOC_ALLOW_FIXTURE_EXPAND=1 or --dry-run to route here)",
			);
		}
	}

	const triedRows = readTriedLog();

	if (cli.skipLlm) {
		notes.push("--skip-llm: bypassing LLM proposer");
		return { status: "llm-unavailable", notes };
	}

	const sweepMode = resolveModeFromMatrix(matrix);

	// --force-patch: skip the variant path entirely and go straight to the
	// code-patch path. Used for validating patch mechanics end-to-end
	// without waiting for the planner queue to exhaust.
	if (cli.forcePatch) {
		notes.push("--force-patch: bypassing variant path, going straight to patch path");
		if (!(await swapMode("chat", "force-patch-llm", notes))) {
			return { status: "patch-llm-unavailable", notes };
		}
		return await runPatchPath({
			cli,
			matrix,
			finding,
			explainMd,
			triedRows,
			notes,
			latestReport,
		});
	}

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
					latestReport,
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
