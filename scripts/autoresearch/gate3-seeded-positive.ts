/**
 * Gate 3 — seeded positive control (#381).
 *
 * Verifies the autoresearch decideMulti + decide path accepts a known-good
 * synthetic patch end-to-end. Patch: bump default `TOPK` constant in
 * `quality-queries-evaluator.ts` from 10 → 30 (1 LoC).
 *
 * Not strictly monotonic — see hard-negative caveat in
 * docs/autoresearch/seeded-positives.md (SP-1). Empirically positive on
 * the 2026-05-04 corpus state because hard-negatives sit at 0/12 and
 * cannot regress further.
 *
 * Baseline: cached main reports from 2026-05-04 16-variant sweep
 * (`~/.wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204/`,
 * git SHA 1ae735f matches main HEAD's pre-squash commit; scorer-hygiene
 * PRs #376/#377/#379 already in effect on baseline).
 *
 * Candidate: fresh dogfood runs on `feat/381-gate3-v2` branch with the
 * patch applied, on the same `noar_div_rrOff` axis settings (autoRoute
 * off, diversity on, no rerank). Committed under
 * docs/autoresearch/seeded-positives/ for reproducibility.
 *
 * Hard gates: BRIDGE_GATES — relaxed against post-hygiene empirical pass
 * rates pending Phase B (#364) recalibration of DEFAULT_GATES. Gate 3
 * tests harness sensitivity to a real lift, not absolute retrieval
 * health. Phase B will re-run SP-1 with calibrated DEFAULT_GATES as
 * part of #364 acceptance.
 *
 * @see docs/autoresearch/seeded-positives.md
 * @see https://github.com/SgtPooki/wtfoc/issues/381
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import {
	decide,
	decideMulti,
	DEFAULT_GATES,
	type DecideMultiVerdict,
	type DecisionVerdict,
	type HardGates,
} from "./decision.js";

const BASELINE_DIR = join(
	homedir(),
	".wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204",
);

export const SP1_CANDIDATE_PATHS: Record<string, string> = {
	"filoz-ecosystem-2026-04-v12": "docs/autoresearch/seeded-positives/sp1-candidate-filoz.json",
	"wtfoc-dogfood-2026-04-v3": "docs/autoresearch/seeded-positives/sp1-candidate-dogfood.json",
};

const BASELINE_VARIANT = "noar_div_rrOff";

// SP-1 runs against `DEFAULT_GATES` directly. The recalibrated DEFAULT_GATES
// (#364, 2026-05-04) are now equivalent to what SP-1's original bridge gates
// were — peer-review consensus that floors should match post-hygiene
// empirical rates. Re-exported as `BRIDGE_GATES` for the test suite's
// regression name; alias only, no semantic difference from `DEFAULT_GATES`.
export const BRIDGE_GATES: HardGates = DEFAULT_GATES;

// Primary corpus — bootstrap probBgreaterA must clear MIN_PROBABILITY (0.95).
// Auxiliary corpora may show directional lift only (small samples produce
// underpowered single-corpus bootstrap; cross-corpus aggregate via
// decideMulti is the spec-binding acceptance signal).
export const PRIMARY_CORPUS = "filoz-ecosystem-2026-04-v12";

export interface Sp1Verification {
	multi: DecideMultiVerdict;
	perCorpus: Array<{ corpusId: string; isPrimary: boolean; verdict: DecisionVerdict }>;
	primaryBootstrapPass: boolean;
	auxiliaryDirectional: boolean;
	accept: boolean;
}

/**
 * Pure verification logic. Takes already-loaded reports + gates so
 * tests can swap in synthetic data instead of reading from disk.
 */
export function verifySp1(input: {
	baseline: ReadonlyMap<string, ExtendedDogfoodReport>;
	candidate: ReadonlyMap<string, ExtendedDogfoodReport>;
	gates: HardGates;
	primaryCorpus: string;
}): Sp1Verification {
	const multi = decideMulti({
		baseline: input.baseline,
		candidate: input.candidate,
		cumulativeLocChange: 1,
		gates: input.gates,
	});

	const perCorpus: Sp1Verification["perCorpus"] = [];
	let primaryBootstrapPass = false;
	let auxiliaryDirectional = true;
	for (const corpusId of input.candidate.keys()) {
		const verdict = decide({
			baseline: input.baseline.get(corpusId)!,
			candidate: input.candidate.get(corpusId)!,
			gates: input.gates,
		});
		const isPrimary = corpusId === input.primaryCorpus;
		perCorpus.push({ corpusId, isPrimary, verdict });
		if (isPrimary) {
			primaryBootstrapPass = verdict.accept && verdict.bootstrap.probBgreaterA >= 0.95;
		} else if (verdict.bootstrap.meanDelta <= 0) {
			auxiliaryDirectional = false;
		}
	}

	return {
		multi,
		perCorpus,
		primaryBootstrapPass,
		auxiliaryDirectional,
		accept: multi.accept && primaryBootstrapPass && auxiliaryDirectional,
	};
}

function loadBaseline(corpus: string): ExtendedDogfoodReport {
	const path = join(BASELINE_DIR, `${BASELINE_VARIANT}__${corpus}.json`);
	return JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
}

function loadCandidate(corpus: string): ExtendedDogfoodReport {
	const path = SP1_CANDIDATE_PATHS[corpus];
	if (!path) throw new Error(`No candidate path for corpus ${corpus}`);
	return JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
}

function main(): void {
	const baseline = new Map<string, ExtendedDogfoodReport>();
	const candidate = new Map<string, ExtendedDogfoodReport>();
	for (const corpus of Object.keys(SP1_CANDIDATE_PATHS)) {
		baseline.set(corpus, loadBaseline(corpus));
		candidate.set(corpus, loadCandidate(corpus));
	}

	console.log(`# Gate 3 — seeded positive control (TOPK 10→30)`);
	console.log(`Baseline:  ${BASELINE_DIR} (variant ${BASELINE_VARIANT})`);
	console.log(`Candidate: ${Object.values(SP1_CANDIDATE_PATHS).join(", ")}`);
	console.log();

	const result = verifySp1({
		baseline,
		candidate,
		gates: BRIDGE_GATES,
		primaryCorpus: PRIMARY_CORPUS,
	});

	console.log(`## decideMulti`);
	console.log(`accept:             ${result.multi.accept}`);
	console.log(`trimmedMeanDelta:   ${result.multi.trimmedMeanDelta.toFixed(4)}`);
	console.log(`per-corpus deltas:`);
	for (const p of result.multi.perCorpus) {
		console.log(
			`  ${p.corpusId}: ${p.baselinePassRate.toFixed(3)} → ${p.candidatePassRate.toFixed(3)} (Δ ${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(3)})`,
		);
	}
	console.log(`reasons (if reject): ${result.multi.reasons.join("; ") || "(none)"}`);
	console.log();

	console.log(`## decide (per-corpus bootstrap)`);
	for (const { corpusId, isPrimary, verdict } of result.perCorpus) {
		console.log(`${corpusId}${isPrimary ? " [PRIMARY]" : " [auxiliary]"}:`);
		console.log(`  accept:           ${verdict.accept}`);
		console.log(`  meanDelta:        ${verdict.bootstrap.meanDelta.toFixed(4)}`);
		console.log(`  probBgreaterA:    ${verdict.bootstrap.probBgreaterA.toFixed(4)}`);
		console.log(
			`  ci95:             [${verdict.bootstrap.ciLow.toFixed(4)}, ${verdict.bootstrap.ciHigh.toFixed(4)}]`,
		);
		console.log(`  reasons:          ${verdict.reasons.join("; ") || "(none)"}`);
	}
	console.log();

	console.log(`## Verdict`);
	console.log(
		result.accept
			? "PASS — harness accepts seeded positive end-to-end"
			: "FAIL — see reasons",
	);
	process.exit(result.accept ? 0 : 1);
}

// Only run main when invoked directly. Lets the module be imported by
// tests without triggering disk reads + process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
