/**
 * Append-only run log for the autoresearch sweep harness.
 * Maintainer-only.
 *
 * One JSONL row per variant run. The log NEVER rewrites history —
 * older rows stay even when the schema or fingerprint algorithm
 * changes (each row carries `fingerprintVersion` so a reader can
 * decide whether two rows are comparable).
 *
 * Reader contract: rows are independent. A consumer streaming the
 * file can drop unrecognised fields. Writers MUST add new fields
 * (never remove or rename) and bump the row's `schemaVersion` if
 * existing fields change semantics.
 *
 * Default location: `~/.wtfoc/autoresearch/runs.jsonl`. Override via
 * `WTFOC_AUTORESEARCH_DIR` (test fixtures, parallel sweeps).
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtendedDogfoodReport, RunConfig } from "./run-config.js";

export const RUN_LOG_SCHEMA_VERSION = 1;

export interface RunLogRow {
	/** Schema version of THIS row's shape (not the fingerprint). */
	schemaVersion: number;
	/** ISO timestamp of when this row was written. */
	loggedAt: string;
	/** Sweep id correlates rows from the same sweep invocation. */
	sweepId: string;
	/** Matrix name (e.g. "retrieval-baseline"). */
	matrixName: string;
	/** Variant id within the matrix (e.g. "ar_div_rrLlm-haiku"). */
	variantId: string;
	/**
	 * Sweep stage tag. Free-form string ("discovery", "confirmation",
	 * "smoke", etc.). Lets analysis distinguish a Stage 2 paraphrase
	 * rerun of the same variantId from the original Stage 1 row even
	 * before fingerprint differences kick in. Optional — older rows
	 * have no stage.
	 */
	stage?: string;
	/** Run identity — same as the report carries. */
	runConfig: RunConfig;
	runConfigFingerprint: string;
	fingerprintVersion: number;
	/** Lifted summary metrics for fast filtering without parsing the full report. */
	summary: {
		passRate: number;
		passCount: number;
		applicableTotal: number;
		portablePassRate: number | null;
		demoCriticalPassRate: number | null;
		hardNegativePassRate: number | null;
		paraphraseInvariantFraction: number | null;
		recallAtKMean: number | null;
		costComparable: boolean | null;
		costUsdTotal: number | null;
		latencyP95Ms: number | null;
	};
	/** Wall-clock duration of the variant run. */
	durationMs: number;
	/** Replicate index when this is part of an N-replicate measurement (Phase 2d). 0 = primary. */
	replicateIdx?: number;
	/**
	 * Absolute path to the archived full ExtendedDogfoodReport JSON for
	 * this run. Optional — older rows won't have it; newer rows written
	 * by the sweep harness do. Phase 4 cron detector requires this for
	 * paired bootstrap (the per-query scores live only in the report).
	 */
	reportPath?: string;
}

export interface RunLogPaths {
	dir: string;
	jsonlPath: string;
}

export function runLogPaths(): RunLogPaths {
	const baseDir = process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	return {
		dir: baseDir,
		jsonlPath: join(baseDir, "runs.jsonl"),
	};
}

interface SubstageStats {
	p95Ms?: number;
}
interface SubstageCostStats {
	cost_usd?: number | null;
}

export function buildRunLogRow(input: {
	sweepId: string;
	matrixName: string;
	variantId: string;
	report: ExtendedDogfoodReport;
	durationMs: number;
	replicateIdx?: number;
	stage?: string;
	reportPath?: string;
}): RunLogRow {
	const qq = input.report.stages.find((s) => s.stage === "quality-queries");
	const m = qq?.metrics as
		| {
				passRate?: number;
				passCount?: number;
				applicableTotal?: number;
				portabilityBreakdown?: { portable?: { passRate?: number } };
				tierBreakdown?: { "demo-critical"?: { passRate?: number } };
				categoryBreakdown?: { "hard-negative"?: { passRate?: number } };
				paraphraseInvariance?: { invariantFraction?: number; checked?: boolean };
				recallAtK?: { avgRecallAtK?: number; graded?: number };
				timing?: Record<string, SubstageStats>;
				cost?: Record<string, SubstageCostStats>;
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

	const p95s: number[] = [];
	if (m?.timing) {
		for (const sub of Object.values(m.timing)) {
			if (typeof sub?.p95Ms === "number") p95s.push(sub.p95Ms);
		}
	}
	const latencyP95Ms = p95s.length > 0 ? Math.max(...p95s) : null;

	if (!input.report.runConfig || !input.report.runConfigFingerprint) {
		throw new Error("ExtendedDogfoodReport missing runConfig/fingerprint");
	}

	return {
		schemaVersion: RUN_LOG_SCHEMA_VERSION,
		loggedAt: new Date().toISOString(),
		sweepId: input.sweepId,
		matrixName: input.matrixName,
		variantId: input.variantId,
		runConfig: input.report.runConfig,
		runConfigFingerprint: input.report.runConfigFingerprint,
		fingerprintVersion: input.report.fingerprintVersion ?? 0,
		summary: {
			passRate: m?.passRate ?? 0,
			passCount: m?.passCount ?? 0,
			applicableTotal: m?.applicableTotal ?? 0,
			portablePassRate: m?.portabilityBreakdown?.portable?.passRate ?? null,
			demoCriticalPassRate: m?.tierBreakdown?.["demo-critical"]?.passRate ?? null,
			hardNegativePassRate: m?.categoryBreakdown?.["hard-negative"]?.passRate ?? null,
			paraphraseInvariantFraction: m?.paraphraseInvariance?.checked
				? (m.paraphraseInvariance.invariantFraction ?? null)
				: null,
			recallAtKMean:
				m?.recallAtK?.graded && m.recallAtK.graded > 0 ? (m.recallAtK.avgRecallAtK ?? null) : null,
			costComparable: input.report.costComparable?.value ?? null,
			costUsdTotal,
			latencyP95Ms,
		},
		durationMs: Math.round(input.durationMs),
		...(input.replicateIdx !== undefined ? { replicateIdx: input.replicateIdx } : {}),
		...(input.stage !== undefined ? { stage: input.stage } : {}),
		...(input.reportPath !== undefined ? { reportPath: input.reportPath } : {}),
	};
}

export function appendRunLogRow(row: RunLogRow, paths: RunLogPaths = runLogPaths()): void {
	mkdirSync(dirname(paths.jsonlPath), { recursive: true });
	appendFileSync(paths.jsonlPath, `${JSON.stringify(row)}\n`);
}

export function readRunLog(paths: RunLogPaths = runLogPaths()): RunLogRow[] {
	let raw: string;
	try {
		raw = readFileSync(paths.jsonlPath, "utf-8");
	} catch {
		return [];
	}
	const out: RunLogRow[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			out.push(JSON.parse(trimmed) as RunLogRow);
		} catch {
			// Drop unparseable rows — never crash a reader on a single
			// bad line. Future writers may bump the schema and we want
			// older rows to stay readable.
		}
	}
	return out;
}
