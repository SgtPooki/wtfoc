import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";

/**
 * Source types considered "chat/discussion" sources.
 * Messages from these are linked to nearby GitHub activity.
 */
const CHAT_SOURCE_TYPES = new Set(["slack-message", "slack-thread"]);

/**
 * Source types considered "GitHub activity" sources.
 */
const GITHUB_SOURCE_TYPES = new Set([
	"github-issue",
	"github-pr",
	"github-pr-comment",
	"github-discussion",
]);

export interface TemporalEdgeExtractorOptions {
	/** Time window in hours (default: 12). Chunks within ±window hours are linked. */
	windowHours?: number;
	/** Include window size in edge type (e.g. "temporal-proximity-6h"). Default: false */
	tagWindow?: boolean;
}

/**
 * Extracts "temporal-proximity" edges between chat messages (Slack) and
 * GitHub activity (issues, PRs, comments) that occurred within a time window.
 *
 * Confidence decays linearly: 1.0 at same time → 0.3 at window boundary.
 * Edges are deduped by source pair (one edge per chat-source ↔ github-source).
 */
export class TemporalEdgeExtractor implements EdgeExtractor {
	readonly #windowMs: number;
	readonly #windowHours: number;
	readonly #tagWindow: boolean;

	constructor(options?: TemporalEdgeExtractorOptions) {
		this.#windowHours = options?.windowHours ?? 12;
		this.#windowMs = this.#windowHours * 60 * 60 * 1000;
		this.#tagWindow = options?.tagWindow ?? false;
	}

	async extract(chunks: Chunk[], _signal?: AbortSignal): Promise<Edge[]> {
		const chatChunks: Array<{ id: string; source: string; sourceType: string; time: number }> = [];
		const ghChunks: Array<{ id: string; source: string; sourceType: string; time: number }> = [];

		for (const chunk of chunks) {
			const ts = chunk.timestamp ?? chunk.metadata?.createdAt ?? chunk.metadata?.updatedAt;
			if (!ts) continue;
			const time = new Date(ts).getTime();
			if (Number.isNaN(time)) continue;

			const entry = { id: chunk.id, source: chunk.source, sourceType: chunk.sourceType, time };

			if (CHAT_SOURCE_TYPES.has(chunk.sourceType)) {
				chatChunks.push(entry);
			} else if (GITHUB_SOURCE_TYPES.has(chunk.sourceType)) {
				ghChunks.push(entry);
			}
		}

		if (chatChunks.length === 0 || ghChunks.length === 0) return [];

		// Sort GitHub chunks by time for binary search
		ghChunks.sort((a, b) => a.time - b.time);

		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const chat of chatChunks) {
			const lo = chat.time - this.#windowMs;
			const hi = chat.time + this.#windowMs;

			// Binary search for start of window
			let start = 0;
			let end = ghChunks.length;
			while (start < end) {
				const mid = (start + end) >> 1;
				if ((ghChunks[mid] as (typeof ghChunks)[0]).time < lo) start = mid + 1;
				else end = mid;
			}

			for (let i = start; i < ghChunks.length; i++) {
				const gh = ghChunks[i] as (typeof ghChunks)[0];
				if (gh.time > hi) break;

				// Dedupe by source pair
				const key = `${chat.source}|${gh.source}`;
				if (seen.has(key)) continue;
				seen.add(key);

				const diffHours = Math.abs(chat.time - gh.time) / (60 * 60 * 1000);
				const confidence = Math.max(0.3, 1.0 - diffHours / this.#windowHours);

				const edgeType = this.#tagWindow
					? `temporal-proximity-${this.#windowHours}h`
					: "temporal-proximity";
				edges.push({
					type: edgeType,
					sourceId: chat.id,
					targetType: gh.sourceType,
					targetId: gh.source,
					evidence: `${chat.sourceType} in ${chat.source} within ${diffHours.toFixed(1)}h of ${gh.sourceType} ${gh.source}`,
					confidence: Math.round(confidence * 100) / 100,
					provenance: ["temporal"],
				});
			}
		}

		return edges;
	}
}
