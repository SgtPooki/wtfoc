import type { Embedder } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const API_URL = "https://api.openai.com/v1/embeddings";

export interface OpenAIEmbedderOptions {
	apiKey: string;
	model?: string;
	dimensions?: number;
	baseUrl?: string;
}

/**
 * OpenAI-based embedder as a fallback when local models aren't suitable.
 * Requires an API key.
 */
export class OpenAIEmbedder implements Embedder {
	readonly dimensions: number;
	readonly #apiKey: string;
	readonly #model: string;
	readonly #baseUrl: string;

	constructor(options: OpenAIEmbedderOptions) {
		if (!options.apiKey) {
			throw new EmbedFailedError("openai", "API key is required");
		}
		this.#apiKey = options.apiKey;
		this.#model = options.model ?? DEFAULT_MODEL;
		this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
		this.#baseUrl = options.baseUrl ?? API_URL;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		const [result] = await this.#request([text], signal);
		return result!;
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

		const json = (await response.json()) as {
			data: Array<{ embedding: number[]; index: number }>;
		};

		// Sort by index to preserve input order
		const sorted = json.data.sort((a, b) => a.index - b.index);
		return sorted.map((d) => new Float32Array(d.embedding));
	}
}
