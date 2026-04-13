export interface CursorDecisionInput {
	isPartialRun: boolean;
	/** Git HEAD SHA for repo adapters, null otherwise. */
	repoHeadSha: string | null;
	/** Max timestamp seen from source data during streaming. */
	maxTimestamp: string;
	/** Existing stored cursor value (for regression prevention). */
	existingCursorValue: string | null;
}

export interface CursorDecision {
	cursorValue: string | null;
	reason: string;
}

/**
 * Pure function: decide the cursor value to persist after an ingest run.
 * Extracted from ingest.ts cursor logic (lines 751-788).
 */
export function decideCursorValue(input: CursorDecisionInput): CursorDecision {
	// Partial runs (filter flags active) should not advance cursor
	if (input.isPartialRun) {
		return { cursorValue: null, reason: "partial-run" };
	}

	// Repo adapters use git HEAD SHA as cursor (enables git-diff next run)
	if (input.repoHeadSha) {
		return { cursorValue: input.repoHeadSha, reason: "repo-head-sha" };
	}

	// Timestamp-based cursor from source data
	const computed = input.maxTimestamp || null;
	if (!computed) {
		return { cursorValue: null, reason: "no-data" };
	}

	// Prevent cursor regression: use max(existing, computed)
	if (input.existingCursorValue && input.existingCursorValue > computed) {
		return { cursorValue: input.existingCursorValue, reason: "existing-cursor-no-regression" };
	}

	return { cursorValue: computed, reason: "max-timestamp" };
}
