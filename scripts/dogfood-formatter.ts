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
			return `resolved=${fmtPct(m.resolutionRate)}, in-scope=${fmtPct(m.inScopeResolutionRate)}, cross-source=${fmtPct(m.crossSourceEdgeDensity)}`;
		case "storage":
			return `segments=${m.segmentCount}, chunks=${m.totalChunks}, dangling=${m.derivedLayerDanglingRefs ?? 0}`;
		case "themes":
			return `clusters=${m.clusterCount}, noise=${m.noiseCount}`;
		case "signals":
			return `coverage=${fmtPct(m.signalCoverage)}, scored=${m.chunksWithSignal}/${m.totalChunks}`;
		case "search":
			return `MRR=${fmtNum(m.meanReciprocalRank)}, edge-hop=${fmtPct(m.edgeHopRatio)}, provenance=${fmtPct(m.provenanceQualityRate)}`;
		case "quality-queries":
			return `pass-rate=${fmtPct(m.passRate)} (query-only=${fmtPct(m.queryOnlyPassRate)}), passed=${m.passCount}/${m.totalQueries}`;
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

	// Lineage trace quality breakdown (#217) — shown when search or
	// quality-queries emitted aggregate lineage metrics.
	for (const stageName of ["search", "quality-queries"] as const) {
		const stage = report.stages.find((s) => s.stage === stageName);
		const lineage = stage?.metrics.lineage as
			| {
					traceCount: number;
					avgChainCoverageRate: number;
					avgMultiHopChainCount: number;
					avgCrossSourceChainRate: number;
					avgTimestampCoverageRate: number;
					avgChainDiversity: number;
					primaryArtifactRate: number;
					timelineMonotonicRate: number | null;
					timelineMonotonicCandidateCount: number;
					totalCandidateFixes: number;
					totalRecommendedNextReads: number;
			  }
			| undefined;
		if (!lineage || lineage.traceCount === 0) continue;
		const monotonicDisplay =
			lineage.timelineMonotonicRate === null
				? "n/a"
				: `${fmtPct(lineage.timelineMonotonicRate)} (${lineage.timelineMonotonicCandidateCount} traces)`;
		lines.push("");
		lines.push(`  ${BOLD}Lineage trace quality (${stageName})${RESET}`);
		lines.push(
			`    chain-coverage=${fmtPct(lineage.avgChainCoverageRate)}  multi-hop/trace=${fmtNum(lineage.avgMultiHopChainCount)}  cross-source-chains=${fmtPct(lineage.avgCrossSourceChainRate)}`,
		);
		lines.push(
			`    primary-artifact=${fmtPct(lineage.primaryArtifactRate)}  candidate-fixes=${lineage.totalCandidateFixes}  next-reads=${lineage.totalRecommendedNextReads}`,
		);
		lines.push(
			`    timestamps=${fmtPct(lineage.avgTimestampCoverageRate)}  monotonic=${monotonicDisplay}  avg-diversity=${fmtNum(lineage.avgChainDiversity)}`,
		);
	}

	// Per-source-type breakdown for edge-resolution stage
	const resolutionStage = report.stages.find((s) => s.stage === "edge-resolution");
	if (resolutionStage) {
		const breakdown = resolutionStage.metrics.perSourceTypeBreakdown as
			| Record<string, { total: number; resolved: number; resolutionRate: number }>
			| undefined;
		if (breakdown && Object.keys(breakdown).length > 0) {
			lines.push("");
			lines.push(`  ${BOLD}Edge resolution by source type${RESET}`);
			const sorted = Object.entries(breakdown).sort((a, b) => b[1].total - a[1].total);
			for (const [st, b] of sorted) {
				const rate = fmtPct(b.resolutionRate);
				lines.push(`    ${st.padEnd(20)} ${String(b.resolved).padStart(4)}/${String(b.total).padStart(4)}  ${rate}`);
			}
		}
	}

	lines.push("");
	lines.push(`  ${DIM}Schema: v${report.reportSchemaVersion}${RESET}`);
	lines.push("");

	return lines.join("\n");
}
