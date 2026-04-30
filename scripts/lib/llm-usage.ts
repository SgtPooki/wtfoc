/**
 * Neutral LLM-call accounting type. Maintainer-only.
 *
 * Used by every LLM-backed component (embedder, reranker, future
 * synthesizer + grader) so cost / latency / drift are captured through
 * one shape. Lives outside published packages so consumers see no
 * autoresearch surface.
 */

export interface LlmUsage {
	/** What we asked the provider for. */
	requestModelId: string;
	/** What the provider actually billed against (drift detection). Often the same. */
	providerResponseModelId?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	/** Wall-clock duration of the provider call, in milliseconds. */
	durationMs?: number;
}

export type UsageSink = (usage: LlmUsage) => void;
