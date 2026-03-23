import type { Embedder } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "text-embedding-3-small";
const API_URL = "https://api.openai.com/v1/embeddings";

export interface OpenAIEmbedderOptions {
	apiKey: string;
	model?: string;
	/** If not provided, auto-detected from first API response */
	dimensions?: number;
	baseUrl?: string;
}

/**
 * OpenAI-compatible embedder. Works with OpenAI API, LM Studio, Ollama,
 * or any server that implements the /v1/embeddings endpoint.
 *
 * Dimensions are auto-detected from the first response if not specified.
 */
export class OpenAIEmbedder implements Embedder {
	#dimensions: number | null;
	readonly #apiKey: string;
	readonly #model: string;
	readonly #baseUrl: string;

	get dimensions(): number {
		if (this.#dimensions === null) {
			throw new EmbedFailedError(
				this.#model,
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
		this.#model = options.model ?? DEFAULT_MODEL;
		this.#dimensions = options.dimensions ?? null;

		const base = options.baseUrl ?? API_URL;
		this.#baseUrl = base.endsWith("/embeddings") ? base : `${base.replace(/\/$/, "")}/embeddings`;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		const results = await this.#request([text], signal);
		const result = results[0];
		if (!result) {
			throw new EmbedFailedError(this.#model, "Empty embedding response");
		}
		return result;
	}

	async embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		return this.#request(texts, signal);
	}

	async #request(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		signal?.throwIfAborted();

		let response: Response;
		try {
			response = await fetch(this.#baseUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.#apiKey}`,
				},
				body: JSON.stringify({
					model: this.#model,
					input,
				}),
				signal,
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			throw new EmbedFailedError(this.#model, err);
		}

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new EmbedFailedError(this.#model, `HTTP ${response.status}: ${body}`);
		}

		const json = await response.json();
		const data = json?.data;

		if (!Array.isArray(data) || data.length === 0) {
			throw new EmbedFailedError(
				this.#model,
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
