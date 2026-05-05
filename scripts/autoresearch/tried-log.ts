/**
 * Tried-log: persistent memory of variants the autoresearch loop has
 * already explored, so the LLM proposer doesn't re-propose a knob that
 * was rejected last week.
 *
 * Append-only JSONL at `~/.wtfoc/autoresearch/tried.jsonl` (override
 * via `WTFOC_AUTORESEARCH_DIR`). One row per evaluated proposal —
 * accepted or rejected.
 *
 * Reader contract identical to runs.jsonl: rows are independent;
 * unknown fields tolerated; never rewrite history. Future schema bumps
 * MUST add fields, not rename or remove.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TRIED_LOG_SCHEMA_VERSION = 1;

export type TriedVerdict = "accepted" | "rejected" | "errored";

export interface TriedLogRow {
	schemaVersion: number;
	loggedAt: string;
	matrixName: string;
	/**
	 * Variant id derived from the proposal — encodes the production
	 * variant + the proposed delta. The proposer hashes the
	 * (axis, value) pair into a stable suffix so the same proposal
	 * dedupes on lookup.
	 */
	variantId: string;
	proposal: {
		axis: string;
		value: boolean | number | string;
		rationale: string;
	};
	/** Sweep id (when the variant was actually run). */
	sweepId?: string;
	/** runConfigFingerprint of the candidate run, when available. */
	runConfigFingerprint?: string;
	/** Aggregate verdict from the materializer. */
	verdict: TriedVerdict;
	/** Free-form reasons string from decide() / errors / notes. */
	reasons: string[];
	/**
	 * Compact metric snapshot of the candidate. Used by the proposer
	 * prompt to summarise prior attempts without loading full reports.
	 */
	metrics?: {
		passRate?: number;
		demoCriticalPassRate?: number | null;
		recallAtKMean?: number | null;
		latencyP95Ms?: number | null;
	};
}

export interface TriedLogPaths {
	dir: string;
	jsonlPath: string;
}

export function triedLogPaths(): TriedLogPaths {
	const baseDir = process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	return { dir: baseDir, jsonlPath: join(baseDir, "tried.jsonl") };
}

export function appendTriedRow(row: TriedLogRow, paths: TriedLogPaths = triedLogPaths()): void {
	mkdirSync(dirname(paths.jsonlPath), { recursive: true });
	appendFileSync(paths.jsonlPath, `${JSON.stringify(row)}\n`);
}

export function readTriedLog(paths: TriedLogPaths = triedLogPaths()): TriedLogRow[] {
	let raw: string;
	try {
		raw = readFileSync(paths.jsonlPath, "utf-8");
	} catch {
		return [];
	}
	const out: TriedLogRow[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			out.push(JSON.parse(trimmed) as TriedLogRow);
		} catch {
			// drop unparseable lines — never crash on a single bad row
		}
	}
	return out;
}

/**
 * Has this exact (axis, value) been tried for the given matrix in the
 * last `withinDays` days? Used to short-circuit the LLM proposer.
 */
export function alreadyTried(
	rows: readonly TriedLogRow[],
	matrixName: string,
	axis: string,
	value: boolean | number | string,
	withinDays = 30,
): TriedLogRow | null {
	const horizon = Date.now() - withinDays * 24 * 60 * 60 * 1000;
	for (let i = rows.length - 1; i >= 0; i--) {
		const r = rows[i];
		if (!r) continue;
		if (r.matrixName !== matrixName) continue;
		if (r.proposal.axis !== axis) continue;
		if (r.proposal.value !== value) continue;
		if (new Date(r.loggedAt).getTime() < horizon) return null;
		return r;
	}
	return null;
}

/**
 * Render a prompt section listing prior attempts with full cause-and-
 * effect context. The proposer needs to see not just THAT something was
 * rejected but WHY (anti-overfit, baseline-window failure, validation
 * error, etc.) so it can avoid repeating the same shape of mistake.
 *
 * Format per row (multi-line, structured):
 *   - [verdict] axis=value pass=X%
 *     Rationale: <full LLM rationale, untruncated>
 *     Outcome: <reasons joined; system's response to the proposal>
 *
 * Pre-fix the LLM saw `[rejected]` markers + 120-char truncated
 * rationale snippets and no reasons at all — "goldfish memory regarding
 * consequences" (gemini peer-review 2026-05-05). One-shot reasoning
 * across iterations because it never saw why prior tries failed.
 */
export function triedLogPromptLines(
	rows: readonly TriedLogRow[],
	matrixName: string,
	limit = 30,
): string[] {
	const filtered = rows.filter((r) => r.matrixName === matrixName).slice(-limit);
	if (filtered.length === 0) return ["(no prior attempts on this matrix)"];
	const lines: string[] = [];
	for (const r of filtered) {
		const m = r.metrics;
		const metricStr = m
			? `pass=${m.passRate !== undefined ? `${(m.passRate * 100).toFixed(1)}%` : "?"}`
			: "";
		lines.push(
			`- [${r.verdict}] ${r.proposal.axis}=${JSON.stringify(r.proposal.value)} ${metricStr}`,
		);
		if (r.proposal.rationale) {
			lines.push(`  Rationale: ${r.proposal.rationale}`);
		}
		const reasons = r.reasons?.filter(Boolean) ?? [];
		if (reasons.length > 0) {
			lines.push(`  Outcome: ${reasons.join("; ")}`);
		}
	}
	return lines;
}
