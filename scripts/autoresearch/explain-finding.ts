/**
 * Build a structured markdown dump of a regression / breach finding for
 * an LLM analyzer.
 *
 * Inputs: the latest archived report + at least one baseline report
 * (best-of-baseline by pass-rate is fine for context). For a breach,
 * the baseline can be omitted — only floor + actual matter.
 *
 * Output: markdown with three sections:
 *   1. Identity (variant, corpus, fingerprint)
 *   2. Metrics summary (latest vs baseline, plus per-tier breakdowns)
 *   3. Flipped queries — passed-in-baseline + failed-in-latest, with
 *      retrieved chunks (top-K), gold spans, and per-stage timing.
 *
 * Section 3 is the high-leverage signal for the LLM — if it can spot a
 * pattern across the flipped queries (all work-lineage, all lost a
 * specific gold source-type, etc.) it can propose a focused fix.
 *
 * Hard cap on output size: 32K characters by default. Truncates the
 * flipped-queries list before truncating retrieved-chunk excerpts.
 */

import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import type { Finding } from "./detect-regression.js";

const DEFAULT_MAX_CHARS = 32_000;

interface QueryScore {
	id: string;
	passed: boolean;
	skipped?: boolean;
	question?: string;
	expectedSources?: string[];
	retrieved?: Array<{ source?: string; sourceType?: string; score?: number; excerpt?: string }>;
	tier?: string;
	category?: string;
}

export interface ExplainOptions {
	maxChars?: number;
	maxFlippedQueries?: number;
	maxChunksPerQuery?: number;
	maxChunkExcerptChars?: number;
}

export interface ExplainInputs {
	finding: Finding;
	latest: ExtendedDogfoodReport;
	baseline?: ExtendedDogfoodReport;
	options?: ExplainOptions;
}

function extractScores(report: ExtendedDogfoodReport): QueryScore[] {
	const qq = report.stages.find((s) => s.stage === "quality-queries");
	const m = qq?.metrics as { scores?: QueryScore[] } | undefined;
	return m?.scores ?? [];
}

function summaryMetrics(report: ExtendedDogfoodReport): {
	passRate: number | null;
	demoCriticalPassRate: number | null;
	workLineagePassRate: number | null;
	fileLevelPassRate: number | null;
	hardNegativePassRate: number | null;
	applicableRate: number | null;
	recallAtKMean: number | null;
	latencyP95Ms: number | null;
} {
	const qq = report.stages.find((s) => s.stage === "quality-queries");
	const m = qq?.metrics as
		| {
				passRate?: number;
				applicableRate?: number;
				tierBreakdown?: { "demo-critical"?: { passRate?: number } };
				categoryBreakdown?: {
					"work-lineage"?: { passRate?: number };
					"file-level"?: { passRate?: number };
					"hard-negative"?: { passRate?: number };
				};
				recallAtK?: { avgRecallAtK?: number };
				timing?: Record<string, { p95Ms?: number }>;
		  }
		| undefined;
	const p95s: number[] = [];
	if (m?.timing) {
		for (const v of Object.values(m.timing)) {
			if (typeof v?.p95Ms === "number") p95s.push(v.p95Ms);
		}
	}
	return {
		passRate: m?.passRate ?? null,
		demoCriticalPassRate: m?.tierBreakdown?.["demo-critical"]?.passRate ?? null,
		workLineagePassRate: m?.categoryBreakdown?.["work-lineage"]?.passRate ?? null,
		fileLevelPassRate: m?.categoryBreakdown?.["file-level"]?.passRate ?? null,
		hardNegativePassRate: m?.categoryBreakdown?.["hard-negative"]?.passRate ?? null,
		applicableRate: m?.applicableRate ?? null,
		recallAtKMean: m?.recallAtK?.avgRecallAtK ?? null,
		latencyP95Ms: p95s.length > 0 ? Math.max(...p95s) : null,
	};
}

function fmtPct(v: number | null): string {
	if (v === null) return "—";
	return `${(v * 100).toFixed(1)}%`;
}

function findFlippedQueries(
	latestScores: readonly QueryScore[],
	baselineScores: readonly QueryScore[],
): QueryScore[] {
	const baselineById = new Map<string, QueryScore>();
	for (const s of baselineScores) baselineById.set(s.id, s);
	const out: QueryScore[] = [];
	for (const l of latestScores) {
		if (l.skipped) continue;
		const b = baselineById.get(l.id);
		if (!b || b.skipped) continue;
		// passed-in-baseline + failed-in-latest = flipped
		if (b.passed && !l.passed) out.push(l);
	}
	return out;
}

export function explainFinding(input: ExplainInputs): string {
	const opts = input.options ?? {};
	const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
	const maxFlipped = opts.maxFlippedQueries ?? 20;
	const maxChunksPerQuery = opts.maxChunksPerQuery ?? 5;
	const maxChunkChars = opts.maxChunkExcerptChars ?? 400;

	const lines: string[] = [];
	const f = input.finding;

	lines.push("# Autoresearch finding analysis context");
	lines.push("");
	lines.push("## Identity");
	lines.push(`- variant: \`${f.variantId}\``);
	lines.push(`- corpus: \`${f.corpus}\``);
	lines.push(`- runConfigFingerprint: \`${f.fingerprint}\` (v${f.fingerprintVersion})`);
	lines.push(`- finding type: ${f.type}`);
	lines.push(`- metric: ${f.metric}`);
	lines.push(`- latestSweepId: \`${f.latestSweepId}\``);
	lines.push("");

	const latestSummary = summaryMetrics(input.latest);
	const baselineSummary = input.baseline ? summaryMetrics(input.baseline) : null;
	lines.push("## Metrics");
	lines.push("");
	lines.push("| metric | latest | baseline | Δ |");
	lines.push("|---|---|---|---|");
	for (const [name, key] of [
		["overall passRate", "passRate"],
		["demo-critical", "demoCriticalPassRate"],
		["work-lineage", "workLineagePassRate"],
		["file-level", "fileLevelPassRate"],
		["hard-negative", "hardNegativePassRate"],
		["applicable rate", "applicableRate"],
		["recall@K (mean)", "recallAtKMean"],
		["latency p95 (ms)", "latencyP95Ms"],
	] as const) {
		const l = latestSummary[key];
		const b = baselineSummary?.[key] ?? null;
		const isPct = key !== "latencyP95Ms" && key !== "recallAtKMean";
		const fmt = (v: number | null) =>
			v === null ? "—" : isPct ? fmtPct(v) : key === "latencyP95Ms" ? `${v.toFixed(0)}` : v.toFixed(3);
		const delta =
			l !== null && b !== null
				? key === "latencyP95Ms"
					? `${(l - b).toFixed(0)}`
					: `${((l - b) * (isPct ? 100 : 1)).toFixed(2)}${isPct ? "pp" : ""}`
				: "—";
		lines.push(`| ${name} | ${fmt(l)} | ${fmt(b)} | ${delta} |`);
	}
	lines.push("");

	if (f.type === "regression" && input.baseline) {
		const latestScores = extractScores(input.latest);
		const baselineScores = extractScores(input.baseline);
		const flipped = findFlippedQueries(latestScores, baselineScores);
		lines.push(`## Flipped queries (passed in baseline, failed in latest): ${flipped.length}`);
		lines.push("");
		const truncated = flipped.slice(0, maxFlipped);
		for (const q of truncated) {
			lines.push(`### \`${q.id}\` (tier=${q.tier ?? "?"}, category=${q.category ?? "?"})`);
			if (q.question) lines.push(`Question: ${q.question}`);
			if (q.expectedSources && q.expectedSources.length > 0) {
				lines.push(`Expected sources: ${q.expectedSources.slice(0, 5).join(", ")}`);
			}
			if (q.retrieved && q.retrieved.length > 0) {
				lines.push("Retrieved (top):");
				const chunks = q.retrieved.slice(0, maxChunksPerQuery);
				for (const c of chunks) {
					const excerpt = (c.excerpt ?? "").replace(/\s+/g, " ").slice(0, maxChunkChars);
					lines.push(
						`  - score=${c.score?.toFixed(3) ?? "?"} type=${c.sourceType ?? "?"} src=${c.source ?? "?"}`,
					);
					if (excerpt) lines.push(`    > ${excerpt}`);
				}
			}
			lines.push("");
		}
		if (flipped.length > truncated.length) {
			lines.push(`(${flipped.length - truncated.length} more flipped queries omitted)`);
			lines.push("");
		}
	}

	if (f.type === "breach") {
		lines.push("## Breach details");
		lines.push(`- gate: ${f.metric}`);
		if (f.floor !== undefined) lines.push(`- floor: ${(f.floor * 100).toFixed(1)}%`);
		if (f.latestValue !== null && f.latestValue !== undefined)
			lines.push(`- actual: ${(f.latestValue * 100).toFixed(1)}%`);
		lines.push("");
	}

	let out = lines.join("\n");
	if (out.length > maxChars) {
		out = `${out.slice(0, maxChars - 200)}\n\n_(output truncated to ${maxChars} chars)_\n`;
	}
	return out;
}
