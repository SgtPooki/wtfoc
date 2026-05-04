/**
 * Variant decision rule for the autoresearch sweep harness.
 * Maintainer-only.
 *
 * Combines paired-bootstrap CIs with the hard threshold gates
 * documented in `scripts/dogfood-check-thresholds.ts` and the headline
 * scalar (Phase 2e) into a single accept/reject verdict per variant.
 *
 * Decision rule (peer-review consensus on #311):
 *   ACCEPT iff
 *     probBgreaterA >= 0.95
 *     AND meanDelta >= MIN_LIFT (0.04 = 4 percentage points)
 *     AND no hard gate broken
 *     AND costComparable === true (when ranking on cost)
 *
 * Otherwise REJECT, and the reasons array tells the maintainer why.
 *
 * Phase 2 ships this as TOOLING ONLY — no auto-promotion. The sweep
 * harness prints the verdict; a maintainer then decides whether to
 * land the new defaults.
 */

import { buildFamilyResults, pairedBootstrap } from "../lib/paired-bootstrap.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";

export const MIN_LIFT = 0.04;
export const MIN_PROBABILITY = 0.95;

/**
 * #344 step 4 — multi-corpus decision rule.
 *
 * Replaces the legacy `sqrt(portable_v12 × portable_v3)` headline for accept/
 * reject gating. Aggregate is a trimmed-mean of per-corpus pass-rate deltas;
 * per-corpus and per-query-type floors prevent a single-corpus collapse from
 * being averaged away; catastrophic-loss veto auto-rejects any corpus drop
 * past `catastrophicFloor`; minMeaningfulLoC blocks zombie no-op patches.
 *
 * Drop geometric mean from gates. `headline.ts` may still emit it for
 * legacy report compatibility, but the loop's accept decision lives here.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */
export const DEFAULT_TRIM_FRACTION = 0.1;
export const DEFAULT_MUST_PASS_FLOOR = 0.03;
export const DEFAULT_TYPE_FLOOR = 0.05;
export const DEFAULT_CATASTROPHIC_FLOOR = 0.3;
export const DEFAULT_MIN_MEANINGFUL_LOC = 1;
/**
 * Latency floors (#364). Calibrated against 2026-05-04 production-variant
 * baseline (`noar_div_rrOff` filoz): per-query-total p95 ~3000-4300ms across
 * cached runs (32% run-to-run variance). Defaults reject patches with p95
 * regressions large enough to matter on top of that variance.
 */
export const DEFAULT_P95_FLOOR_MS = 1500; // candidate p95 may exceed baseline by at most 1500ms
export const DEFAULT_TOTAL_P95_FLOOR_MS = 10_000; // absolute ceiling regardless of baseline
export const DEFAULT_CATASTROPHIC_LATENCY_FACTOR = 2.0; // candidate.p95 > 2× baseline.p95 → auto-reject

/**
 * Phase-B activation flag (#364). When `true`, latency floor breaches add
 * to `reasons` and reject the candidate. When `false`, breaches surface in
 * the warn-only `latencyWarnings` field on the verdict.
 *
 * Calibrated 2026-05-04 via `scripts/autoresearch/calibrate-latency-floors.ts`
 * against the cached 16-variant sweep. Reranker-on variants (`_rrBge`)
 * trigger catastrophic-latency veto (p95 ~14000ms vs baseline ~4250ms);
 * non-rerank variants stay within tolerance (deltas <300ms). Floors
 * empirically catch real regressions without false alarms — flipped to
 * hard-fail per peer-review pre-commit (codex+cursor+gemini, 2026-05-04).
 */
export const DEFAULT_LATENCY_GATE_HARD = true;

export interface PerCorpusFloors {
	/** Maximum tolerated delta drop on a must-pass corpus (default 3pp). */
	mustPassFloor?: number;
	/** Maximum tolerated delta drop on any query-type aggregate (default 5pp). */
	typeFloor?: number;
	/** Single-corpus drop that auto-rejects regardless of mean (default 30pp). */
	catastrophicFloor?: number;
	/** Trimming fraction for the per-corpus delta aggregate (default 10%). */
	trimFraction?: number;
	/** Minimum cumulative LOC change to consider non-no-op (default 1). */
	minMeaningfulLoC?: number;
	/** Minimum trimmed-mean delta to accept (default `MIN_LIFT`). */
	minLift?: number;
	/**
	 * Latency floors (#364). Read from `metrics.timing["per-query-total"]`.
	 * When timing data is missing on either side, latency gating is skipped
	 * for that corpus (reported as `latencyWarnings` entry). Defaults from
	 * `DEFAULT_P95_FLOOR_MS`, `DEFAULT_TOTAL_P95_FLOOR_MS`,
	 * `DEFAULT_CATASTROPHIC_LATENCY_FACTOR`.
	 */
	p95FloorMs?: number;
	totalP95FloorMs?: number;
	catastrophicLatencyFactor?: number;
	/**
	 * When false (default), latency breaches go to `latencyWarnings` only and
	 * do not reject the candidate. When true, breaches add to `reasons` and
	 * cause `accept: false`. Phase B / #364 ships warn-only and flips to
	 * hard-fail after one calibration cycle.
	 */
	latencyGateHard?: boolean;
}

export interface DecideMultiInputs {
	/** Baseline reports keyed by corpus id. */
	baseline: ReadonlyMap<string, ExtendedDogfoodReport>;
	/** Candidate reports keyed by corpus id. */
	candidate: ReadonlyMap<string, ExtendedDogfoodReport>;
	/**
	 * Corpora that must each clear `mustPassFloor`. When unset, every corpus
	 * present in both baseline and candidate is treated as must-pass.
	 */
	mustPassCorpora?: ReadonlyArray<string>;
	/** Optional per-corpus floor overrides; values take precedence over defaults. */
	perCorpusFloorOverrides?: ReadonlyMap<string, number>;
	/**
	 * Cumulative LOC change for the candidate patch. Required — passing
	 * `undefined` is a schema error (caller did not measure the patch). Pass
	 * `0` explicitly for a no-op patch and the LoC veto will reject it.
	 */
	cumulativeLocChange: number;
	/** Floors + thresholds; falls back to defaults. */
	floors?: PerCorpusFloors;
	/** Hard gates applied per-corpus on the candidate report. */
	gates?: HardGates;
}

export interface PerCorpusDelta {
	corpusId: string;
	baselinePassRate: number;
	candidatePassRate: number;
	delta: number;
	gateResults: DecisionVerdict["gateResults"];
	/**
	 * Latency telemetry (#364). `null` for either field when timing data is
	 * missing on the corresponding report.
	 */
	baselineP95Ms: number | null;
	candidateP95Ms: number | null;
}

export interface DecideMultiVerdict {
	accept: boolean;
	reasons: string[];
	/**
	 * Latency-floor warnings emitted when `latencyGateHard` is false (#364).
	 * Same content shape as a `reasons` entry; surfaced separately so the
	 * calibration-cycle harness can observe regressions without rejecting.
	 */
	latencyWarnings: string[];
	perCorpus: PerCorpusDelta[];
	trimmedMeanDelta: number;
	mustPassCorpora: string[];
	queryTypeDeltas: Array<{ queryType: string; delta: number }>;
	cumulativeLocChange: number;
}

/**
 * Trimmed mean: drop the highest and lowest `fraction` of values then average
 * the rest. With `fraction = 0` returns the arithmetic mean. With one value,
 * returns that value (trim degenerates).
 */
export function trimmedMean(values: ReadonlyArray<number>, fraction: number): number {
	if (values.length === 0) return 0;
	if (values.length === 1) return values[0] ?? 0;
	const sorted = [...values].sort((a, b) => a - b);
	const drop = Math.floor(sorted.length * Math.max(0, Math.min(0.49, fraction)));
	const sliced = sorted.slice(drop, sorted.length - drop);
	if (sliced.length === 0) return 0;
	const sum = sliced.reduce((a, b) => a + b, 0);
	return sum / sliced.length;
}

function aggregateQueryTypeDeltas(
	baseline: ReadonlyMap<string, ExtendedDogfoodReport>,
	candidate: ReadonlyMap<string, ExtendedDogfoodReport>,
): Array<{ queryType: string; delta: number }> {
	const types = new Set<string>();
	const baseTotals = new Map<string, { sum: number; n: number }>();
	const candTotals = new Map<string, { sum: number; n: number }>();
	for (const [, rep] of baseline) {
		const m = qq(rep);
		const cb = m?.categoryBreakdown ?? {};
		for (const [t, v] of Object.entries(cb)) {
			types.add(t);
			const cur = baseTotals.get(t) ?? { sum: 0, n: 0 };
			cur.sum += v?.passRate ?? 0;
			cur.n += 1;
			baseTotals.set(t, cur);
		}
	}
	for (const [, rep] of candidate) {
		const m = qq(rep);
		const cb = m?.categoryBreakdown ?? {};
		for (const [t, v] of Object.entries(cb)) {
			types.add(t);
			const cur = candTotals.get(t) ?? { sum: 0, n: 0 };
			cur.sum += v?.passRate ?? 0;
			cur.n += 1;
			candTotals.set(t, cur);
		}
	}
	const out: Array<{ queryType: string; delta: number }> = [];
	for (const t of types) {
		const b = baseTotals.get(t);
		const c = candTotals.get(t);
		if (!b || !c || b.n === 0 || c.n === 0) continue;
		out.push({ queryType: t, delta: c.sum / c.n - b.sum / b.n });
	}
	return out.sort((a, b) => a.queryType.localeCompare(b.queryType));
}

export function decideMulti(input: DecideMultiInputs): DecideMultiVerdict {
	const floors = input.floors ?? {};
	const trim = floors.trimFraction ?? DEFAULT_TRIM_FRACTION;
	const minLift = floors.minLift ?? MIN_LIFT;
	const mustPassFloor = floors.mustPassFloor ?? DEFAULT_MUST_PASS_FLOOR;
	const typeFloor = floors.typeFloor ?? DEFAULT_TYPE_FLOOR;
	const catastrophicFloor = floors.catastrophicFloor ?? DEFAULT_CATASTROPHIC_FLOOR;
	const minLoc = floors.minMeaningfulLoC ?? DEFAULT_MIN_MEANINGFUL_LOC;
	const p95FloorMs = floors.p95FloorMs ?? DEFAULT_P95_FLOOR_MS;
	const totalP95FloorMs = floors.totalP95FloorMs ?? DEFAULT_TOTAL_P95_FLOOR_MS;
	const catastrophicLatencyFactor =
		floors.catastrophicLatencyFactor ?? DEFAULT_CATASTROPHIC_LATENCY_FACTOR;
	const latencyGateHard = floors.latencyGateHard ?? DEFAULT_LATENCY_GATE_HARD;
	const gates = input.gates ?? DEFAULT_GATES;

	const sharedCorpora = Array.from(input.baseline.keys()).filter((k) =>
		input.candidate.has(k),
	);
	const mustPass = input.mustPassCorpora ?? sharedCorpora;

	const perCorpus: PerCorpusDelta[] = [];
	for (const corpusId of sharedCorpora) {
		const b = input.baseline.get(corpusId);
		const c = input.candidate.get(corpusId);
		if (!b || !c) continue;
		const bm = qq(b);
		const cm = qq(c);
		const baselinePassRate = bm?.passRate ?? 0;
		const candidatePassRate = cm?.passRate ?? 0;
		perCorpus.push({
			corpusId,
			baselinePassRate,
			candidatePassRate,
			delta: candidatePassRate - baselinePassRate,
			gateResults: evaluateGates(c, gates),
			baselineP95Ms: extractPerQueryP95Ms(b),
			candidateP95Ms: extractPerQueryP95Ms(c),
		});
	}

	const reasons: string[] = [];
	const latencyWarnings: string[] = [];
	const sink = (msg: string) => {
		if (latencyGateHard) reasons.push(msg);
		else latencyWarnings.push(msg);
	};

	if (perCorpus.length === 0) {
		reasons.push("no shared corpora between baseline and candidate");
	}

	const deltas = perCorpus.map((p) => p.delta);
	const aggregate = trimmedMean(deltas, trim);
	if (aggregate < minLift) {
		reasons.push(
			`trimmed-mean delta ${aggregate.toFixed(3)} < minLift ${minLift} (per-corpus deltas: ${deltas.map((d) => d.toFixed(3)).join(", ")})`,
		);
	}

	for (const corpusId of mustPass) {
		const entry = perCorpus.find((p) => p.corpusId === corpusId);
		if (!entry) {
			reasons.push(`must-pass corpus "${corpusId}" missing from baseline+candidate`);
			continue;
		}
		const floor = input.perCorpusFloorOverrides?.get(corpusId) ?? mustPassFloor;
		if (entry.delta < -floor) {
			reasons.push(
				`must-pass corpus "${corpusId}" delta ${entry.delta.toFixed(3)} below floor -${floor}`,
			);
		}
	}

	for (const entry of perCorpus) {
		if (-entry.delta > catastrophicFloor) {
			reasons.push(
				`catastrophic loss on "${entry.corpusId}": drop ${(-entry.delta).toFixed(3)} > catastrophicFloor ${catastrophicFloor}`,
			);
		}
		for (const g of entry.gateResults) {
			if (!g.ok) {
				reasons.push(
					`hard gate "${g.name}" failed on "${entry.corpusId}": ${(g.actual * 100).toFixed(1)}% < ${(g.floor * 100).toFixed(1)}%`,
				);
			}
		}
	}

	const queryTypeDeltas = aggregateQueryTypeDeltas(input.baseline, input.candidate);
	for (const t of queryTypeDeltas) {
		if (t.delta < -typeFloor) {
			reasons.push(
				`query-type "${t.queryType}" regressed: delta ${t.delta.toFixed(3)} < -typeFloor ${typeFloor}`,
			);
		}
	}

	const cumulativeLocChange = input.cumulativeLocChange;
	if (cumulativeLocChange < minLoc) {
		reasons.push(
			`cumulative LOC change ${cumulativeLocChange} < minMeaningfulLoC ${minLoc} — likely no-op`,
		);
	}

	// Latency gates (#364). Per-corpus checks against per-query-total p95.
	for (const entry of perCorpus) {
		const { corpusId, baselineP95Ms, candidateP95Ms } = entry;
		if (baselineP95Ms === null || candidateP95Ms === null) {
			latencyWarnings.push(
				`corpus "${corpusId}" missing per-query-total timing — latency gates skipped`,
			);
			continue;
		}
		// Catastrophic-latency veto: candidate p95 > factor × baseline p95.
		if (candidateP95Ms > baselineP95Ms * catastrophicLatencyFactor) {
			sink(
				`catastrophic latency on "${corpusId}": candidate p95 ${candidateP95Ms}ms > ${catastrophicLatencyFactor}× baseline ${baselineP95Ms}ms`,
			);
		} else if (candidateP95Ms - baselineP95Ms > p95FloorMs) {
			sink(
				`p95 regression on "${corpusId}": candidate ${candidateP95Ms}ms − baseline ${baselineP95Ms}ms = ${candidateP95Ms - baselineP95Ms}ms > p95FloorMs ${p95FloorMs}`,
			);
		}
		if (candidateP95Ms > totalP95FloorMs) {
			sink(
				`absolute p95 ceiling on "${corpusId}": candidate ${candidateP95Ms}ms > totalP95FloorMs ${totalP95FloorMs}`,
			);
		}
	}

	return {
		accept: reasons.length === 0,
		reasons,
		latencyWarnings,
		perCorpus,
		trimmedMeanDelta: aggregate,
		mustPassCorpora: [...mustPass],
		queryTypeDeltas,
		cumulativeLocChange: cumulativeLocChange,
	};
}

/** Hard gates that must hold regardless of bootstrap signal. */
export interface HardGates {
	overallMin: number;
	demoCriticalMin: number;
	workLineageMin: number;
	fileLevelMin: number;
	applicableRateMin: number;
	hardNegativeMin: number;
	paraphraseInvariantMin: number;
}

/**
 * Hard-gate floors calibrated against post-scorer-hygiene empirical pass rates
 * on the production variant (`noar_div_rrOff`) from the 2026-05-04 16-variant
 * sweep. Pre-hygiene values (overallMin: 0.55, demoCriticalMin: 1.0, etc.)
 * were unreachable after PRs #376/#377/#379 tightened the evidence gates.
 *
 * Floors are set just below current baseline so an honest small-to-medium
 * lift moves a candidate cleanly above. Phase B / #364 will re-tighten as
 * retrieval improvements lift the underlying pass rates back up.
 *
 * `demoCriticalMin: 0` because (a) the production filoz baseline only passes
 * 1/3 demo-critical queries, and (b) the secondary `wtfoc-dogfood` corpus has
 * zero demo-critical queries (passRate defaults to 0 and would falsely trip
 * a positive floor on every candidate). A per-corpus tier-presence check is
 * tracked under #364.
 */
export const DEFAULT_GATES: HardGates = {
	overallMin: 0.4,
	demoCriticalMin: 0,
	workLineageMin: 0.3,
	fileLevelMin: 0.65,
	applicableRateMin: 0.5,
	hardNegativeMin: 0,
	paraphraseInvariantMin: 0,
};

export interface DecisionInputs {
	baseline: ExtendedDogfoodReport;
	candidate: ExtendedDogfoodReport;
	gates?: HardGates;
	bootstrapIterations?: number;
	rng?: () => number;
}

export interface DecisionVerdict {
	accept: boolean;
	reasons: string[];
	bootstrap: {
		meanDelta: number;
		ciLow: number;
		ciHigh: number;
		probBgreaterA: number;
		familyCount: number;
	};
	gateResults: Array<{ name: string; ok: boolean; actual: number; floor: number }>;
}

interface QQMetrics {
	passRate?: number;
	applicableRate?: number;
	tierBreakdown?: { "demo-critical"?: { passRate?: number } };
	categoryBreakdown?: Record<string, { passRate?: number }>;
	paraphraseInvariance?: { invariantFraction?: number; checked?: boolean };
	scores?: Array<{ id: string; passed: boolean; skipped?: boolean }>;
	timing?: Record<string, { p50Ms?: number; p95Ms?: number }>;
}

function qq(report: ExtendedDogfoodReport): QQMetrics | undefined {
	return report.stages.find((s) => s.stage === "quality-queries")?.metrics as QQMetrics | undefined;
}

/**
 * Read per-query-total p95 from `metrics.timing` (#364 — SubstageTimer
 * already records this in every quality-queries stage). Returns null when
 * timing is absent so latency gates can skip rather than treat missing
 * data as 0.
 */
function extractPerQueryP95Ms(report: ExtendedDogfoodReport): number | null {
	const m = qq(report);
	const v = m?.timing?.["per-query-total"]?.p95Ms;
	return typeof v === "number" ? v : null;
}

export function evaluateGates(
	candidate: ExtendedDogfoodReport,
	gates: HardGates,
): DecisionVerdict["gateResults"] {
	const m = qq(candidate);
	const out: DecisionVerdict["gateResults"] = [];
	const push = (name: string, actual: number | null | undefined, floor: number) => {
		const a = actual ?? 0;
		out.push({ name, actual: a, floor, ok: a >= floor });
	};
	push("overall", m?.passRate, gates.overallMin);
	push("applicableRate", m?.applicableRate, gates.applicableRateMin);
	push(
		"demoCritical",
		m?.tierBreakdown?.["demo-critical"]?.passRate,
		gates.demoCriticalMin,
	);
	push("workLineage", m?.categoryBreakdown?.["work-lineage"]?.passRate, gates.workLineageMin);
	push("fileLevel", m?.categoryBreakdown?.["file-level"]?.passRate, gates.fileLevelMin);
	push(
		"hardNegative",
		m?.categoryBreakdown?.["hard-negative"]?.passRate,
		gates.hardNegativeMin,
	);
	if (m?.paraphraseInvariance?.checked) {
		push(
			"paraphraseInvariant",
			m.paraphraseInvariance.invariantFraction,
			gates.paraphraseInvariantMin,
		);
	}
	return out;
}

export function decide(input: DecisionInputs): DecisionVerdict {
	const gates = input.gates ?? DEFAULT_GATES;
	const baseline = qq(input.baseline);
	const candidate = qq(input.candidate);
	const baseScores = baseline?.scores ?? [];
	const candScores = candidate?.scores ?? [];
	const families = buildFamilyResults(baseScores, candScores);
	const bootstrap = pairedBootstrap(families, {
		iterations: input.bootstrapIterations ?? 10000,
		rng: input.rng,
	});
	const gateResults = evaluateGates(input.candidate, gates);

	const reasons: string[] = [];
	if (bootstrap.familyCount === 0) {
		reasons.push("no aligned QueryScore families to compare (baseline + candidate disjoint)");
	}
	if (bootstrap.probBgreaterA < MIN_PROBABILITY) {
		reasons.push(
			`probBgreaterA ${bootstrap.probBgreaterA.toFixed(3)} < ${MIN_PROBABILITY} — not enough confidence`,
		);
	}
	if (bootstrap.meanDelta < MIN_LIFT) {
		reasons.push(
			`meanDelta ${bootstrap.meanDelta.toFixed(3)} < ${MIN_LIFT} — lift below threshold`,
		);
	}
	for (const g of gateResults) {
		if (!g.ok) {
			reasons.push(
				`hard gate "${g.name}" failed: ${(g.actual * 100).toFixed(1)}% < ${(g.floor * 100).toFixed(1)}%`,
			);
		}
	}
	// TODO(#331): cost-comparable gate disabled while autonomous loop runs
	// on local LLM ($0 by definition). Re-enable when paid-LLM proposals
	// become a thing. Keep the type + payload so we don't lose the data.
	// const cc = input.candidate.costComparable;
	// if (cc && cc.value === false) {
	// 	reasons.push(`costComparable=false (${cc.reasons.join(", ") || "no reasons"})`);
	// }

	return {
		accept: reasons.length === 0,
		reasons,
		bootstrap,
		gateResults,
	};
}
