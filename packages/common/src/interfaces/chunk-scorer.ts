/**
 * Pluggable chunk scorer. Analyzes chunk content and source type
 * to produce signal scores (pain, praise, feature_request, etc.).
 */
export interface ChunkScorer {
	score(content: string, sourceType: string): Record<string, number>;
	scoreBatch(items: Array<{ content: string; sourceType: string }>): Array<Record<string, number>>;
}
