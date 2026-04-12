import type { EvalStageResult, Segment } from "@wtfoc/common";
import { HeuristicChunkScorer } from "../scoring.js";

const SIGNAL_TYPES = ["pain", "praise", "feature_request", "workaround", "question"];

/**
 * Evaluate signal scoring quality: distribution across signal types and source types.
 */
export async function evaluateSignals(segments: Segment[]): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const chunks = segments.flatMap((s) => s.chunks);
	const totalChunks = chunks.length;

	if (totalChunks === 0) {
		return {
			stage: "signals",
			startedAt,
			durationMs: Math.round(performance.now() - t0),
			verdict: "pass",
			summary: "No chunks to score",
			metrics: { totalChunks: 0, signalCoverage: 0, signalCounts: {}, perSourceType: {} },
			checks: [],
		};
	}

	const scorer = new HeuristicChunkScorer();

	// Per-signal counts
	const signalCounts: Record<string, number> = {};
	for (const st of SIGNAL_TYPES) signalCounts[st] = 0;

	// Per-source-type breakdown
	const perSourceType: Record<string, Record<string, number>> = {};

	let chunksWithSignal = 0;

	for (const chunk of chunks) {
		const scores = scorer.score(chunk.content, chunk.sourceType);
		const hasAnySignal = Object.values(scores).some((v) => v > 0);
		if (hasAnySignal) chunksWithSignal++;

		for (const [signal, value] of Object.entries(scores)) {
			if (value > 0) {
				signalCounts[signal] = (signalCounts[signal] || 0) + 1;
			}
		}

		// Per-source-type
		const st = chunk.sourceType || "unknown";
		if (!perSourceType[st]) {
			perSourceType[st] = {};
			for (const s of SIGNAL_TYPES) perSourceType[st][s] = 0;
		}
		for (const [signal, value] of Object.entries(scores)) {
			if (value > 0) {
				perSourceType[st][signal] = (perSourceType[st][signal] || 0) + 1;
			}
		}
	}

	const signalCoverage = chunksWithSignal / totalChunks;

	// Per-signal percentages (AC-US9-02: both count AND percentage)
	const signalPercentages: Record<string, number> = {};
	for (const [signal, count] of Object.entries(signalCounts)) {
		signalPercentages[signal] = totalChunks > 0 ? count / totalChunks : 0;
	}

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "signals",
		startedAt,
		durationMs,
		verdict: "pass", // signals are informational, no failure threshold
		summary: `${chunksWithSignal}/${totalChunks} chunks with signals (${(signalCoverage * 100).toFixed(0)}%)`,
		metrics: {
			totalChunks,
			chunksWithSignal,
			signalCoverage,
			signalCounts,
			signalPercentages,
			perSourceType,
		},
		checks: [],
	};
}
