import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Embedder } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;

/**
 * Local embedder using @huggingface/transformers with lazy model initialization.
 * Downloads and caches the model on first use.
 */
export class TransformersEmbedder implements Embedder {
	readonly dimensions = DIMENSIONS;
	readonly model: string;

	#pipeline: FeatureExtractionPipeline | null = null;
	#initPromise: Promise<void> | null = null;

	constructor(model: string = DEFAULT_MODEL) {
		this.model = model;
	}

	async #ensureReady(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		if (this.#pipeline) return;

		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const mod = await import("@huggingface/transformers");
					// Use explicit function reference to avoid TS2590 union type complexity
					const pipelineFn = mod.pipeline as (
						task: string,
						model: string,
					) => Promise<FeatureExtractionPipeline>;
					this.#pipeline = await pipelineFn("feature-extraction", this.model);
				} catch (err) {
					this.#initPromise = null;
					throw new EmbedFailedError(this.model, err);
				}
			})();
		}
		await this.#initPromise;
	}

	#getPipeline(): FeatureExtractionPipeline {
		if (!this.#pipeline) {
			throw new EmbedFailedError(
				this.model,
				new Error("Pipeline not initialized — call #ensureReady first"),
			);
		}
		return this.#pipeline;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		await this.#ensureReady(signal);
		signal?.throwIfAborted();
		try {
			const pipeline = this.#getPipeline();
			const output = await pipeline(text, {
				pooling: "mean",
				normalize: true,
			});
			if (!(output.data instanceof Float32Array)) {
				throw new Error(`Expected Float32Array from pipeline, got ${typeof output.data}`);
			}
			return new Float32Array(output.data);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			if (err instanceof EmbedFailedError) throw err;
			throw new EmbedFailedError(this.model, err);
		}
	}

	async embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		await this.#ensureReady(signal);
		signal?.throwIfAborted();
		try {
			const pipeline = this.#getPipeline();
			const output = await pipeline(texts, {
				pooling: "mean",
				normalize: true,
			});
			if (!(output.data instanceof Float32Array)) {
				throw new Error(`Expected Float32Array from pipeline, got ${typeof output.data}`);
			}
			const data = output.data;
			const results: Float32Array[] = [];
			for (let i = 0; i < texts.length; i++) {
				results.push(new Float32Array(data.buffer, i * this.dimensions * 4, this.dimensions));
			}
			return results;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			if (err instanceof EmbedFailedError) throw err;
			throw new EmbedFailedError(this.model, err);
		}
	}
}
