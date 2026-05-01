/**
 * Segment-content excerpt loader for the gold-query recipe (#344 step 2d).
 *
 * Given a corpus's segments, build a `Map<artifactId, string>` keyed by the
 * stable `Chunk.documentId`. Used by the recipe-author CLI to inject a
 * sample artifact's content into the LLM prompt as `excerpt`, so the
 * authored query can reference real concepts in the artifact instead of
 * hallucinating from the artifactId alone.
 *
 * Excerpt strategy:
 *   - Concatenate all chunks belonging to the same documentId in
 *     `chunkIndex` order so the excerpt reads top-to-bottom of the
 *     document, not interleaved.
 *   - Cap at `maxChars` (default 4000) to fit the prompt budget; any
 *     chunks past the cap are dropped silently.
 *   - When a documentId has zero chunks (unlikely but possible mid-
 *     ingest), the loader returns no entry — callers fall back to id-only
 *     prompts.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import type { Segment } from "@wtfoc/common";

export interface ExcerptLoaderOptions {
	/** Max characters per excerpt. Default 4000 (matches LLM author prompt). */
	maxChars?: number;
}

interface PerDocChunk {
	chunkIndex: number;
	content: string;
}

/**
 * Build the artifactId → excerpt map from a list of segments. Time
 * complexity: O(total chunks). Space: O(unique documentIds * maxChars).
 */
export function buildExcerptMap(
	segments: ReadonlyArray<Segment>,
	opts: ExcerptLoaderOptions = {},
): Map<string, string> {
	const maxChars = opts.maxChars ?? 4000;
	const byDoc = new Map<string, PerDocChunk[]>();
	for (const seg of segments) {
		for (let i = 0; i < seg.chunks.length; i++) {
			const c = seg.chunks[i];
			if (!c?.documentId) continue;
			const list = byDoc.get(c.documentId) ?? [];
			// segment-builder doesn't carry chunkIndex on Segment.chunks; use the
			// position within the segment as a stable order proxy.
			list.push({ chunkIndex: i, content: c.content });
			byDoc.set(c.documentId, list);
		}
	}
	const out = new Map<string, string>();
	for (const [documentId, chunks] of byDoc) {
		chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
		const joined = chunks.map((c) => c.content).join("\n\n");
		if (joined.length === 0) continue;
		out.set(documentId, joined.length <= maxChars ? joined : `${joined.slice(0, maxChars)}…`);
	}
	return out;
}

/**
 * Lookup helper. Returns `undefined` when the artifact has no chunks
 * (cold ingest, schema mismatch, etc.). Callers fall back to id-only
 * prompts in that case.
 */
export function getExcerpt(
	excerpts: ReadonlyMap<string, string>,
	artifactId: string,
): string | undefined {
	return excerpts.get(artifactId);
}
