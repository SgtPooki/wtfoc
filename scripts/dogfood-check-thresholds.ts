#!/usr/bin/env tsx
/**
 * Compare a dogfood report JSON against the flagship thresholds (wtfoc-vlk0).
 *
 * Usage:
 *   pnpm exec tsx scripts/dogfood-check-thresholds.ts <report.json>
 *
 * Exit 0 on all thresholds met, 1 on any violation. Used by the weekly
 * flagship-corpus regression check — keep it strict enough to catch
 * demo-critical regressions and loose enough not to flap on small
 * retrieval noise.
 */
import { readFileSync } from "node:fs";

interface Breakdown {
	total: number;
	passed: number;
	passRate: number;
}

interface Metrics {
	goldQueriesVersion?: string;
	passRate: number;
	passCount: number;
	totalQueries: number;
	applicableTotal?: number;
	applicableRate?: number;
	skippedCount?: number;
	skippedReasons?: Array<{ id: string; reason: string }>;
	categoryBreakdown: Record<string, Breakdown>;
	tierBreakdown?: Record<string, Breakdown>;
	portabilityBreakdown?: Record<string, Breakdown>;
	paraphraseInvariance?: {
		checked: boolean;
		withParaphrases: number;
		invariantFraction: number;
	};
}

interface Threshold {
	label: string;
	actual: number;
	floor: number;
}

const THRESHOLDS = {
	// v1.9.0 re-baseline (#311 peer-review (a)): fixture grew 67 → 157
	// base queries via parallel subagent pass (codex/cursor/gemini).
	// Many new queries are deliberately harder than the original 45 —
	// reaching ≥150 INDEPENDENT base queries the way reviewer (peer-
	// review (a)) flagged is mandatory means the per-category pass
	// rates drop by construction. Floors here reflect post-expansion
	// numbers with one-cycle buffer.
	overallMin: 0.55, // re-baselined from 56.9% — captures regression without flapping on the now-much-harder fixture.
	workLineageMin: 0.6, // was 0.875 (8/9). Now 27 wl queries; 17 pass = 63%. Floor = 60% with one-query buffer.
	demoCriticalMin: 1.0, // 5/5 hard floor — unchanged. Demo-critical remains the original wl-1..wl-5 set.
	fileLevelMin: 0.7, // was 1.0 (4/4). Now 12 fl queries; 9 pass = 75%. Floor at 70%.
	// Portability floor (v1.6.0 → v1.9.0). Was 70% on 13 portable;
	// now ~30 portable. Re-baselined from 46% — flagship regression
	// detector, not gating.
	portableMin: 0.4,
	// Applicability floor. A high pass rate on a low applicable rate is
	// the overfit-and-skip signature — warn if the fixture can barely
	// answer this corpus. 60% picked as clear "fixture too specific"
	// signal without hair-triggering on legitimately-bounded corpora.
	applicableRateMin: 0.6,
	// Hard-negative pass rate (v1.8.0). Calibration: 0% floor today.
	// Phase 1+ tightens as negative scoring (top-K score floor +
	// cross-source dispersion check) lands. Tracked so a regression
	// that fabricates more false positives is visible immediately.
	hardNegativeMin: 0.0,
	// Paraphrase invariance fraction. v1.9.0 has 135 paraphrased
	// queries (45 original + 90 new). Floor at 0.7 with one-cycle
	// buffer — invariance dropping below this signals brittleness
	// creeping in.
	paraphraseInvariantMin: 0.7,
} as const;

function loadMetrics(path: string): Metrics {
	const raw = JSON.parse(readFileSync(path, "utf-8")) as {
		stages: Array<{ stage: string; metrics?: Metrics }>;
	};
	const qq = raw.stages.find((s) => s.stage === "quality-queries");
	if (!qq?.metrics) {
		console.error(`error: no quality-queries stage in ${path}`);
		process.exit(2);
	}
	return qq.metrics;
}

interface ReportCostComparability {
	value: boolean;
	reasons: string[];
}

function loadCostComparability(path: string): ReportCostComparability | null {
	const raw = JSON.parse(readFileSync(path, "utf-8")) as {
		costComparable?: ReportCostComparability;
	};
	return raw.costComparable ?? null;
}

function collectThresholds(m: Metrics): Threshold[] {
	return [
		{ label: "overall applicable", actual: m.passRate, floor: THRESHOLDS.overallMin },
		{
			label: "portable",
			actual: m.portabilityBreakdown?.portable?.passRate ?? 0,
			floor: THRESHOLDS.portableMin,
		},
		{
			label: "applicability rate",
			actual: m.applicableRate ?? 1,
			floor: THRESHOLDS.applicableRateMin,
		},
		{
			label: "work-lineage",
			actual: m.categoryBreakdown["work-lineage"]?.passRate ?? 0,
			floor: THRESHOLDS.workLineageMin,
		},
		{
			label: "demo-critical (tier)",
			actual: m.tierBreakdown?.["demo-critical"]?.passRate ?? 0,
			floor: THRESHOLDS.demoCriticalMin,
		},
		{
			label: "file-level",
			actual: m.categoryBreakdown["file-level"]?.passRate ?? 0,
			floor: THRESHOLDS.fileLevelMin,
		},
		{
			label: "hard-negative",
			actual: m.categoryBreakdown["hard-negative"]?.passRate ?? 0,
			floor: THRESHOLDS.hardNegativeMin,
		},
		...(m.paraphraseInvariance?.checked
			? [
					{
						label: "paraphrase invariance",
						actual: m.paraphraseInvariance.invariantFraction,
						floor: THRESHOLDS.paraphraseInvariantMin,
					},
				]
			: []),
	];
}

function main(): void {
	const args = process.argv.slice(2);
	const advisory = args.includes("--advisory");
	const requireCostRankable = args.includes("--require-cost-rankable");
	const path = args.find((a) => !a.startsWith("--"));
	if (!path) {
		console.error(
			"usage: dogfood-check-thresholds.ts [--advisory] [--require-cost-rankable] <report.json>",
		);
		process.exit(2);
	}
	const m = loadMetrics(path);
	const comparability = loadCostComparability(path);
	const checks = collectThresholds(m);

	const applicable = m.applicableTotal ?? m.totalQueries;
	console.log(`Report: ${path}`);
	console.log(`Fixture: ${m.goldQueriesVersion ?? "?"}`);
	if (advisory) console.log("Mode: advisory (thresholds reported, never fail-exit)");
	console.log(`Overall: ${m.passCount}/${applicable} (${(m.passRate * 100).toFixed(1)}%)`);
	if (typeof m.applicableRate === "number") {
		console.log(
			`Applicability: ${applicable}/${m.totalQueries} (${(m.applicableRate * 100).toFixed(1)}%)`,
		);
	}
	const portable = m.portabilityBreakdown?.portable;
	const corpusSpecific = m.portabilityBreakdown?.["corpus-specific"];
	if (portable) {
		console.log(`Portable: ${portable.passed}/${portable.total} (${(portable.passRate * 100).toFixed(1)}%)`);
	}
	if (corpusSpecific) {
		console.log(
			`Corpus-specific: ${corpusSpecific.passed}/${corpusSpecific.total} (${(corpusSpecific.passRate * 100).toFixed(1)}%)`,
		);
	}
	if (m.skippedCount && m.skippedCount > 0) {
		console.log(`Skipped: ${m.skippedCount}/${m.totalQueries} (inapplicable to this corpus)`);
		for (const s of m.skippedReasons ?? []) console.log(`  · ${s.id}: ${s.reason}`);
	}
	console.log("");

	let failed = 0;
	for (const c of checks) {
		const ok = c.actual >= c.floor;
		const pct = (c.actual * 100).toFixed(1);
		const floorPct = (c.floor * 100).toFixed(1);
		console.log(`${ok ? "✅" : "❌"} ${c.label}: ${pct}% (floor ${floorPct}%)`);
		if (!ok) failed++;
	}

	// Cost-comparability gate (peer-review consensus). Reports cost is
	// only rankable when every LLM call has known pricing + token counts.
	// `--require-cost-rankable` makes it a hard fail; otherwise it's a
	// warning so existing flagship runs (no usage capture today) keep
	// passing while we backfill the pricing table.
	if (comparability) {
		const ok = comparability.value;
		console.log(`${ok ? "✅" : "⚠️"} cost rankable: ${ok}`);
		if (!ok) {
			for (const reason of comparability.reasons) console.log(`  · ${reason}`);
			if (requireCostRankable) failed++;
		}
	} else if (requireCostRankable) {
		console.log("❌ cost rankable: report missing costComparable field");
		failed++;
	}

	if (failed > 0) {
		if (advisory) {
			console.error(`\n${failed} threshold(s) violated — advisory only (not exit 1)`);
			return;
		}
		console.error(`\n${failed} threshold(s) violated`);
		process.exit(1);
	}
	console.log("\nAll thresholds met");
}

main();
