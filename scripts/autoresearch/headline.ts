/**
 * Headline scalar + hard gates for sweep ranking. Maintainer-only.
 *
 * # Headline scalar
 *
 * Defined in #311 (peer-review consensus):
 *
 *   headline = sqrt(portable_v12_pass_rate × portable_v3_pass_rate)
 *
 * Anchors on the cross-corpus generalization signal. The portable
 * tier is the only tier present on BOTH corpora (filoz-ecosystem-v12
 * + wtfoc-dogfood-v3), so a variant that improves on both is
 * generalizing rather than overfitting to v12. Geo-mean penalises
 * any variant that sacrifices one corpus for the other.
 *
 * Single-corpus mode (only one report supplied): returns
 * `portable_v12_pass_rate` directly. Surfaces with `singleCorpus:
 * true` so the leaderboard can flag the missing cross-corpus check.
 *
 * # Hard gates
 *
 * Reviewer (peer-review on #311) explicitly required hard-gating
 * separate from the blended scalar:
 *   - demo-critical 100%
 *   - work-lineage threshold (re-baselined 60% v1.9.0)
 *   - file-level threshold (70%)
 *   - applicability rate (>= 60%)
 *   - paraphrase invariance (>= 70% when checked)
 *   - hard-negative pass-rate floor
 *
 * `Headline` reports the scalar AND the gate verdicts. A variant
 * accepted in the leaderboard must improve the scalar AND pass every
 * gate; the leaderboard prints both the score and the gate state.
 */

import { DEFAULT_GATES, type HardGates } from "./decision.js";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";

interface QQMetrics {
	passRate?: number;
	applicableRate?: number;
	tierBreakdown?: { "demo-critical"?: { passRate?: number } };
	categoryBreakdown?: Record<string, { passRate?: number }>;
	portabilityBreakdown?: { portable?: { passRate?: number } };
	paraphraseInvariance?: { invariantFraction?: number; checked?: boolean };
}

function qq(report: ExtendedDogfoodReport): QQMetrics | undefined {
	return report.stages.find((s) => s.stage === "quality-queries")?.metrics as QQMetrics | undefined;
}

export interface Headline {
	/** sqrt(portable_v12 × portable_v3) when both supplied; else portable_v12. */
	scalar: number;
	/** Whether the scalar was computed on a single corpus only. */
	singleCorpus: boolean;
	/** Component pass-rates feeding the scalar. */
	portableV12: number;
	portableV3: number | null;
	/** Per-gate verdicts on the v12 report. */
	gates: Array<{ name: string; ok: boolean; actual: number; floor: number }>;
	/** True iff every gate passed. */
	allGatesPassed: boolean;
}

export function computeHeadline(input: {
	v12: ExtendedDogfoodReport;
	v3?: ExtendedDogfoodReport;
	gates?: HardGates;
}): Headline {
	const gates = input.gates ?? DEFAULT_GATES;
	const v12Metrics = qq(input.v12);
	const portableV12 = v12Metrics?.portabilityBreakdown?.portable?.passRate ?? 0;
	const v3Metrics = input.v3 ? qq(input.v3) : undefined;
	const portableV3 = v3Metrics?.portabilityBreakdown?.portable?.passRate ?? null;

	const scalar =
		portableV3 !== null ? Math.sqrt(portableV12 * portableV3) : portableV12;

	const gateRows: Headline["gates"] = [];
	const push = (name: string, actual: number | null | undefined, floor: number) => {
		const a = actual ?? 0;
		gateRows.push({ name, ok: a >= floor, actual: a, floor });
	};
	push("overall", v12Metrics?.passRate, gates.overallMin);
	push("applicableRate", v12Metrics?.applicableRate, gates.applicableRateMin);
	push(
		"demoCritical",
		v12Metrics?.tierBreakdown?.["demo-critical"]?.passRate,
		gates.demoCriticalMin,
	);
	push("workLineage", v12Metrics?.categoryBreakdown?.["work-lineage"]?.passRate, gates.workLineageMin);
	push("fileLevel", v12Metrics?.categoryBreakdown?.["file-level"]?.passRate, gates.fileLevelMin);
	push(
		"hardNegative",
		v12Metrics?.categoryBreakdown?.["hard-negative"]?.passRate,
		gates.hardNegativeMin,
	);
	if (v12Metrics?.paraphraseInvariance?.checked) {
		push(
			"paraphraseInvariant",
			v12Metrics.paraphraseInvariance.invariantFraction,
			gates.paraphraseInvariantMin,
		);
	}

	return {
		scalar,
		singleCorpus: portableV3 === null,
		portableV12,
		portableV3,
		gates: gateRows,
		allGatesPassed: gateRows.every((g) => g.ok),
	};
}
