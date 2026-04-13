import type { DogfoodReport, EvalStageResult } from "@wtfoc/common";

const VERDICT_LABEL: Record<string, string> = {
	pass: "PASS",
	warn: "WARN",
	fail: "FAIL",
};

function verdictColor(verdict: string): string {
	if (verdict === "pass") return "\x1b[32m"; // green
	if (verdict === "warn") return "\x1b[33m"; // yellow
	return "\x1b[31m"; // red
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function fmtMs(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function stageKeyMetrics(stage: EvalStageResult): string {
	const m = stage.metrics as Record<string, unknown>;
	switch (stage.stage) {
		case "ingest":
			return `chunks=${m.totalChunks}, fingerprint=${fmtPct(m.contentFingerprintRate)}, docId=${fmtPct(m.documentIdRate)}`;
		case "edge-extraction":
			return `F1=${fmtNum(m.gatedF1)}, survival=${fmtPct(m.goldSurvivalRate)}, coverage=${fmtPct(m.coverageRate)}`;
		case "edge-resolution":
			return `resolved=${fmtPct(m.resolutionRate)}, cross-source=${fmtPct(m.crossSourceEdgeDensity)}`;
		case "storage":
			return `segments=${m.segmentCount}, chunks=${m.totalChunks}, dangling=${m.derivedLayerDanglingRefs ?? 0}`;
		case "themes":
			return `clusters=${m.clusterCount}, noise=${m.noiseCount}`;
		case "signals":
			return `coverage=${fmtPct(m.signalCoverage)}, scored=${m.chunksWithSignal}/${m.totalChunks}`;
		case "search":
			return `MRR=${fmtNum(m.meanReciprocalRank)}, edge-hop=${fmtPct(m.edgeHopRatio)}, provenance=${fmtPct(m.provenanceQualityRate)}`;
		default:
			return stage.summary;
	}
}

function fmtPct(val: unknown): string {
	if (typeof val !== "number") return "n/a";
	return `${(val * 100).toFixed(0)}%`;
}

function fmtNum(val: unknown): string {
	if (typeof val !== "number") return "n/a";
	return val.toFixed(2);
}

export function formatDogfoodReport(report: DogfoodReport): string {
	const lines: string[] = [];

	const v = VERDICT_LABEL[report.verdict] ?? report.verdict;
	const vc = verdictColor(report.verdict);

	lines.push("");
	lines.push(
		`${BOLD}DOGFOOD REPORT${RESET}  ${report.collectionName}  ${DIM}${report.timestamp}${RESET}`,
	);
	lines.push(
		`${BOLD}Verdict: ${vc}${v}${RESET}  ${DIM}(${fmtMs(report.durationMs)})${RESET}`,
	);
	lines.push("");

	// Stage table
	const header = `  ${"Stage".padEnd(20)} ${"Verdict".padEnd(8)} ${"Time".padEnd(8)} Metrics`;
	lines.push(header);
	lines.push(`  ${"─".repeat(70)}`);

	for (const stage of report.stages) {
		const sv = VERDICT_LABEL[stage.verdict] ?? stage.verdict;
		const sc = verdictColor(stage.verdict);
		const skipped = stage.summary.includes("skipped");

		const stageLabel = stage.stage.padEnd(20);
		const verdictLabel = skipped
			? `${DIM}skipped${RESET} `.padEnd(8 + 9) // account for ANSI codes
			: `${sc}${sv.padEnd(8)}${RESET}`;
		const timeLabel = fmtMs(stage.durationMs).padEnd(8);
		const metrics = skipped ? stage.summary : stageKeyMetrics(stage);

		lines.push(`  ${stageLabel} ${verdictLabel} ${timeLabel} ${DIM}${metrics}${RESET}`);
	}

	lines.push("");
	lines.push(`  ${DIM}Schema: v${report.reportSchemaVersion}${RESET}`);
	lines.push("");

	return lines.join("\n");
}
