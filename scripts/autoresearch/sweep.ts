#!/usr/bin/env tsx
/**
 * Autoresearch sweep driver. Maintainer-only.
 *
 * Usage:
 *   pnpm autoresearch:sweep <matrix-name> [--variant-filter id1,id2] [--stage tag]
 *
 * Resolves `<matrix-name>` to `scripts/autoresearch/matrices/<name>.ts`,
 * loads the exported `default` Matrix, enumerates variants, runs each
 * variant through every corpus in `baseConfig.collections` (variant-
 * major iteration), captures `ExtendedDogfoodReport` per (variant,
 * corpus), and aggregates a cross-corpus headline + decision per
 * variant.
 *
 * Variant-major iteration: variant1 on primary, variant1 on secondary,
 * variant2 on primary, variant2 on secondary, ... — gives immediate
 * paired evidence per variant and limits crash damage to the variant
 * boundary (the cache namespace shards by corpus digest, so corpus-
 * major iteration would not reuse caches anyway).
 *
 * Cross-corpus decision rule (per-corpus decide() against same-corpus
 * baseline; aggregate accept = both per-corpus decisions accept). The
 * paired bootstrap inside decide() requires aligned QueryScore
 * families and cannot meaningfully join queries across corpora with
 * different fixtures, so the aggregate is a logical AND, not a single
 * pooled bootstrap.
 *
 * Phase 2 ships this as TOOLING ONLY — no auto-promotion. The driver
 * produces rankings; it does NOT promote winning configs into project
 * defaults. That gate stays manual until methodology is hardened.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { appendRunLogRow, buildRunLogRow } from "../lib/run-log.js";
import { decide, type DecisionVerdict } from "./decision.js";
import { computeHeadline, type Headline } from "./headline.js";
import {
	enumerateVariants,
	filterVariants,
	type Matrix,
	normalizeCollections,
	type Variant,
} from "./matrix.js";
import { formatLeaderboard, paretoLeaderboard, type ParetoInput } from "./pareto.js";

interface PerCorpusRun {
	corpus: string;
	report: ExtendedDogfoodReport;
	durationMs: number;
	decisionVsBaseline?: DecisionVerdict;
	/** Path to the archived full report JSON. */
	reportPath: string;
}

interface SweepRunResult {
	variantId: string;
	variant: Variant;
	primary: PerCorpusRun;
	secondary?: PerCorpusRun;
	headline: Headline;
	/**
	 * Aggregate accept = per-corpus decisions all accept. Single-corpus
	 * mode collapses to the primary's decision.
	 */
	aggregateAccept: boolean;
}

interface CliArgs {
	matrixName: string;
	variantFilter: string[] | null;
	stage: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	let matrixName: string | null = null;
	let variantFilter: string[] | null = null;
	let stage: string | null = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i] ?? "";
		if (a === "--variant-filter") {
			const next = args[++i];
			if (!next) throw new Error("--variant-filter requires a comma-separated list");
			variantFilter = next.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
			continue;
		}
		if (a.startsWith("--variant-filter=")) {
			variantFilter = a
				.slice("--variant-filter=".length)
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			continue;
		}
		if (a === "--stage") {
			const next = args[++i];
			if (!next) throw new Error("--stage requires a tag value");
			stage = next;
			continue;
		}
		if (a.startsWith("--stage=")) {
			stage = a.slice("--stage=".length);
			continue;
		}
		if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
		if (matrixName === null) {
			matrixName = a;
			continue;
		}
		throw new Error(`unexpected positional argument: ${a}`);
	}
	if (!matrixName) {
		throw new Error("usage: pnpm autoresearch:sweep <matrix-name> [--variant-filter ids] [--stage tag]");
	}
	return { matrixName, variantFilter, stage };
}

function summaryMetrics(report: ExtendedDogfoodReport) {
	const qq = report.stages.find((s) => s.stage === "quality-queries");
	const m = qq?.metrics as
		| {
				cost?: Record<string, { cost_usd?: number | null }>;
				timing?: Record<string, { p95Ms?: number }>;
		  }
		| undefined;
	let costUsdTotal: number | null = 0;
	if (m?.cost) {
		for (const sub of Object.values(m.cost)) {
			if (sub?.cost_usd === null) {
				costUsdTotal = null;
				break;
			}
			if (typeof sub?.cost_usd === "number") costUsdTotal += sub.cost_usd;
		}
	} else {
		costUsdTotal = null;
	}
	let latencyP95Ms: number | null = null;
	if (m?.timing) {
		const p95s: number[] = [];
		for (const sub of Object.values(m.timing)) {
			if (typeof sub?.p95Ms === "number") p95s.push(sub.p95Ms);
		}
		if (p95s.length > 0) latencyP95Ms = Math.max(...p95s);
	}
	return { costUsdTotal, latencyP95Ms };
}

function logErr(...parts: unknown[]): void {
	const s = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
	console.error(s);
}

async function loadMatrix(matrixName: string): Promise<Matrix> {
	const here = dirname(fileURLToPath(import.meta.url));
	const matrixPath = join(here, "matrices", `${matrixName}.ts`);
	try {
		const mod = (await import(matrixPath)) as { default: Matrix };
		if (!mod.default) throw new Error(`matrix ${matrixName} does not export a default Matrix`);
		return mod.default;
	} catch (err) {
		throw new Error(
			`failed to load matrix "${matrixName}" from ${matrixPath}: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

function runVariantOnCorpus(
	matrix: Matrix,
	variant: Variant,
	collection: string,
	sweepId: string,
): { report: ExtendedDogfoodReport; durationMs: number; reportPath: string } {
	const archiveDir = resolve(
		`${process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`}/reports/${sweepId}`,
	);
	mkdirSync(archiveDir, { recursive: true });
	const archivePath = join(archiveDir, `${variant.variantId}__${collection}.json`);
	const tmp = mkdtempSync(join(tmpdir(), "wtfoc-sweep-"));
	const outFile = join(tmp, `${variant.variantId}-${collection}.json`);
	const args: string[] = [
		"tsx",
		"--tsconfig",
		"scripts/tsconfig.json",
		"scripts/dogfood.ts",
		"--collection",
		collection,
		"--stage",
		"quality-queries",
		"--embedder-url",
		matrix.baseConfig.embedderUrl,
		"--embedder-model",
		matrix.baseConfig.embedderModel,
		"--output",
		outFile,
	];
	if (matrix.baseConfig.embedderKey) {
		args.push("--embedder-key", matrix.baseConfig.embedderKey);
	}
	if (matrix.baseConfig.embedderCacheDir) {
		args.push("--embedder-cache-dir", matrix.baseConfig.embedderCacheDir);
	}
	if (matrix.baseConfig.extractorUrl && matrix.baseConfig.extractorModel) {
		args.push(
			"--extractor-url",
			matrix.baseConfig.extractorUrl,
			"--extractor-model",
			matrix.baseConfig.extractorModel,
		);
		if (matrix.baseConfig.extractorKey) {
			args.push("--extractor-key", matrix.baseConfig.extractorKey);
		}
	}
	if (variant.axes.autoRoute) args.push("--auto-route");
	if (variant.axes.diversityEnforce) args.push("--diversity-enforce");
	if (variant.axes.reranker !== "off") {
		args.push("--reranker-type", variant.axes.reranker.type);
		args.push("--reranker-url", variant.axes.reranker.url);
		if (variant.axes.reranker.type === "llm") {
			args.push("--reranker-model", variant.axes.reranker.model);
		}
	}

	logErr(`[sweep] running variant ${variant.variantId} on ${collection}`);
	const t0 = performance.now();
	execFileSync("pnpm", args, { stdio: ["ignore", "pipe", "inherit"] });
	const durationMs = performance.now() - t0;

	const reportText = readFileSync(outFile, "utf-8");
	const report = JSON.parse(reportText) as ExtendedDogfoodReport;
	writeFileSync(archivePath, reportText);
	return { report, durationMs, reportPath: archivePath };
}

function summarize(results: SweepRunResult[]): void {
	logErr("");
	logErr("=== Pareto leaderboard (primary corpus) ===");
	const inputs: ParetoInput[] = results.map((r) => {
		const sm = summaryMetrics(r.primary.report);
		return {
			variantId: r.variantId,
			quality: r.headline.scalar,
			costUsdTotal: sm.costUsdTotal,
			latencyP95Ms: sm.latencyP95Ms,
			costComparable: r.primary.report.costComparable?.value ?? false,
			allGatesPassed: r.headline.allGatesPassed,
		};
	});
	const lb = paretoLeaderboard(inputs);
	logErr(formatLeaderboard(lb));

	if (results.length >= 2) {
		logErr("");
		logErr("=== Decision vs baseline (paired bootstrap, primary corpus) ===");
		logErr("variantId                   | accept | meanΔ   | probB>A | gates  | reasons");
		logErr("---------------------------+--------+---------+---------+--------+---------");
		for (const r of results) {
			if (!r.primary.decisionVsBaseline) continue;
			const v = r.primary.decisionVsBaseline;
			const acc = v.accept ? " ✓ yes  " : " ✗ no   ";
			const meanD = `${(v.bootstrap.meanDelta * 100).toFixed(1)}pp`.padStart(7);
			const prob = v.bootstrap.probBgreaterA.toFixed(3).padEnd(7);
			const gates = v.gateResults.every((g) => g.ok) ? " ✓ all  " : " ✗ fail ";
			const reasons = v.reasons.length > 0 ? v.reasons.join("; ") : "—";
			logErr(`${r.variantId.padEnd(27)} | ${acc} | ${meanD} | ${prob} | ${gates} | ${reasons}`);
		}
	}

	const anyCrossCorpus = results.some((r) => r.secondary);
	if (anyCrossCorpus) {
		logErr("");
		logErr("=== Cross-corpus aggregate (headline + per-corpus accept) ===");
		logErr("variantId                   | scalar  | portV12 | portV3  | aggAcc | gates");
		logErr("---------------------------+---------+---------+---------+--------+--------");
		for (const r of results) {
			const scalar = r.headline.scalar.toFixed(3).padEnd(7);
			const v12 = r.headline.portableV12.toFixed(3).padEnd(7);
			const v3 = r.headline.portableV3 !== null ? r.headline.portableV3.toFixed(3).padEnd(7) : "—      ";
			const aggAcc = r.aggregateAccept ? " ✓ yes  " : " ✗ no   ";
			const gates = r.headline.allGatesPassed ? "✓ all" : "✗ fail";
			logErr(`${r.variantId.padEnd(27)} | ${scalar} | ${v12} | ${v3} | ${aggAcc} | ${gates}`);
		}
	}
}

function writeSweepReport(matrixName: string, sweepId: string, results: SweepRunResult[]): string {
	const sweepDir = `${process.env.HOME}/.wtfoc/autoresearch/sweeps`;
	mkdirSync(sweepDir, { recursive: true });
	const path = join(sweepDir, `${sweepId}.json`);
	const body = {
		matrixName,
		sweepId,
		startedAt: new Date().toISOString(),
		variants: results.map((r) => ({
			variantId: r.variantId,
			variant: r.variant,
			headline: r.headline,
			aggregateAccept: r.aggregateAccept,
			runs: [
				{
					corpus: r.primary.corpus,
					runConfigFingerprint: r.primary.report.runConfigFingerprint,
					durationMs: r.primary.durationMs,
					decisionVsBaseline: r.primary.decisionVsBaseline ?? null,
				},
				...(r.secondary
					? [
							{
								corpus: r.secondary.corpus,
								runConfigFingerprint: r.secondary.report.runConfigFingerprint,
								durationMs: r.secondary.durationMs,
								decisionVsBaseline: r.secondary.decisionVsBaseline ?? null,
							},
						]
					: []),
			],
		})),
	};
	writeFileSync(path, JSON.stringify(body, null, 2));
	return path;
}

async function main(): Promise<void> {
	let cli: CliArgs;
	try {
		cli = parseArgs(process.argv);
	} catch (err) {
		logErr(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
	const matrix = await loadMatrix(cli.matrixName);
	const corpora = normalizeCollections(matrix.baseConfig);
	const allVariants = enumerateVariants(matrix);
	const variants = cli.variantFilter
		? filterVariants(allVariants, cli.variantFilter)
		: allVariants;
	const sweepId = `sweep-${matrix.name}-${Date.now()}`;
	const stage = cli.stage ?? null;
	logErr(
		`[sweep] matrix=${matrix.name} variants=${variants.length} corpora=${
			corpora.secondary ? "primary+secondary" : "primary-only"
		} sweepId=${sweepId} stage=${stage ?? "(none)"}`,
	);

	const results: SweepRunResult[] = [];
	let primaryBaselineReport: ExtendedDogfoodReport | null = null;
	let secondaryBaselineReport: ExtendedDogfoodReport | null = null;

	for (const v of variants) {
		// Primary corpus run.
		const primaryRun = runVariantOnCorpus(matrix, v, corpora.primary, sweepId);
		const primary: PerCorpusRun = {
			corpus: corpora.primary,
			report: primaryRun.report,
			durationMs: primaryRun.durationMs,
			reportPath: primaryRun.reportPath,
		};
		if (primaryBaselineReport) {
			primary.decisionVsBaseline = decide({
				baseline: primaryBaselineReport,
				candidate: primary.report,
			});
		} else {
			primaryBaselineReport = primary.report;
		}
		appendRunLogRow(
			buildRunLogRow({
				sweepId,
				matrixName: matrix.name,
				variantId: v.variantId,
				report: primary.report,
				durationMs: primary.durationMs,
				reportPath: primary.reportPath,
				...(stage ? { stage } : {}),
			}),
		);

		// Secondary corpus run (when configured).
		let secondary: PerCorpusRun | undefined;
		if (corpora.secondary) {
			const secondaryRun = runVariantOnCorpus(matrix, v, corpora.secondary, sweepId);
			secondary = {
				corpus: corpora.secondary,
				report: secondaryRun.report,
				durationMs: secondaryRun.durationMs,
				reportPath: secondaryRun.reportPath,
			};
			if (secondaryBaselineReport) {
				secondary.decisionVsBaseline = decide({
					baseline: secondaryBaselineReport,
					candidate: secondary.report,
				});
			} else {
				secondaryBaselineReport = secondary.report;
			}
			appendRunLogRow(
				buildRunLogRow({
					sweepId,
					matrixName: matrix.name,
					variantId: v.variantId,
					report: secondary.report,
					durationMs: secondary.durationMs,
					reportPath: secondary.reportPath,
					...(stage ? { stage } : {}),
				}),
			);
		}

		const headline = computeHeadline({
			v12: primary.report,
			...(secondary ? { v3: secondary.report } : {}),
		});

		// Aggregate accept = all per-corpus decisions accept (or, in
		// single-corpus mode, just the primary). The very first variant
		// has no decision (it IS the baseline) and counts as accepting.
		const aggregateAccept =
			(primary.decisionVsBaseline ? primary.decisionVsBaseline.accept : true) &&
			(secondary?.decisionVsBaseline ? secondary.decisionVsBaseline.accept : true);

		results.push({
			variantId: v.variantId,
			variant: v,
			primary,
			...(secondary ? { secondary } : {}),
			headline,
			aggregateAccept,
		});
	}

	summarize(results);
	const reportPath = writeSweepReport(matrix.name, sweepId, results);
	const totalRows = results.length * (corpora.secondary ? 2 : 1);
	logErr(`[sweep] sweep summary → ${reportPath}`);
	logErr(`[sweep] run log appended at ~/.wtfoc/autoresearch/runs.jsonl (${totalRows} rows)`);
}

main().catch((err) => {
	logErr("[sweep] fatal:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
