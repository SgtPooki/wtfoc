import type { Chunk, Edge, EdgeExtractor, StructuredEvidence } from "@wtfoc/common";

/**
 * Directional temporal-semantic edge types.
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
	entityId: string;
	entityType: string;
	source: string;
	/** Stable target identifier (documentId or sourceUrl, not channel name) */
	stableId: string;
	timestampStart: number;
	timestampEnd: number | null;
	embedding?: Float32Array;
	text: string;
}

export interface TemporalSemanticOptions {
	discussionThreshold?: number;
	issueThreshold?: number;
	fallbackThreshold?: number;
	tauDiscussion?: number;
	tauCommit?: number;
	maxWindowHours?: number;
}

export interface TemporalExtractionResult {
	edges: Edge[];
	/** True if extraction ran without embeddings (temporal-only mode) */
	temporalOnly: boolean;
}

const DISCUSSION_TYPES = new Set(["slack-message", "discord-message", "github-discussion"]);
const WORK_ITEM_TYPES = new Set(["github-issue", "github-pr"]);
const CODE_TYPES = new Set(["code", "github-pr"]);

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

function classifyTemporalRelation(
	source: TemporalEvent,
	target: TemporalEvent,
): TemporalEdgeType | null {
	const sourceIsDiscussion = DISCUSSION_TYPES.has(source.entityType);
	const targetIsWorkItem = WORK_ITEM_TYPES.has(target.entityType);
	const sourceIsCode = CODE_TYPES.has(source.entityType);
	const targetIsDiscussionOrWork =
		DISCUSSION_TYPES.has(target.entityType) || WORK_ITEM_TYPES.has(target.entityType);

	const sourceBefore = source.timestampStart < target.timestampStart;
	const sourceAfter = source.timestampStart > target.timestampStart;

	// Discussion happened before work item → discussed-before
	if (sourceIsDiscussion && targetIsWorkItem && sourceBefore) {
		return "discussed-before";
	}

	// Discussion overlaps with work item interval → discussed-during
	if (sourceIsDiscussion && targetIsWorkItem && target.timestampEnd !== null) {
		if (
			source.timestampStart >= target.timestampStart &&
			source.timestampStart <= target.timestampEnd
		) {
			return "discussed-during";
		}
	}

	// Code within work item interval → occurred-during
	if (sourceIsCode && targetIsWorkItem && target.timestampEnd !== null) {
		if (
			source.timestampStart >= target.timestampStart &&
			source.timestampStart <= target.timestampEnd
		) {
			return "occurred-during";
		}
	}

	// Code change after discussion/issue → addressed-after
	if (sourceIsCode && targetIsDiscussionOrWork && sourceAfter) {
		return "addressed-after";
	}

	// Generic ordering when both have timestamps
	if (sourceBefore) return "followed-by";
	return null;
}

/**
 * Check if two events are within the time window, accounting for intervals.
 * For point events: uses start-to-start distance.
 * For interval events: checks if either event falls within the other's interval.
 */
function isWithinWindow(a: TemporalEvent, b: TemporalEvent, maxWindowMs: number): boolean {
	const startDelta = Math.abs(a.timestampStart - b.timestampStart);
	if (startDelta <= maxWindowMs) return true;

	// Check if either event falls inside the other's interval
	if (a.timestampEnd !== null) {
		if (b.timestampStart >= a.timestampStart && b.timestampStart <= a.timestampEnd) return true;
	}
	if (b.timestampEnd !== null) {
		if (a.timestampStart >= b.timestampStart && a.timestampStart <= b.timestampEnd) return true;
	}

	return false;
}

/**
 * Temporal-semantic edge extractor.
 *
 * Produces directional edges based on time ordering + semantic similarity.
 * Designed for post-hoc extraction over indexed entities.
 *
 * Pass pre-computed embeddings via the embeddings parameter in extract().
 * Without embeddings, emits temporal-only edges at reduced confidence (max 0.5).
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

	/**
	 * Extract temporal-semantic edges from chunks.
	 * Implements EdgeExtractor interface (no embeddings = temporal-only mode).
	 */
	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		const result = this.extractWithEmbeddings(chunks, new Map(), signal);
		return result.edges;
	}

	/**
	 * Extract with pre-computed embeddings for semantic similarity.
	 * This is the preferred entry point for post-hoc extraction.
	 */
	extractWithEmbeddings(
		chunks: Chunk[],
		embeddings: ReadonlyMap<string, Float32Array>,
		signal?: AbortSignal,
	): TemporalExtractionResult {
		const events = this.#chunksToEvents(chunks, embeddings);
		if (events.length < 2) return { edges: [], temporalOnly: embeddings.size === 0 };

		const temporalOnly = embeddings.size === 0;

		// Sort by timestamp for efficient scanning
		events.sort((a, b) => a.timestampStart - b.timestampStart);

		const edges: Edge[] = [];
		const seen = new Set<string>();
		const maxWindowMs = this.#options.maxWindowHours * 60 * 60 * 1000;

		for (let i = 0; i < events.length; i++) {
			signal?.throwIfAborted();
			const source = events[i] as TemporalEvent;
			// The latest point this source could overlap with anything
			const sourceLatest = Math.max(
				source.timestampStart + maxWindowMs,
				(source.timestampEnd ?? source.timestampStart) + maxWindowMs,
			);

			for (let j = i + 1; j < events.length; j++) {
				const target = events[j] as TemporalEvent;

				// Target starts after source's latest possible overlap — done with this source
				if (target.timestampStart > sourceLatest) break;

				if (!isWithinWindow(source, target, maxWindowMs)) continue;

				if (source.entityType === target.entityType) continue;

				// Try both directions for directional edges
				for (const [src, tgt] of [
					[source, target],
					[target, source],
				] as [TemporalEvent, TemporalEvent][]) {
					const edgeType = classifyTemporalRelation(src, tgt);
					if (!edgeType) continue;

					const key = `${edgeType}:${src.stableId}:${tgt.stableId}`;
					if (seen.has(key)) continue;

					let semanticScore = 0;
					if (src.embedding && tgt.embedding) {
						semanticScore = cosineSimilarity(src.embedding, tgt.embedding);
					}

					const hasEmbeddings = !!(src.embedding && tgt.embedding);
					const threshold = this.#getThreshold(src, tgt);
					if (hasEmbeddings && semanticScore < threshold) continue;

					// For interval-based relations (during/occurred-during), use distance
					// from event to nearest interval boundary instead of start-start delta
					const isIntervalRelation =
						edgeType === "discussed-during" || edgeType === "occurred-during";
					let effectiveDelta: number;
					if (isIntervalRelation && tgt.timestampEnd !== null) {
						// Event is inside interval — distance to nearest boundary
						effectiveDelta = 0;
					} else {
						effectiveDelta = Math.abs(src.timestampStart - tgt.timestampStart);
					}
					const deltaHours = effectiveDelta / (60 * 60 * 1000);
					const tau = this.#getTau(src, tgt);
					const timeScore = Math.exp(-deltaHours / tau);
					const confidence = hasEmbeddings
						? Math.min(0.8, semanticScore ** 1.5 * timeScore ** 0.75)
						: Math.min(0.5, timeScore ** 0.75 * 0.5);

					if (confidence < 0.3) continue;
					seen.add(key);

					const simNote = hasEmbeddings ? `, similarity: ${semanticScore.toFixed(2)}` : "";
					const evidenceText = `${src.entityType} "${src.text.slice(0, 60)}..." ${edgeType.replace(/-/g, " ")} ${tgt.entityType} "${tgt.text.slice(0, 60)}..." (${deltaHours.toFixed(1)}h apart${simNote})`;

					const structuredEvidence: StructuredEvidence = {
						text: evidenceText,
						extractor: "temporal-semantic",
						observedAt: new Date().toISOString(),
						confidence,
					};

					edges.push({
						type: edgeType,
						sourceId: src.entityId,
						targetType: tgt.entityType,
						targetId: tgt.stableId,
						evidence: evidenceText,
						confidence: Math.round(confidence * 100) / 100,
						provenance: ["temporal-semantic"],
						structuredEvidence,
					});
				}
			}
		}

		return { edges, temporalOnly };
	}

	#chunksToEvents(chunks: Chunk[], embeddings: ReadonlyMap<string, Float32Array>): TemporalEvent[] {
		const events: TemporalEvent[] = [];
		for (const chunk of chunks) {
			const ts = chunk.timestamp ?? chunk.metadata?.createdAt ?? chunk.metadata?.updatedAt;
			if (!ts) continue;
			const time = new Date(ts).getTime();
			if (Number.isNaN(time)) continue;

			let endTime: number | null = null;
			const closedAt = chunk.metadata?.closedAt ?? chunk.metadata?.mergedAt;
			if (closedAt) {
				const closed = new Date(closedAt).getTime();
				if (!Number.isNaN(closed)) endTime = closed;
			}

			// Use documentId for stable target identification (all adapters emit this)
			const stableId = chunk.documentId ?? chunk.sourceUrl ?? chunk.source;

			events.push({
				entityId: chunk.id,
				entityType: chunk.sourceType,
				source: chunk.source,
				stableId,
				timestampStart: time,
				timestampEnd: endTime,
				embedding: embeddings.get(chunk.id),
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
