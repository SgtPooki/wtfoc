/** Individual check within a stage evaluation. */
export interface EvalCheck {
	name: string;
	passed: boolean;
	/** What was measured */
	actual: string | number;
	/** What was expected (threshold or target) */
	expected?: string | number;
	/** Explanation when failed */
	detail?: string;
}

/** Common result envelope for every dogfood evaluation stage. */
export interface EvalStageResult {
	/** Stage identifier: "ingest" | "edge-extraction" | "edge-resolution" | "storage" | "themes" | "signals" | "search" */
	stage: string;
	/** ISO timestamp when this stage started */
	startedAt: string;
	/** Wall-clock duration in ms */
	durationMs: number;
	/** Pass/warn/fail/skipped overall verdict */
	verdict: "pass" | "warn" | "fail" | "skipped";
	/** Human-readable summary line */
	summary: string;
	/** Stage-specific metrics (JSON-serializable) */
	metrics: Record<string, unknown>;
	/** Individual check results */
	checks: EvalCheck[];
}

/** Top-level report from `pnpm dogfood`. */
export interface DogfoodReport {
	/** Semantic version for forward compat — starts at "1.0.0" */
	reportSchemaVersion: string;
	/** ISO timestamp */
	timestamp: string;
	/** Collection evaluated */
	collectionId: string;
	collectionName: string;
	/** Per-stage results in pipeline order */
	stages: EvalStageResult[];
	/** Aggregate verdict: fail if any stage fails, warn if any warns, else pass (skipped stages excluded) */
	verdict: "pass" | "warn" | "fail";
	/** Total wall-clock duration in ms */
	durationMs: number;
}

/** Compute aggregate verdict from stage results: fail > warn > pass. Skipped stages are excluded. */
export function aggregateVerdict(stages: EvalStageResult[]): "pass" | "warn" | "fail" {
	const active = stages.filter((s) => s.verdict !== "skipped");
	if (active.some((s) => s.verdict === "fail")) return "fail";
	if (active.some((s) => s.verdict === "warn")) return "warn";
	return "pass";
}
