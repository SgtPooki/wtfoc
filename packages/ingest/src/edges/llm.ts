import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";
import { chatCompletion, type LlmClientOptions, parseJsonResponse } from "./llm-client.js";
import { buildExtractionMessages, estimatePromptOverhead, estimateTokens } from "./llm-prompt.js";

export interface LlmEdgeExtractorOptions extends LlmClientOptions {
	maxConcurrency?: number;
	maxInputTokens?: number;
}

interface RawEdge {
	type?: string;
	sourceId?: string;
	targetType?: string;
	targetId?: string;
	evidence?: string;
	confidence?: number;
}

/**
 * LLM-powered edge extractor for semantic relationship detection.
 *
 * Calls any OpenAI-compatible chat/completion endpoint to extract
 * edges that pattern-based extractors miss (design references,
 * person mentions, concept relationships, etc.).
 *
 * Fail-open: returns [] on any error without blocking the pipeline.
 * Confidence: 0.3-0.8 (LLM-extracted, below heuristic/regex tiers).
 */
export class LlmEdgeExtractor implements EdgeExtractor {
	readonly #options: LlmEdgeExtractorOptions;

	constructor(options: LlmEdgeExtractorOptions) {
		this.#options = options;
	}

	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		if (chunks.length === 0) return [];

		const maxConcurrency = this.#options.maxConcurrency ?? 4;
		const maxInputTokens = this.#options.maxInputTokens ?? 4000;

		// Subtract prompt overhead (system + few-shot) from the available token budget
		// so chunk batches don't overflow the model context window.
		const promptOverhead = estimatePromptOverhead();
		if (promptOverhead >= maxInputTokens) {
			return [];
		}
		const chunkBudget = maxInputTokens - promptOverhead;

		// Group chunks into batches respecting token budget
		const batches = this.#batchChunks(chunks, chunkBudget);

		// Process batches with concurrency limiter
		const allEdges: Edge[] = [];
		const semaphore = new Semaphore(maxConcurrency);

		const results = await Promise.allSettled(
			batches.map(async (batch) => {
				signal?.throwIfAborted();
				const release = await semaphore.acquire();
				try {
					signal?.throwIfAborted();
					return await this.#extractBatch(batch, signal);
				} finally {
					release();
				}
			}),
		);

		for (const result of results) {
			if (result.status === "fulfilled") {
				allEdges.push(...result.value);
			}
			// Failed batches silently dropped (fail-open)
		}

		return allEdges;
	}

	#batchChunks(chunks: Chunk[], maxTokens: number): Chunk[][] {
		const batches: Chunk[][] = [];
		let currentBatch: Chunk[] = [];
		let currentTokens = 0;

		for (const chunk of chunks) {
			const tokens = estimateTokens(chunk.content);
			if (currentBatch.length > 0 && currentTokens + tokens > maxTokens) {
				batches.push(currentBatch);
				currentBatch = [];
				currentTokens = 0;
			}
			currentBatch.push(chunk);
			currentTokens += tokens;
		}

		if (currentBatch.length > 0) {
			batches.push(currentBatch);
		}

		return batches;
	}

	async #extractBatch(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		const messages = buildExtractionMessages(chunks);

		const response = await chatCompletion(messages, this.#options, signal);
		const rawEdges = parseJsonResponse<RawEdge[]>(response.content);

		if (!Array.isArray(rawEdges)) return [];

		const validChunkIds = new Set(chunks.map((c) => c.id));
		const edges: Edge[] = [];

		for (const raw of rawEdges) {
			// Validate required fields
			if (!raw.type || !raw.sourceId || !raw.targetType || !raw.targetId) continue;
			// Reject edges with empty evidence
			if (!raw.evidence || raw.evidence.trim().length === 0) continue;
			// Validate sourceId belongs to input chunks
			if (!validChunkIds.has(raw.sourceId)) continue;
			// Clamp confidence to LLM tier
			const confidence = Math.min(0.8, Math.max(0.3, raw.confidence ?? 0.5));

			edges.push({
				type: raw.type,
				sourceId: raw.sourceId,
				targetType: raw.targetType,
				targetId: raw.targetId,
				evidence: raw.evidence,
				confidence,
			});
		}

		return edges;
	}
}

/**
 * Simple counting semaphore for concurrency limiting.
 */
class Semaphore {
	#count: number;
	readonly #waiters: Array<() => void> = [];

	constructor(count: number) {
		this.#count = count;
	}

	async acquire(): Promise<() => void> {
		if (this.#count > 0) {
			this.#count--;
			return () => this.#release();
		}

		return new Promise<() => void>((resolve) => {
			this.#waiters.push(() => {
				this.#count--;
				resolve(() => this.#release());
			});
		});
	}

	#release(): void {
		this.#count++;
		const next = this.#waiters.shift();
		if (next) next();
	}
}
