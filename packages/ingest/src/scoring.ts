import type { ChunkScorer } from "@wtfoc/common";

/**
 * Signal type definitions with their regex patterns.
 * Each pattern is matched case-insensitively against chunk content.
 */
const SIGNAL_PATTERNS: Record<string, RegExp[]> = {
	pain: [
		/doesn't work/i,
		/broken/i,
		/unusable/i,
		/frustrated/i,
		/\bbug\b/i,
		/\berror\b/i,
		/\bcrash/i,
		/\bfail/i,
		/timeout/i,
		/can't/i,
		/\bunable\b/i,
	],
	praise: [
		/love this/i,
		/works great/i,
		/exactly what I needed/i,
		/awesome/i,
		/thank you/i,
		/perfect/i,
		/amazing/i,
		/fantastic/i,
	],
	feature_request: [
		/wish there was/i,
		/would be nice/i,
		/any plans to/i,
		/feature request/i,
		/please add/i,
		/it would be great if/i,
		/can we have/i,
	],
	workaround: [
		/instead I/i,
		/wrote a script/i,
		/hack around/i,
		/temporary fix/i,
		/workaround/i,
		/\bmanually\b/i,
	],
	question: [
		/how do I/i,
		/is there a way/i,
		/can someone explain/i,
		/where do I find/i,
		/what is/i,
		/how to/i,
		/anyone know/i,
	],
};

/** Maximum raw match count used for normalization. */
const MAX_MATCHES_FOR_NORMALIZATION = 5;

/**
 * Heuristic chunk scorer that uses regex pattern matching to detect
 * signal types in content. Scores are normalized to 0-100 scale.
 */
export class HeuristicChunkScorer implements ChunkScorer {
	score(content: string, _sourceType: string): Record<string, number> {
		const scores: Record<string, number> = {};

		for (const [signal, patterns] of Object.entries(SIGNAL_PATTERNS)) {
			let matchCount = 0;
			for (const pattern of patterns) {
				if (pattern.test(content)) {
					matchCount++;
				}
			}
			if (matchCount > 0) {
				// Normalize: each match contributes proportionally, capped at 100
				const raw = matchCount / MAX_MATCHES_FOR_NORMALIZATION;
				scores[signal] = Math.min(100, Math.round(raw * 100));
			}
		}

		return scores;
	}

	scoreBatch(items: Array<{ content: string; sourceType: string }>): Array<Record<string, number>> {
		return items.map((item) => this.score(item.content, item.sourceType));
	}
}
