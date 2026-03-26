import type { Embedder, PrefixFormatter } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "text-embedding-3-small";
const API_URL = "https://api.openai.com/v1/embeddings";

export interface OpenAIEmbedderOptions {
	apiKey: string;
	model?: string;
	/** If not provided, auto-detected from first API response */
	dimensions?: number;
	/** Send dimensions in the request body (for MRL/Matryoshka models that support dimensional reduction) */
	requestDimensions?: number;
	baseUrl?: string;
	/** Max characters per input text (truncated if exceeded). Default: 4000 (~1.5K tokens, safe for 2048-token models) */
	maxInputChars?: number;
	/** Optional prefix formatter for asymmetric query/document embedding */
	prefix?: PrefixFormatter;
}

/**
 * OpenAI-compatible embedder. Works with OpenAI API, LM Studio, Ollama,
 * or any server that implements the /v1/embeddings endpoint.
 *
 * Dimensions are auto-detected from the first response if not specified.
 * Set requestDimensions to send a `dimensions` parameter in the API request
 * (supported by MRL/Matryoshka models like text-embedding-3-small/large).
 */
export class OpenAIEmbedder implements Embedder {
	#dimensions: number | null;
	readonly #apiKey: string;
	readonly #baseUrl: string;
	readonly #requestDimensions: number | undefined;

	readonly model: string;
	readonly maxInputChars: number;
	readonly prefix?: PrefixFormatter;

	get dimensions(): number {
		if (this.#dimensions === null) {
			throw new EmbedFailedError(
				this.model,
				"Dimensions not yet known — call embed() or embedBatch() first to auto-detect",
			);
		}
		return this.#dimensions;
	}

	constructor(options: OpenAIEmbedderOptions) {
		if (!options.apiKey) {
			throw new EmbedFailedError("openai", "API key is required");
		}
		this.#apiKey = options.apiKey;
		this.model = options.model ?? DEFAULT_MODEL;
		this.#dimensions = options.dimensions ?? null;
		this.#requestDimensions = options.requestDimensions;
		this.maxInputChars = options.maxInputChars ?? 4000;
		this.prefix = options.prefix;

		const base = options.baseUrl ?? API_URL;
		this.#baseUrl = base.endsWith("/embeddings") ? base : `${base.replace(/\/$/, "")}/embeddings`;
	}

	#applyPrefix(text: string, kind: "query" | "document"): string {
		if (!this.prefix) return text;
		const pfx = kind === "query" ? this.prefix.query : this.prefix.document;
		return pfx ? `${pfx}${text}` : text;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		const results = await this.#request([this.#applyPrefix(text, "query")], signal);
		const result = results[0];
		if (!result) {
			throw new EmbedFailedError(this.model, "Empty embedding response");
		}
		return result;
	}

	async embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		const prefixed = texts.map((t) => this.#applyPrefix(t, "document"));
		return this.#request(prefixed, signal);
	}

	async #request(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		signal?.throwIfAborted();

		// Truncate inputs that exceed the model's context limit
		let truncatedCount = 0;
		const truncated = input.map((text) => {
			if (text.length > this.maxInputChars) {
				truncatedCount++;
				return text.slice(0, this.maxInputChars);
			}
			return text;
		});
		if (truncatedCount > 0) {
			console.error(
				`⚠️  ${truncatedCount}/${input.length} inputs truncated to ${this.maxInputChars} chars (model: ${this.model})`,
			);
		}

		const body: Record<string, unknown> = {
			model: this.model,
			input: truncated,
		};
		if (this.#requestDimensions != null) {
			body.dimensions = this.#requestDimensions;
		}

		let response: Response;
		try {
			response = await fetch(this.#baseUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.#apiKey}`,
				},
				body: JSON.stringify(body),
				signal,
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			throw new EmbedFailedError(this.model, err);
		}

		if (!response.ok) {
			const respBody = await response.text().catch(() => "");
			throw new EmbedFailedError(this.model, `HTTP ${response.status}: ${respBody}`);
		}

		const json = await response.json();
		const data = json?.data;

		if (!Array.isArray(data) || data.length === 0) {
			throw new EmbedFailedError(
				this.model,
				`Unexpected API response: expected data array, got ${JSON.stringify(json).slice(0, 200)}`,
			);
		}

		const sorted = (data as Array<{ embedding: number[]; index: number }>).sort(
			(a, b) => a.index - b.index,
		);

		// Auto-detect dimensions from first response
		const firstEmbedding = sorted[0];
		if (firstEmbedding && this.#dimensions === null) {
			this.#dimensions = firstEmbedding.embedding.length;
		}

		return sorted.map((d) => new Float32Array(d.embedding));
	}
}
