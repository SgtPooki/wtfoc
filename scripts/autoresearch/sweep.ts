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
import { enumerateVariants, type Matrix, type Variant } from "./matrix.js";

interface SweepRunResult {
	variantId: string;
	variant: Variant;
	report: ExtendedDogfoodReport;
	durationMs: number;
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
	const rows = results.map((r) => {
		const qq = r.report.stages.find((s) => s.stage === "quality-queries");
		const m = qq?.metrics as
			| {
					passRate?: number;
					applicableTotal?: number;
					passCount?: number;
					portabilityBreakdown?: { portable?: { passRate?: number } };
			  }
			| undefined;
		const passRate = m?.passRate ?? 0;
		const portable = m?.portabilityBreakdown?.portable?.passRate ?? 0;
		return {
			variantId: r.variantId,
			fingerprint: r.report.runConfigFingerprint?.slice(0, 12) ?? "??",
			passRate,
			portable,
			durationMs: Math.round(r.durationMs),
		};
	});
	rows.sort((a, b) => b.passRate - a.passRate);
	logErr("");
	logErr("=== sweep summary ===");
	logErr("variantId                   | fingerprint  | pass     | portable | duration");
	logErr("---------------------------+--------------+----------+----------+----------");
	for (const r of rows) {
		const line = [
			r.variantId.padEnd(27),
			r.fingerprint.padEnd(12),
			`${(r.passRate * 100).toFixed(1)}%`.padEnd(8),
			`${(r.portable * 100).toFixed(1)}%`.padEnd(8),
			`${(r.durationMs / 1000).toFixed(1)}s`,
		].join(" | ");
		logErr(line);
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
	for (const v of variants) {
		const result = runVariant(matrix, v);
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
