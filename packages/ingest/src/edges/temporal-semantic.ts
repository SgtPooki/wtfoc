import type { Chunk, Edge, EdgeExtractor, StructuredEvidence } from "@wtfoc/common";

/**
 * Directional temporal-semantic edge types.
 * Each encodes both time ordering and semantic relevance.
 */
export type TemporalEdgeType =
	| "discussed-before"
	| "discussed-during"
	| "addressed-after"
	| "occurred-during"
	| "followed-by";

/**
 * An event record with timing and optional embedding for similarity.
 */
export interface TemporalEvent {
	/** Chunk or document ID */
	entityId: string;
	/** Source type (github-issue, slack-message, code, etc.) */
	entityType: string;
	/** Source identifier */
	source: string;
	/** Event start timestamp (ms since epoch) */
	timestampStart: number;
	/** Event end timestamp for interval events (null for point events) */
	timestampEnd: number | null;
	/** Pre-computed embedding vector for similarity comparison */
	embedding?: Float32Array;
	/** Text snippet for evidence */
	text: string;
}

export interface TemporalSemanticOptions {
	/** Semantic similarity threshold for discussion→issue/PR (default: 0.78) */
	discussionThreshold?: number;
	/** Semantic similarity threshold for issue→PR (default: 0.72) */
	issueThreshold?: number;
	/** Semantic similarity threshold for fallback pairs (default: 0.68) */
	fallbackThreshold?: number;
	/** Time decay tau in hours for discussion→issue/PR (default: 72) */
	tauDiscussion?: number;
	/** Time decay tau in hours for discussion→commit (default: 24) */
	tauCommit?: number;
	/** Maximum time window in hours (default: 168 = 1 week) */
	maxWindowHours?: number;
}

/** Source types that represent discussion/chat */
const DISCUSSION_TYPES = new Set(["slack-message", "discord-message", "github-discussion"]);

/** Source types that represent trackable work items */
const WORK_ITEM_TYPES = new Set(["github-issue", "github-pr"]);

/** Source types that represent code changes */
const CODE_TYPES = new Set(["code", "github-pr"]);

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] as number) * (b[i] as number);
		normA += (a[i] as number) * (a[i] as number);
		normB += (b[i] as number) * (b[i] as number);
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

/**
 * Determine the temporal edge type based on event ordering and types.
 */
function classifyTemporalRelation(
	source: TemporalEvent,
	target: TemporalEvent,
): TemporalEdgeType | null {
	const sourceIsDiscussion = DISCUSSION_TYPES.has(source.entityType);
	const targetIsWorkItem = WORK_ITEM_TYPES.has(target.entityType);
	const sourceIsCode = CODE_TYPES.has(source.entityType);
	const targetIsDiscussion =
		DISCUSSION_TYPES.has(target.entityType) || WORK_ITEM_TYPES.has(target.entityType);

	const sourceBefore = source.timestampStart < target.timestampStart;
	const sourceAfter = source.timestampStart > target.timestampStart;

	// Discussion happened before work item → discussed-before
	if (sourceIsDiscussion && targetIsWorkItem && sourceBefore) {
		return "discussed-before";
	}

	// Discussion overlaps with work item interval → discussed-during
	if (sourceIsDiscussion && targetIsWorkItem && target.timestampEnd) {
		const overlap =
			source.timestampStart >= target.timestampStart &&
			source.timestampStart <= target.timestampEnd;
		if (overlap) return "discussed-during";
	}

	// Code change after discussion/issue → addressed-after
	if (sourceIsCode && (targetIsDiscussion || targetIsWorkItem) && sourceAfter) {
		return "addressed-after";
	}

	// Code within work item interval → occurred-during
	if (sourceIsCode && targetIsWorkItem && target.timestampEnd) {
		const within =
			source.timestampStart >= target.timestampStart &&
			source.timestampStart <= target.timestampEnd;
		if (within) return "occurred-during";
	}

	// Generic ordering when both have timestamps and some semantic match
	if (sourceBefore) return "followed-by";

	return null;
}

/**
 * Temporal-semantic edge extractor.
 *
 * Produces directional edges based on time ordering + semantic similarity.
 * Designed for post-hoc extraction over indexed entities.
 *
 * Requires pre-computed embeddings on events. Without embeddings, falls back
 * to temporal-only extraction at reduced confidence.
 */
export class TemporalSemanticExtractor implements EdgeExtractor {
	readonly #options: Required<TemporalSemanticOptions>;

	constructor(options?: TemporalSemanticOptions) {
		this.#options = {
			discussionThreshold: options?.discussionThreshold ?? 0.78,
			issueThreshold: options?.issueThreshold ?? 0.72,
			fallbackThreshold: options?.fallbackThreshold ?? 0.68,
			tauDiscussion: options?.tauDiscussion ?? 72,
			tauCommit: options?.tauCommit ?? 24,
			maxWindowHours: options?.maxWindowHours ?? 168,
		};
	}

	async extract(chunks: Chunk[], _signal?: AbortSignal): Promise<Edge[]> {
		// Build events from chunks
		const events = this.#chunksToEvents(chunks);
		if (events.length < 2) return [];

		const edges: Edge[] = [];
		const seen = new Set<string>();
		const maxWindowMs = this.#options.maxWindowHours * 60 * 60 * 1000;

		// Compare each pair of events from different source types
		for (let i = 0; i < events.length; i++) {
			const source = events[i] as TemporalEvent;
			for (let j = 0; j < events.length; j++) {
				if (i === j) continue;
				const target = events[j] as TemporalEvent;

				// Skip same source type pairs (discussion↔discussion, etc.)
				if (source.entityType === target.entityType) continue;

				// Skip if outside time window
				const timeDelta = Math.abs(source.timestampStart - target.timestampStart);
				if (timeDelta > maxWindowMs) continue;

				// Classify the temporal relation
				const edgeType = classifyTemporalRelation(source, target);
				if (!edgeType) continue;

				// Dedup by source→target pair + type
				const key = `${edgeType}:${source.entityId}:${target.entityId}`;
				if (seen.has(key)) continue;

				// Compute semantic similarity if embeddings available
				let semanticScore = 0;
				if (source.embedding && target.embedding) {
					semanticScore = cosineSimilarity(source.embedding, target.embedding);
				}

				// Apply semantic threshold based on pair type
				const threshold = this.#getThreshold(source, target);
				if (source.embedding && target.embedding && semanticScore < threshold) {
					continue;
				}

				// Compute confidence
				const deltaHours = timeDelta / (60 * 60 * 1000);
				const tau = this.#getTau(source, target);
				const timeScore = Math.exp(-deltaHours / tau);
				const confidence =
					source.embedding && target.embedding
						? Math.min(0.8, semanticScore ** 1.5 * timeScore ** 0.75)
						: Math.min(0.5, timeScore ** 0.75 * 0.5);

				if (confidence < 0.3) continue;

				seen.add(key);

				const evidenceText = `${source.entityType} "${source.text.slice(0, 60)}..." ${edgeType.replace(/-/g, " ")} ${target.entityType} "${target.text.slice(0, 60)}..." (${deltaHours.toFixed(1)}h apart, similarity: ${semanticScore.toFixed(2)})`;

				const structuredEvidence: StructuredEvidence = {
					text: evidenceText,
					extractor: "temporal-semantic",
					observedAt: new Date().toISOString(),
					confidence,
				};

				edges.push({
					type: edgeType,
					sourceId: source.entityId,
					targetType: target.entityType,
					targetId: target.source,
					evidence: evidenceText,
					confidence: Math.round(confidence * 100) / 100,
					provenance: ["temporal-semantic"],
					structuredEvidence,
				});
			}
		}

		return edges;
	}

	#chunksToEvents(chunks: Chunk[]): TemporalEvent[] {
		const events: TemporalEvent[] = [];
		for (const chunk of chunks) {
			const ts = chunk.timestamp ?? chunk.metadata?.createdAt ?? chunk.metadata?.updatedAt;
			if (!ts) continue;
			const time = new Date(ts).getTime();
			if (Number.isNaN(time)) continue;

			// For issues/PRs, try to build an interval from created→closed/merged
			let endTime: number | null = null;
			const closedAt = chunk.metadata?.closedAt ?? chunk.metadata?.mergedAt;
			if (closedAt) {
				const closed = new Date(closedAt).getTime();
				if (!Number.isNaN(closed)) endTime = closed;
			}

			events.push({
				entityId: chunk.id,
				entityType: chunk.sourceType,
				source: chunk.source,
				timestampStart: time,
				timestampEnd: endTime,
				text: chunk.content.slice(0, 200),
			});
		}
		return events;
	}

	#getThreshold(source: TemporalEvent, target: TemporalEvent): number {
		if (DISCUSSION_TYPES.has(source.entityType) && WORK_ITEM_TYPES.has(target.entityType)) {
			return this.#options.discussionThreshold;
		}
		if (WORK_ITEM_TYPES.has(source.entityType) && WORK_ITEM_TYPES.has(target.entityType)) {
			return this.#options.issueThreshold;
		}
		return this.#options.fallbackThreshold;
	}

	#getTau(source: TemporalEvent, target: TemporalEvent): number {
		if (CODE_TYPES.has(source.entityType) || CODE_TYPES.has(target.entityType)) {
			return this.#options.tauCommit;
		}
		return this.#options.tauDiscussion;
	}
}
