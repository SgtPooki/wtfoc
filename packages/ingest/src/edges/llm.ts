import type { Chunk, Edge, EdgeExtractor, StructuredEvidence } from "@wtfoc/common";
import { validateEdges } from "./edge-validator.js";
import { chatCompletion, type LlmClientOptions, parseJsonResponse } from "./llm-client.js";
import { buildExtractionMessages, estimatePromptOverhead, estimateTokens } from "./llm-prompt.js";

/** Canonical edge types that the product supports. Non-canonical types are normalized to these. */
const CANONICAL_EDGE_TYPES = new Set([
	"references",
	"closes",
	"changes",
	"imports",
	"depends-on",
	"implements",
	"documents",
	"tests",
	"addresses",
	"discusses",
	"authored-by",
	"reviewed-by",
	"supersedes",
	"superseded-by",
]);

/** Map freeform LLM labels to canonical types */
const EDGE_TYPE_NORMALIZATION: Record<string, string> = {
	// → addresses
	"responds-to": "addresses",
	fixes: "addresses",
	solves: "addresses",
	mitigates: "addresses",
	"fixes-bug": "addresses",
	resolves: "addresses",
	// → discusses
	about: "discusses",
	covers: "discusses",
	"talks-about": "discusses",
	mentions: "discusses",
	describes: "discusses",
	// → implements
	"adds-support-for": "implements",
	realizes: "implements",
	"implements-feature": "implements",
	// → documents
	"doc-for": "documents",
	explains: "documents",
	"describes-api": "documents",
	summarizes: "documents",
	// → tests
	verifies: "tests",
	"regression-test-for": "tests",
	validates: "tests",
	// → references
	cites: "references",
	"links-to": "references",
	quotes: "references",
	"related-to": "references",
	// → depends-on
	requires: "depends-on",
	"blocked-by": "depends-on",
	// → closes
	"closes-issue": "closes",
	// → imports
	"re-exports": "imports",
	uses: "imports",
	// → authored-by
	"created-by": "authored-by",
	"written-by": "authored-by",
	"proposed-by": "authored-by",
	"published-by": "authored-by",
};

/**
 * Normalize an edge type to the canonical vocabulary.
 * Returns the canonical type if found, otherwise returns the original.
 */
function normalizeEdgeType(type: string): string {
	if (CANONICAL_EDGE_TYPES.has(type)) return type;
	const normalized = EDGE_TYPE_NORMALIZATION[type];
	if (normalized) return normalized;
	// If not recognized, map to "discusses" as the safest generic semantic edge
	return "discusses";
}

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
			console.warn(
				`[wtfoc] Warning: prompt overhead (${promptOverhead} tokens) exceeds maxInputTokens (${maxInputTokens}). Skipping LLM extraction.`,
			);
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

		// Per-chunk JSON wrapper overhead: {"chunk_id":"...","source_type":"...","source":"...","text":"..."}
		// ~60 chars ≈ 15 tokens of framing per chunk in the user message.
		const perChunkOverhead = 15;

		for (const chunk of chunks) {
			const tokens = estimateTokens(chunk.content) + perChunkOverhead;
			if (currentBatch.length > 0 && currentTokens + tokens > maxTokens) {
				batches.push(currentBatch);
				currentBatch = [];
				currentTokens = 0;
			}
			if (tokens > maxTokens) {
				console.warn(
					`[wtfoc] Warning: chunk ${chunk.id} (${tokens} tokens) exceeds budget (${maxTokens}). Sending as oversized batch; LLM may truncate.`,
				);
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

		if (!Array.isArray(rawEdges)) {
			if (response.content.trim().length > 0) {
				console.error(
					`[wtfoc] LLM response not parseable as array (${response.content.length} chars): ${response.content.slice(0, 200)}`,
				);
			}
			return [];
		}

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

			// Normalize to canonical vocabulary
			const canonicalType = normalizeEdgeType(raw.type);

			const structuredEvidence: StructuredEvidence = {
				text: raw.evidence,
				extractor: "llm",
				model: this.#options.model,
				observedAt: new Date().toISOString(),
				confidence,
			};

			edges.push({
				type: canonicalType,
				sourceId: raw.sourceId,
				targetType: raw.targetType,
				targetId: raw.targetId,
				evidence: raw.evidence,
				confidence,
				structuredEvidence,
			});
		}

		// Run acceptance gates to filter low-quality edges
		const { accepted, rejected } = validateEdges(edges);
		if (rejected.length > 0) {
			for (const r of rejected) {
				console.error(`[wtfoc] Edge rejected: ${r.reason}`);
			}
		}
		return accepted;
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
