#!/usr/bin/env tsx
/**
 * Phase 4 nightly regression detector. Maintainer-only.
 *
 * Reads `runs.jsonl`, identifies the latest run for the production
 * variant on the primary corpus, builds a baseline window of prior
 * comparable runs (exact `runConfigFingerprint` match), and flags:
 *
 *   - "breach":     a hard gate floor is violated by the latest run.
 *   - "regression": a majority of baseline runs convincingly beat the
 *                   latest by paired bootstrap (probBgreaterA >= 0.95
 *                   with A=new, B=old; meanDelta >= 0.04).
 *
 * Comparability rule: same `runConfigFingerprint` + same `corpusDigest`.
 * If the production fingerprint changed (matrix tweak, embedder swap,
 * fixture bump), there is no comparable history — emit
 * `insufficient-history` and exit 0. The cron treats that as an
 * intentional baseline rollover, not a regression.
 *
 * Usage:
 *   pnpm autoresearch:detect-regression \
 *     --matrix retrieval-baseline \
 *     [--variant noar_div_rrOff] \
 *     [--corpus filoz-ecosystem-2026-04-v12] \
 *     [--stage nightly-cron] \
 *     [--min-baseline 3] \
 *     [--output /path/to/findings.json]
 *
 * Output (stdout, JSON):
 *   { status: "ok" | "breach" | "regression" | "both" | "insufficient-history",
 *     latest: { sweepId, loggedAt, fingerprint }, findings: Finding[] }
 *
 * Always exits 0 on a successful read — the wrapper inspects findings
 * and decides whether to file an issue. Non-zero exit means the
 * detector itself crashed (config error, missing files, etc.).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFamilyResults, pairedBootstrap } from "../lib/paired-bootstrap.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { readRunLog, type RunLogPaths, type RunLogRow, runLogPaths } from "../lib/run-log.js";
import { DEFAULT_GATES, evaluateGates, type HardGates } from "./decision.js";
import type { Matrix } from "./matrix.js";

export const REGRESSION_MIN_PROB = 0.95;
export const REGRESSION_MIN_MEAN_DELTA = 0.04;
export const DEFAULT_MIN_BASELINE = 3;

export interface Finding {
	type: "breach" | "regression";
	variantId: string;
	corpus: string;
	corpusDigest: string;
	fingerprint: string;
	fingerprintVersion: number;
	metric: string;
	latestValue: number | null;
	floor?: number;
	baselineMean?: number;
	delta?: number;
	probBgreaterA?: number;
	bootstrapMeanDelta?: number;
	baselineSweepIds?: string[];
	latestSweepId: string;
	latestLoggedAt: string;
	reason: string;
}

export type CorpusStatus =
	| "ok"
	| "breach"
	| "regression"
	| "both"
	| "insufficient-history";

export interface CorpusSummary {
	corpus: string;
	status: CorpusStatus;
	latest: {
		sweepId: string;
		loggedAt: string;
		fingerprint: string;
		variantId: string;
		corpus: string;
	} | null;
	baselineCount: number;
}

export interface DetectionOutcome {
	/** Aggregate status across all corpora — worst-of. */
	status: CorpusStatus;
	/** Per-corpus summary. Tests + CLI iterate over this. */
	corpora: CorpusSummary[];
	findings: Finding[];
	notes: string[];
	/** Matrix name when the detector was invoked with one — surfaced in issue bodies. */
	matrixName?: string;
}

export interface SingleCorpusInputs {
	rows: RunLogRow[];
	variantId: string;
	corpus: string;
	corpusDigest?: string;
	matrixName?: string;
	stage?: string;
	minBaseline?: number;
	gates?: HardGates;
	/** Loader override for the archived full report. Default reads `row.reportPath`. */
	loadReport?: (row: RunLogRow) => ExtendedDogfoodReport | null;
}

export interface DetectionInputs extends Omit<SingleCorpusInputs, "corpus"> {
	/** One or more corpora — each gets its own per-corpus summary + findings. */
	corpora: string[];
}

interface CliArgs {
	matrixName: string;
	variantId: string | null;
	corpora: string[] | null;
	stage: string | null;
	minBaseline: number;
	output: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	let matrixName: string | null = null;
	let variantId: string | null = null;
	let corpora: string[] | null = null;
	let stage: string | null = null;
	let minBaseline = DEFAULT_MIN_BASELINE;
	let output: string | null = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i] ?? "";
		const next = (): string => {
			const v = args[++i];
			if (!v) throw new Error(`${a} requires a value`);
			return v;
		};
		if (a === "--matrix") {
			matrixName = next();
			continue;
		}
		if (a.startsWith("--matrix=")) {
			matrixName = a.slice("--matrix=".length);
			continue;
		}
		if (a === "--variant") {
			variantId = next();
			continue;
		}
		if (a.startsWith("--variant=")) {
			variantId = a.slice("--variant=".length);
			continue;
		}
		if (a === "--corpus" || a === "--corpora") {
			corpora = next()
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			continue;
		}
		if (a.startsWith("--corpus=") || a.startsWith("--corpora=")) {
			const eq = a.indexOf("=");
			corpora = a
				.slice(eq + 1)
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			continue;
		}
		if (a === "--stage") {
			stage = next();
			continue;
		}
		if (a.startsWith("--stage=")) {
			stage = a.slice("--stage=".length);
			continue;
		}
		if (a === "--min-baseline") {
			minBaseline = Number.parseInt(next(), 10);
			continue;
		}
		if (a.startsWith("--min-baseline=")) {
			minBaseline = Number.parseInt(a.slice("--min-baseline=".length), 10);
			continue;
		}
		if (a === "--output") {
			output = next();
			continue;
		}
		if (a.startsWith("--output=")) {
			output = a.slice("--output=".length);
			continue;
		}
		throw new Error(`unknown flag: ${a}`);
	}
	if (!matrixName) {
		throw new Error("usage: autoresearch:detect-regression --matrix <name> [...]");
	}
	if (!Number.isFinite(minBaseline) || minBaseline < 1) {
		throw new Error(`--min-baseline must be a positive integer (got ${minBaseline})`);
	}
	return { matrixName, variantId, corpora, stage, minBaseline, output };
}

function loadReportFromPath(row: RunLogRow): ExtendedDogfoodReport | null {
	if (!row.reportPath) return null;
	try {
		const text = readFileSync(row.reportPath, "utf-8");
		return JSON.parse(text) as ExtendedDogfoodReport;
	} catch {
		return null;
	}
}

/**
 * Multi-corpus public entry point. Detects regressions per corpus and
 * aggregates findings into a single outcome. The aggregate `status` is
 * the worst-of across corpora.
 */
export function detectRegression(input: DetectionInputs): DetectionOutcome {
	const findings: Finding[] = [];
	const notes: string[] = [];
	const corpora: CorpusSummary[] = [];
	for (const corpus of input.corpora) {
		const single = detectRegressionForCorpus({ ...input, corpus });
		findings.push(...single.findings);
		notes.push(...single.notes);
		corpora.push({
			corpus,
			status: single.status,
			latest: single.latest,
			baselineCount: single.baselineCount,
		});
	}

	let status: CorpusStatus = "ok";
	const breach = findings.some((f) => f.type === "breach");
	const regression = findings.some((f) => f.type === "regression");
	if (breach && regression) status = "both";
	else if (breach) status = "breach";
	else if (regression) status = "regression";
	else if (corpora.every((c) => c.status === "insufficient-history"))
		status = "insufficient-history";

	return {
		status,
		corpora,
		findings,
		notes,
		...(input.matrixName ? { matrixName: input.matrixName } : {}),
	};
}

interface SingleCorpusOutcome {
	status: CorpusStatus;
	latest: CorpusSummary["latest"];
	baselineCount: number;
	findings: Finding[];
	notes: string[];
}

function detectRegressionForCorpus(input: SingleCorpusInputs): SingleCorpusOutcome {
	const gates = input.gates ?? DEFAULT_GATES;
	const minBaseline = input.minBaseline ?? DEFAULT_MIN_BASELINE;
	const loadReport = input.loadReport ?? loadReportFromPath;
	const notes: string[] = [];

	const matching = input.rows.filter((r) => {
		if (r.variantId !== input.variantId) return false;
		if (r.runConfig.collectionId !== input.corpus) return false;
		if (input.corpusDigest && r.runConfig.corpusDigest !== input.corpusDigest) return false;
		if (input.matrixName && r.matrixName !== input.matrixName) return false;
		if (input.stage && r.stage !== input.stage) return false;
		return true;
	});

	if (matching.length === 0) {
		return {
			status: "insufficient-history",
			latest: null,
			baselineCount: 0,
			findings: [],
			notes: [
				`no rows for variant=${input.variantId} corpus=${input.corpus}` +
					(input.stage ? ` stage=${input.stage}` : "") +
					(input.matrixName ? ` matrix=${input.matrixName}` : ""),
			],
		};
	}

	matching.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
	const latest = matching[matching.length - 1];
	if (!latest) {
		return {
			status: "insufficient-history",
			latest: null,
			baselineCount: 0,
			findings: [],
			notes: ["no rows after sort (impossible)"],
		};
	}

	const fingerprint = latest.runConfigFingerprint;
	const baseline = matching.slice(0, -1).filter((r) => r.runConfigFingerprint === fingerprint);
	const droppedForFingerprintMismatch =
		matching.length - 1 - baseline.length;
	if (droppedForFingerprintMismatch > 0) {
		notes.push(
			`dropped ${droppedForFingerprintMismatch} prior row(s) with mismatched runConfigFingerprint — baseline rollover`,
		);
	}

	if (baseline.length < minBaseline) {
		notes.push(
			`baseline window has ${baseline.length} comparable run(s) for corpus=${input.corpus}; need >= ${minBaseline}`,
		);
		return {
			status: "insufficient-history",
			latest: {
				sweepId: latest.sweepId,
				loggedAt: latest.loggedAt,
				fingerprint,
				variantId: latest.variantId,
				corpus: latest.runConfig.collectionId,
			},
			baselineCount: baseline.length,
			findings: [],
			notes,
		};
	}

	const findings: Finding[] = [];
	const latestReport = loadReport(latest);
	if (!latestReport) {
		notes.push(
			`could not load full report for latest run (${latest.sweepId}) on corpus=${input.corpus}; breach + regression checks skipped`,
		);
		return {
			status: "insufficient-history",
			latest: {
				sweepId: latest.sweepId,
				loggedAt: latest.loggedAt,
				fingerprint,
				variantId: latest.variantId,
				corpus: latest.runConfig.collectionId,
			},
			baselineCount: baseline.length,
			findings: [],
			notes,
		};
	}

	// 1. Breach detection — uses latest report against absolute floors.
	const gateResults = evaluateGates(latestReport, gates);
	for (const g of gateResults) {
		if (!g.ok) {
			findings.push({
				type: "breach",
				variantId: latest.variantId,
				corpus: latest.runConfig.collectionId,
				corpusDigest: latest.runConfig.corpusDigest,
				fingerprint,
				fingerprintVersion: latest.fingerprintVersion,
				metric: g.name,
				latestValue: g.actual,
				floor: g.floor,
				latestSweepId: latest.sweepId,
				latestLoggedAt: latest.loggedAt,
				reason: `hard gate "${g.name}" failed: ${(g.actual * 100).toFixed(1)}% < ${(g.floor * 100).toFixed(1)}%`,
			});
		}
	}

	// 2. Regression detection — paired bootstrap latest vs each baseline run.
	const latestScores = extractScores(latestReport);
	let baselineWins = 0;
	const winningBaselineSweeps: string[] = [];
	const perBaselineDeltas: number[] = [];
	let perBaselineProbs: number[] = [];
	for (const b of baseline) {
		const bReport = loadReport(b);
		if (!bReport) {
			notes.push(`could not load full report for baseline run (${b.sweepId}); excluded`);
			continue;
		}
		const baselineScores = extractScores(bReport);
		// A = new (latest), B = old (baseline). probBgreaterA >= 0.95
		// AND meanDelta >= 0.04 means "old convincingly beats new."
		const families = buildFamilyResults(latestScores, baselineScores);
		if (families.length === 0) {
			notes.push(`baseline run ${b.sweepId} had no aligned families with latest; skipped`);
			continue;
		}
		const bs = pairedBootstrap(families, { iterations: 5000 });
		perBaselineDeltas.push(bs.meanDelta);
		perBaselineProbs.push(bs.probBgreaterA);
		if (bs.probBgreaterA >= REGRESSION_MIN_PROB && bs.meanDelta >= REGRESSION_MIN_MEAN_DELTA) {
			baselineWins++;
			winningBaselineSweeps.push(b.sweepId);
		}
	}
	const usableBaseline = perBaselineDeltas.length;
	if (usableBaseline < minBaseline) {
		// We had >= minBaseline rows but lost some to missing reports / no
		// aligned families. Don't emit a "regression" or "ok" verdict on
		// thin air — surface it as insufficient-history so the cron knows
		// the detector silently lost coverage.
		notes.push(
			`only ${usableBaseline} of ${baseline.length} baseline run(s) usable for paired bootstrap on corpus=${input.corpus} (need >= ${minBaseline}) — skipping regression check`,
		);
		return {
			status: gateResults.some((g) => !g.ok) ? "breach" : "insufficient-history",
			latest: {
				sweepId: latest.sweepId,
				loggedAt: latest.loggedAt,
				fingerprint,
				variantId: latest.variantId,
				corpus: latest.runConfig.collectionId,
			},
			baselineCount: usableBaseline,
			findings,
			notes,
		};
	}
	const majority = Math.floor(usableBaseline / 2) + 1;
	if (baselineWins >= majority) {
		const avgDelta = perBaselineDeltas.reduce((a, b) => a + b, 0) / perBaselineDeltas.length;
		const avgProb = perBaselineProbs.reduce((a, b) => a + b, 0) / perBaselineProbs.length;
		findings.push({
			type: "regression",
			variantId: latest.variantId,
			corpus: latest.runConfig.collectionId,
			corpusDigest: latest.runConfig.corpusDigest,
			fingerprint,
			fingerprintVersion: latest.fingerprintVersion,
			metric: "passRate",
			latestValue: latest.summary.passRate,
			baselineMean: latest.summary.passRate + avgDelta,
			bootstrapMeanDelta: avgDelta,
			probBgreaterA: avgProb,
			delta: -avgDelta,
			baselineSweepIds: winningBaselineSweeps,
			latestSweepId: latest.sweepId,
			latestLoggedAt: latest.loggedAt,
			reason:
				`${baselineWins}/${usableBaseline} baseline runs convincingly beat latest ` +
				`(avg meanΔ=${avgDelta.toFixed(3)}, avg probBgreaterA=${avgProb.toFixed(3)})`,
		});
	}

	const breachCount = findings.filter((f) => f.type === "breach").length;
	const regressionCount = findings.filter((f) => f.type === "regression").length;
	let status: CorpusStatus;
	if (breachCount === 0 && regressionCount === 0) status = "ok";
	else if (breachCount > 0 && regressionCount > 0) status = "both";
	else if (breachCount > 0) status = "breach";
	else status = "regression";

	return {
		status,
		latest: {
			sweepId: latest.sweepId,
			loggedAt: latest.loggedAt,
			fingerprint,
			variantId: latest.variantId,
			corpus: latest.runConfig.collectionId,
		},
		baselineCount: baseline.length,
		findings,
		notes,
	};
}

interface ScoreLike {
	id: string;
	passed: boolean;
	skipped?: boolean;
}

function extractScores(report: ExtendedDogfoodReport): ScoreLike[] {
	const qq = report.stages.find((s) => s.stage === "quality-queries");
	const m = qq?.metrics as { scores?: ScoreLike[] } | undefined;
	return m?.scores ?? [];
}

async function loadMatrix(matrixName: string): Promise<Matrix> {
	const here = dirname(fileURLToPath(import.meta.url));
	const matrixPath = join(here, "matrices", `${matrixName}.ts`);
	const mod = (await import(matrixPath)) as { default: Matrix };
	if (!mod.default) throw new Error(`matrix ${matrixName} has no default export`);
	return mod.default;
}

async function main(): Promise<void> {
	const cli = parseArgs(process.argv);
	const matrix = await loadMatrix(cli.matrixName);
	const variantId =
		cli.variantId ??
		process.env.WTFOC_PRODUCTION_VARIANT ??
		matrix.productionVariantId;
	if (!variantId) {
		throw new Error(
			`no production variant resolvable: matrix ${cli.matrixName} has no productionVariantId, ` +
				`--variant not given, WTFOC_PRODUCTION_VARIANT not set`,
		);
	}
	let corpora: string[];
	if (cli.corpora && cli.corpora.length > 0) {
		corpora = cli.corpora;
	} else {
		const matrixCorpora: string[] = [];
		if (matrix.baseConfig.collections?.primary) {
			matrixCorpora.push(matrix.baseConfig.collections.primary);
		}
		if (matrix.baseConfig.collections?.secondary) {
			matrixCorpora.push(matrix.baseConfig.collections.secondary);
		}
		if (matrixCorpora.length === 0 && matrix.baseConfig.collection) {
			matrixCorpora.push(matrix.baseConfig.collection);
		}
		if (matrixCorpora.length === 0) {
			throw new Error(`no corpora resolvable from matrix ${cli.matrixName}`);
		}
		corpora = matrixCorpora;
	}

	const paths: RunLogPaths = runLogPaths();
	const rows = readRunLog(paths);
	const outcome = detectRegression({
		rows,
		variantId,
		corpora,
		matrixName: cli.matrixName,
		...(cli.stage ? { stage: cli.stage } : {}),
		minBaseline: cli.minBaseline,
	});

	const json = JSON.stringify(outcome, null, 2);
	if (cli.output) {
		const { writeFileSync, mkdirSync } = await import("node:fs");
		mkdirSync(dirname(cli.output), { recursive: true });
		writeFileSync(cli.output, json);
	}
	console.log(json);
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
		console.error("[detect-regression] fatal:", err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
