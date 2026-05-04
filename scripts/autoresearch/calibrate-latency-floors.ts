/**
 * Calibration analysis for #364 latency-floor gates.
 *
 * Loads the cached 2026-05-04 16-variant sweep and runs `decideMulti`
 * pairwise: production variant (`noar_div_rrOff`) as baseline vs every
 * other variant as candidate. Reports per-pair latencyWarnings and
 * decideMulti accept/reject under both warn-only and hard-fail modes.
 *
 * Purpose: confirm DEFAULT_P95_FLOOR_MS / DEFAULT_TOTAL_P95_FLOOR_MS /
 * DEFAULT_CATASTROPHIC_LATENCY_FACTOR are calibrated against real
 * regression patterns the loop will encounter. If thresholds catch real
 * regressions without false alarms, flip DEFAULT_LATENCY_GATE_HARD to
 * true in a follow-up PR.
 *
 * Run: `pnpm tsx scripts/autoresearch/calibrate-latency-floors.ts`
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/364
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { decideMulti } from "./decision.js";

const SWEEP_DIR = join(
	homedir(),
	".wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204",
);

const PRODUCTION_VARIANT = "noar_div_rrOff";
const CORPORA = ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"];

interface VariantReports {
	variantId: string;
	reports: Map<string, ExtendedDogfoodReport>;
	missingCorpora: string[];
}

function loadVariant(variantId: string): VariantReports {
	const reports = new Map<string, ExtendedDogfoodReport>();
	const missing: string[] = [];
	for (const corpus of CORPORA) {
		const path = join(SWEEP_DIR, `${variantId}__${corpus}.json`);
		try {
			const r = JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
			reports.set(corpus, r);
		} catch {
			missing.push(corpus);
		}
	}
	return { variantId, reports, missingCorpora: missing };
}

function listVariants(): string[] {
	const files = readdirSync(SWEEP_DIR).filter((f) => f.endsWith(".json"));
	const variants = new Set<string>();
	for (const f of files) {
		const idx = f.indexOf("__");
		if (idx > 0) variants.add(f.slice(0, idx));
	}
	return Array.from(variants).sort();
}

function p95Of(report: ExtendedDogfoodReport): number | null {
	const stage = report.stages.find((s) => s.stage === "quality-queries");
	const m = stage?.metrics as Record<string, unknown> | undefined;
	const t = m?.timing as Record<string, { p95Ms?: number }> | undefined;
	return typeof t?.["per-query-total"]?.p95Ms === "number"
		? t["per-query-total"].p95Ms
		: null;
}

function main(): void {
	const variants = listVariants();
	const baseline = loadVariant(PRODUCTION_VARIANT);
	if (baseline.missingCorpora.length === CORPORA.length) {
		console.error(`Baseline variant ${PRODUCTION_VARIANT} not found in sweep`);
		process.exit(1);
	}

	console.log(`# Latency calibration analysis (#364)`);
	console.log(`Sweep:    ${SWEEP_DIR}`);
	console.log(`Baseline: ${PRODUCTION_VARIANT}`);
	console.log();

	console.log(`## Per-variant per-corpus p95 (per-query-total)`);
	console.log(`| variant | filoz p95 | dogfood p95 |`);
	console.log(`|---|---|---|`);
	for (const v of variants) {
		const reports = loadVariant(v);
		const filoz = reports.reports.get(CORPORA[0]!);
		const dogfood = reports.reports.get(CORPORA[1]!);
		const fp = filoz ? p95Of(filoz) : null;
		const dp = dogfood ? p95Of(dogfood) : null;
		console.log(
			`| ${v} | ${fp ?? "—"}ms | ${dp ?? "—"}ms |${v === PRODUCTION_VARIANT ? " ← baseline" : ""}`,
		);
	}
	console.log();

	console.log(`## Pairwise decideMulti (warn-only mode)`);
	console.log(
		`Baseline = ${PRODUCTION_VARIANT}; reports any candidate variant whose latency would warn or catastrophically fire.`,
	);
	console.log();

	const candidates = variants.filter((v) => v !== PRODUCTION_VARIANT);
	let warnCount = 0;
	let catastrophicCount = 0;
	let hardFailCount = 0;
	const acceptedUnderWarnOnlyCount = { yes: 0, no: 0 };
	const acceptedUnderHardFailCount = { yes: 0, no: 0 };

	for (const cv of candidates) {
		const c = loadVariant(cv);
		if (c.reports.size === 0) {
			console.log(`### ${cv} — skipped (no reports)`);
			continue;
		}
		const verdictWarn = decideMulti({
			baseline: baseline.reports,
			candidate: c.reports,
			cumulativeLocChange: 1,
		});
		const verdictHard = decideMulti({
			baseline: baseline.reports,
			candidate: c.reports,
			cumulativeLocChange: 1,
			floors: { latencyGateHard: true },
		});

		if (verdictWarn.latencyWarnings.length > 0) {
			console.log(`### ${cv}`);
			for (const p of verdictWarn.perCorpus) {
				const delta =
					p.baselineP95Ms !== null && p.candidateP95Ms !== null
						? p.candidateP95Ms - p.baselineP95Ms
						: null;
				console.log(
					`  ${p.corpusId}: baseline=${p.baselineP95Ms}ms candidate=${p.candidateP95Ms}ms Δ=${delta !== null ? (delta >= 0 ? "+" : "") + delta : "—"}ms`,
				);
			}
			for (const w of verdictWarn.latencyWarnings) {
				const isCatastrophic = w.includes("catastrophic latency");
				if (isCatastrophic) catastrophicCount++;
				else warnCount++;
				console.log(`    ${isCatastrophic ? "🚨" : "⚠️"} ${w}`);
			}
			console.log(
				`  warn-only verdict: ${verdictWarn.accept ? "ACCEPT" : "REJECT (non-latency)"}`,
			);
			console.log(
				`  hard-fail verdict: ${verdictHard.accept ? "ACCEPT" : "REJECT"}${verdictHard.accept ? "" : ` — ${verdictHard.reasons.filter((r) => r.includes("p95") || r.includes("latency")).join("; ")}`}`,
			);
			console.log();
		}

		if (verdictWarn.accept) acceptedUnderWarnOnlyCount.yes++;
		else acceptedUnderWarnOnlyCount.no++;
		if (verdictHard.accept) acceptedUnderHardFailCount.yes++;
		else acceptedUnderHardFailCount.no++;
		if (!verdictHard.accept && verdictWarn.accept) hardFailCount++;
	}

	console.log(`## Summary`);
	console.log(`Total candidate variants: ${candidates.length}`);
	console.log(`Latency warnings emitted (non-catastrophic): ${warnCount}`);
	console.log(`Catastrophic latency triggers: ${catastrophicCount}`);
	console.log(`Pairs that flip ACCEPT→REJECT under hard-fail: ${hardFailCount}`);
	console.log();
	console.log(
		`Accepted under warn-only: ${acceptedUnderWarnOnlyCount.yes} / rejected: ${acceptedUnderWarnOnlyCount.no}`,
	);
	console.log(
		`Accepted under hard-fail: ${acceptedUnderHardFailCount.yes} / rejected: ${acceptedUnderHardFailCount.no}`,
	);
	console.log();
	console.log(`## Decision`);
	if (hardFailCount === 0) {
		console.log(
			`No pair flips ACCEPT→REJECT under hard-fail. Either the floors are too lenient (no real regressions caught) OR all candidate variants are within tolerance. Inspect per-corpus deltas above.`,
		);
	} else {
		console.log(
			`Hard-fail mode would reject ${hardFailCount} additional candidate(s). Inspect to confirm rejections target genuine regressions. If real, flip DEFAULT_LATENCY_GATE_HARD to true in a follow-up PR.`,
		);
	}
}

main();
