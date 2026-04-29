#!/usr/bin/env tsx
/**
 * Autoresearch sweep driver. Maintainer-only.
 *
 * Usage:
 *   pnpm autoresearch:sweep <matrix-name>
 *
 * Resolves `<matrix-name>` to `scripts/autoresearch/matrices/<name>.ts`,
 * loads the exported `default` Matrix, enumerates variants, runs each
 * variant via `pnpm dogfood --collection ... --output <tmpfile>`, and
 * captures the resulting `ExtendedDogfoodReport`.
 *
 * Phase 2a: scaffolding only — runs each variant, prints the report
 * fingerprint + headline pass-rate, and writes a sweep-summary file.
 * Phase 2b/c/d/e/f layer the run log, paired-bootstrap, two-stage
 * pruning, headline scalar, and Pareto leaderboard on top.
 *
 * Phase 2 ships as TOOLING ONLY. The driver produces rankings; it
 * does NOT auto-promote winning configs into project defaults. That
 * gate stays manual until methodology is hardened (peer-review
 * consensus on #311 — "hybrid is sane only if explicitly demoted to
 * tooling, not optimization").
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { appendRunLogRow, buildRunLogRow } from "../lib/run-log.js";
import { decide, type DecisionVerdict } from "./decision.js";
import { computeHeadline, type Headline } from "./headline.js";
import { enumerateVariants, type Matrix, type Variant } from "./matrix.js";
import { formatLeaderboard, paretoLeaderboard, type ParetoInput } from "./pareto.js";

interface SweepRunResult {
	variantId: string;
	variant: Variant;
	report: ExtendedDogfoodReport;
	durationMs: number;
	headline: Headline;
	decisionVsBaseline?: DecisionVerdict;
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

function runVariant(matrix: Matrix, variant: Variant): SweepRunResult {
	const tmp = mkdtempSync(join(tmpdir(), "wtfoc-sweep-"));
	const outFile = join(tmp, `${variant.variantId}.json`);
	const args: string[] = [
		"tsx",
		"--tsconfig",
		"scripts/tsconfig.json",
		"scripts/dogfood.ts",
		"--collection",
		matrix.baseConfig.collection,
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

	logErr(`[sweep] running variant ${variant.variantId}`);
	const t0 = performance.now();
	execFileSync("pnpm", args, { stdio: ["ignore", "pipe", "inherit"] });
	const durationMs = performance.now() - t0;

	const reportText = readFileSync(outFile, "utf-8");
	const report = JSON.parse(reportText) as ExtendedDogfoodReport;
	return { variantId: variant.variantId, variant, report, durationMs };
}

function summarize(results: SweepRunResult[]): void {
	logErr("");
	logErr("=== Pareto leaderboard ===");
	const inputs: ParetoInput[] = results.map((r) => {
		const sm = summaryMetrics(r.report);
		return {
			variantId: r.variantId,
			quality: r.headline.scalar,
			costUsdTotal: sm.costUsdTotal,
			latencyP95Ms: sm.latencyP95Ms,
			costComparable: r.report.costComparable?.value ?? false,
			allGatesPassed: r.headline.allGatesPassed,
		};
	});
	const lb = paretoLeaderboard(inputs);
	logErr(formatLeaderboard(lb));

	if (results[0]?.decisionVsBaseline) {
		logErr("");
		logErr("=== Decision vs baseline (paired bootstrap) ===");
		logErr("variantId                   | accept | meanΔ   | probB>A | gates  | reasons");
		logErr("---------------------------+--------+---------+---------+--------+---------");
		for (const r of results) {
			if (!r.decisionVsBaseline) continue;
			const v = r.decisionVsBaseline;
			const acc = v.accept ? " ✓ yes  " : " ✗ no   ";
			const meanD = `${(v.bootstrap.meanDelta * 100).toFixed(1)}pp`.padStart(7);
			const prob = v.bootstrap.probBgreaterA.toFixed(3).padEnd(7);
			const gates = v.gateResults.every((g) => g.ok) ? " ✓ all  " : " ✗ fail ";
			const reasons = v.reasons.length > 0 ? v.reasons.join("; ") : "—";
			logErr(`${r.variantId.padEnd(27)} | ${acc} | ${meanD} | ${prob} | ${gates} | ${reasons}`);
		}
	}
}

function writeSweepReport(matrixName: string, results: SweepRunResult[]): string {
	const sweepDir = `${process.env.HOME}/.wtfoc/autoresearch`;
	mkdirSync(sweepDir, { recursive: true });
	const path = join(sweepDir, `sweep-${matrixName}-${Date.now()}.json`);
	const body = {
		matrixName,
		startedAt: new Date().toISOString(),
		variants: results.map((r) => ({
			variantId: r.variantId,
			variant: r.variant,
			runConfigFingerprint: r.report.runConfigFingerprint,
			report: r.report,
			durationMs: r.durationMs,
		})),
	};
	writeFileSync(path, JSON.stringify(body, null, 2));
	return path;
}

async function main(): Promise<void> {
	const matrixName = process.argv[2];
	if (!matrixName) {
		logErr("usage: pnpm autoresearch:sweep <matrix-name>");
		process.exit(2);
	}
	const matrix = await loadMatrix(matrixName);
	const variants = enumerateVariants(matrix);
	const sweepId = `sweep-${matrix.name}-${Date.now()}`;
	logErr(`[sweep] matrix=${matrix.name} variants=${variants.length} sweepId=${sweepId}`);
	const results: SweepRunResult[] = [];
	let baselineReport: ExtendedDogfoodReport | null = null;
	for (const v of variants) {
		const runResult = runVariant(matrix, v);
		const headline = computeHeadline({ v12: runResult.report });
		const result: SweepRunResult = { ...runResult, headline };
		// Decide vs the FIRST variant in enumeration order (the
		// reference / baseline). Phase 2d may switch this to a pinned
		// baseline once Stage A/B pruning lands.
		if (baselineReport) {
			result.decisionVsBaseline = decide({
				baseline: baselineReport,
				candidate: result.report,
			});
		} else {
			baselineReport = result.report;
		}
		results.push(result);
		const row = buildRunLogRow({
			sweepId,
			matrixName: matrix.name,
			variantId: v.variantId,
			report: result.report,
			durationMs: result.durationMs,
		});
		appendRunLogRow(row);
	}
	summarize(results);
	const reportPath = writeSweepReport(matrix.name, results);
	logErr(`[sweep] sweep report → ${reportPath}`);
	logErr(`[sweep] run log appended at ~/.wtfoc/autoresearch/runs.jsonl (${variants.length} rows)`);
}

main().catch((err) => {
	logErr("[sweep] fatal:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
