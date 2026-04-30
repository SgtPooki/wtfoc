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

export const DEFAULT_GATES: HardGates = {
	overallMin: 0.55,
	demoCriticalMin: 1.0,
	workLineageMin: 0.6,
	fileLevelMin: 0.7,
	applicableRateMin: 0.6,
	hardNegativeMin: 0,
	paraphraseInvariantMin: 0.7,
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
}

function qq(report: ExtendedDogfoodReport): QQMetrics | undefined {
	return report.stages.find((s) => s.stage === "quality-queries")?.metrics as QQMetrics | undefined;
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
	const cc = input.candidate.costComparable;
	if (cc && cc.value === false) {
		reasons.push(`costComparable=false (${cc.reasons.join(", ") || "no reasons"})`);
	}

	return {
		accept: reasons.length === 0,
		reasons,
		bootstrap,
		gateResults,
	};
}
