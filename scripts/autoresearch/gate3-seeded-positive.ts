/**
 * Gate 3 — seeded positive control (#381).
 *
 * Verifies the autoresearch decideMulti + decide path accepts a known-good
 * synthetic patch end-to-end. Patch: bump default `TOPK` constant in
 * `quality-queries-evaluator.ts` from 10 → 30 (1 LoC). This is a
 * monotonic retrieval-quality lift — more candidates per query, more
 * chances to satisfy rubric thresholds, cannot reduce pass rate.
 *
 * Baseline: cached main reports from 2026-05-04 16-variant sweep
 * (`~/.wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204/`,
 * git SHA 1ae735f matches main HEAD's pre-squash commit; scorer-hygiene
 * PRs #376/#377/#379 already in effect on baseline).
 *
 * Candidate: fresh dogfood runs on `feat/381-gate3-v2` branch with the
 * patch applied, on the same `noar_div_rrOff` axis settings (autoRoute
 * off, diversity on, no rerank).
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
import { decide, decideMulti, type HardGates } from "./decision.js";

const BASELINE_DIR = join(
	homedir(),
	".wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204",
);

const CANDIDATE_PATHS: Record<string, string> = {
	"filoz-ecosystem-2026-04-v12": "docs/autoresearch/seeded-positives/sp1-candidate-filoz.json",
	"wtfoc-dogfood-2026-04-v3": "docs/autoresearch/seeded-positives/sp1-candidate-dogfood.json",
};

const BASELINE_VARIANT = "noar_div_rrOff";

function loadBaseline(corpus: string): ExtendedDogfoodReport {
	const path = join(BASELINE_DIR, `${BASELINE_VARIANT}__${corpus}.json`);
	return JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
}

function loadCandidate(corpus: string): ExtendedDogfoodReport {
	const path = CANDIDATE_PATHS[corpus];
	if (!path) throw new Error(`No candidate path for corpus ${corpus}`);
	return JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
}

const baseline = new Map<string, ExtendedDogfoodReport>();
const candidate = new Map<string, ExtendedDogfoodReport>();
for (const corpus of Object.keys(CANDIDATE_PATHS)) {
	baseline.set(corpus, loadBaseline(corpus));
	candidate.set(corpus, loadCandidate(corpus));
}

// Bridge gates — calibrated against post-scorer-hygiene empirical pass
// rates from the 2026-05-04 sweep. Floors set just below current
// noar_div_rrOff baseline so a real lift moves candidate cleanly above.
// DEFAULT_GATES (pre-hygiene calibration) are stale; demoCriticalMin=1.0
// is mathematically unreachable on current scorer state. Phase B (#364)
// recalibrates DEFAULT_GATES from empirical reality.
const BRIDGE_GATES: HardGates = {
	overallMin: 0.4,
	// dogfood corpus has no demo-critical queries; evaluateGates emits
	// passRate=0 in that case which would falsely trip a positive floor.
	// Phase B will replace this with a per-corpus tier presence check.
	demoCriticalMin: 0,
	workLineageMin: 0.3,
	fileLevelMin: 0.65,
	applicableRateMin: 0.5,
	hardNegativeMin: 0,
	paraphraseInvariantMin: 0,
};

// Primary corpus — bootstrap probBgreaterA must clear MIN_PROBABILITY (0.95).
// Auxiliary corpora may show directional lift only (small samples produce
// underpowered single-corpus bootstrap; cross-corpus aggregate via
// decideMulti is the spec-binding acceptance signal).
const PRIMARY_CORPUS = "filoz-ecosystem-2026-04-v12";

console.log(`# Gate 3 — seeded positive control (TOPK 10→30)`);
console.log(`Baseline:  ${BASELINE_DIR} (variant ${BASELINE_VARIANT})`);
console.log(`Candidate: ${Object.values(CANDIDATE_PATHS).join(", ")}`);
console.log();

const multi = decideMulti({
	baseline,
	candidate,
	cumulativeLocChange: 1,
	gates: BRIDGE_GATES,
});

console.log(`## decideMulti`);
console.log(`accept:             ${multi.accept}`);
console.log(`trimmedMeanDelta:   ${multi.trimmedMeanDelta.toFixed(4)}`);
console.log(`per-corpus deltas:`);
for (const p of multi.perCorpus) {
	console.log(
		`  ${p.corpusId}: ${p.baselinePassRate.toFixed(3)} → ${p.candidatePassRate.toFixed(3)} (Δ ${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(3)})`,
	);
}
console.log(`reasons (if reject): ${multi.reasons.join("; ") || "(none)"}`);
console.log();

console.log(`## decide (per-corpus bootstrap)`);
let primaryBootstrapPass = false;
let auxiliaryDirectional = true;
for (const corpus of Object.keys(CANDIDATE_PATHS)) {
	const v = decide({
		baseline: baseline.get(corpus)!,
		candidate: candidate.get(corpus)!,
		gates: BRIDGE_GATES,
	});
	const isPrimary = corpus === PRIMARY_CORPUS;
	console.log(`${corpus}${isPrimary ? " [PRIMARY]" : " [auxiliary]"}:`);
	console.log(`  accept:           ${v.accept}`);
	console.log(`  meanDelta:        ${v.bootstrap.meanDelta.toFixed(4)}`);
	console.log(`  probBgreaterA:    ${v.bootstrap.probBgreaterA.toFixed(4)}`);
	console.log(`  ci95:             [${v.bootstrap.ciLow.toFixed(4)}, ${v.bootstrap.ciHigh.toFixed(4)}]`);
	console.log(`  reasons:          ${v.reasons.join("; ") || "(none)"}`);
	if (isPrimary) {
		primaryBootstrapPass = v.accept && v.bootstrap.probBgreaterA >= 0.95;
	} else if (v.bootstrap.meanDelta <= 0) {
		auxiliaryDirectional = false;
	}
}
console.log();

const ok = multi.accept && primaryBootstrapPass && auxiliaryDirectional;
console.log(`## Verdict`);
console.log(ok ? "PASS — harness accepts seeded positive end-to-end" : "FAIL — see reasons");
process.exit(ok ? 0 : 1);
