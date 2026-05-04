/**
 * Gate 3 — seeded positive control.
 *
 * Verifies the autoresearch decideMulti + decide path accepts a known-good
 * retrieval improvement end-to-end. Picks the cleanest available seed:
 * disabling autoRoute (#314 confirmed harmful). Compares ar_div_rrOff
 * (autoRoute=on, baseline) vs noar_div_rrOff (autoRoute=off, candidate)
 * across both corpora in the latest 16-variant sweep.
 *
 * Hard gates are relaxed to per-tier floors that the post-scorer-hygiene
 * sweep can clear; this is intentional. Gate 3 tests harness sensitivity
 * to a real lift, not absolute retrieval health (covered by Phase B).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/381
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtendedDogfoodReport } from "../lib/run-config.js";
import { decide, decideMulti, DEFAULT_GATES, type HardGates } from "./decision.js";

const SWEEP_DIR = join(
	homedir(),
	".wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204",
);

const CORPORA = ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"];
const BASELINE_VARIANT = "ar_div_rrOff";
const CANDIDATE_VARIANT = "noar_div_rrOff";

function loadReport(variant: string, corpus: string): ExtendedDogfoodReport {
	const path = join(SWEEP_DIR, `${variant}__${corpus}.json`);
	return JSON.parse(readFileSync(path, "utf-8")) as ExtendedDogfoodReport;
}

const baseline = new Map<string, ExtendedDogfoodReport>();
const candidate = new Map<string, ExtendedDogfoodReport>();
for (const c of CORPORA) {
	baseline.set(c, loadReport(BASELINE_VARIANT, c));
	candidate.set(c, loadReport(CANDIDATE_VARIANT, c));
}

// Relaxed gates: floors set just below baseline rates so the candidate's
// lift moves it cleanly above. Demonstrates harness sensitivity without
// requiring absolute pass rates that scorer hygiene PRs intentionally
// brought down.
const RELAXED_GATES: HardGates = {
	overallMin: 0.35,
	demoCriticalMin: 0.0,
	workLineageMin: 0.1,
	fileLevelMin: 0.4,
	applicableRateMin: 0.5,
	hardNegativeMin: 0,
	paraphraseInvariantMin: 0,
};

console.log(`# Gate 3 — seeded positive control`);
console.log(`Baseline variant:  ${BASELINE_VARIANT}`);
console.log(`Candidate variant: ${CANDIDATE_VARIANT}`);
console.log(`Sweep:             ${SWEEP_DIR}`);
console.log();

const multi = decideMulti({
	baseline,
	candidate,
	cumulativeLocChange: 1,
	gates: RELAXED_GATES,
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
let allBootstrapPass = true;
for (const corpus of CORPORA) {
	const v = decide({
		baseline: baseline.get(corpus)!,
		candidate: candidate.get(corpus)!,
		gates: RELAXED_GATES,
	});
	console.log(`${corpus}:`);
	console.log(`  accept:           ${v.accept}`);
	console.log(`  meanDelta:        ${v.bootstrap.meanDelta.toFixed(4)}`);
	console.log(`  probBgreaterA:    ${v.bootstrap.probBgreaterA.toFixed(4)}`);
	console.log(`  ci95:             [${v.bootstrap.ciLow.toFixed(4)}, ${v.bootstrap.ciHigh.toFixed(4)}]`);
	console.log(`  reasons:          ${v.reasons.join("; ") || "(none)"}`);
	if (!v.accept || v.bootstrap.probBgreaterA < 0.95) allBootstrapPass = false;
}
console.log();

const ok = multi.accept && allBootstrapPass;
console.log(`## Verdict`);
console.log(ok ? "PASS — harness accepts seeded positive end-to-end" : "FAIL — see reasons");
process.exit(ok ? 0 : 1);
