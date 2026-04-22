#!/usr/bin/env tsx
/**
 * Compare a dogfood report JSON against the flagship thresholds (wtfoc-vlk0).
 *
 * Usage:
 *   pnpm tsx scripts/dogfood-check-thresholds.ts <report.json>
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
	skippedCount?: number;
	skippedReasons?: Array<{ id: string; reason: string }>;
	categoryBreakdown: Record<string, Breakdown>;
	tierBreakdown?: Record<string, Breakdown>;
}

interface Threshold {
	label: string;
	actual: number;
	floor: number;
}

const THRESHOLDS = {
	overallMin: 0.8, // raised from 0.65 after diversity-enforce landed (#161)
	workLineageMin: 0.875, // 7/8
	demoCriticalMin: 1.0, // 5/5 hard floor
	fileLevelMin: 1.0,
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

function collectThresholds(m: Metrics): Threshold[] {
	return [
		{ label: "overall", actual: m.passRate, floor: THRESHOLDS.overallMin },
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
	];
}

function main(): void {
	const path = process.argv[2];
	if (!path) {
		console.error("usage: dogfood-check-thresholds.ts <report.json>");
		process.exit(2);
	}
	const m = loadMetrics(path);
	const checks = collectThresholds(m);

	const applicable = m.applicableTotal ?? m.totalQueries;
	console.log(`Report: ${path}`);
	console.log(`Fixture: ${m.goldQueriesVersion ?? "?"}`);
	console.log(`Overall: ${m.passCount}/${applicable} (${(m.passRate * 100).toFixed(1)}%)`);
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
	if (failed > 0) {
		console.error(`\n${failed} threshold(s) violated`);
		process.exit(1);
	}
	console.log("\nAll thresholds met");
}

main();
