import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Embedder, PoolingStrategy, PrefixFormatter } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSIONS = 384;

export interface TransformersEmbedderOptions {
	dtype?: string;
	dimensions?: number;
	pooling?: PoolingStrategy;
	prefix?: PrefixFormatter;
}

/**
 * Local embedder using @huggingface/transformers with lazy model initialization.
 * Downloads and caches the model on first use.
 *
 * Model, dimensions, and pooling strategy are all configurable.
 * If dimensions is not provided, it defaults to 384 (MiniLM) but will be
 * auto-detected from the first pipeline output when possible.
 */
export class TransformersEmbedder implements Embedder {
	#dimensions: number;
	readonly model: string;
	readonly pooling: PoolingStrategy;
	readonly prefix?: PrefixFormatter;
	readonly #dtype: string;

	#pipeline: FeatureExtractionPipeline | null = null;
	#initPromise: Promise<void> | null = null;
	#dimensionsDetected = false;

	get dimensions(): number {
		return this.#dimensions;
	}

	constructor(model: string = DEFAULT_MODEL, options?: TransformersEmbedderOptions) {
		this.model = model;
		this.#dtype = options?.dtype ?? "fp32";
		this.#dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;
		this.pooling = options?.pooling ?? "mean";
		this.prefix = options?.prefix;
		if (options?.dimensions != null) {
			this.#dimensionsDetected = true;
		}
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
						options?: Record<string, unknown>,
					) => Promise<FeatureExtractionPipeline>;
					this.#pipeline = await pipelineFn("feature-extraction", this.model, {
						dtype: this.#dtype,
					} as Record<string, unknown>);
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

	#applyPrefix(text: string, kind: "query" | "document"): string {
		if (!this.prefix) return text;
		const pfx = kind === "query" ? this.prefix.query : this.prefix.document;
		return pfx ? `${pfx}${text}` : text;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		await this.#ensureReady(signal);
		signal?.throwIfAborted();
		try {
			const pipeline = this.#getPipeline();
			const output = await pipeline(this.#applyPrefix(text, "query"), {
				pooling: this.pooling,
				normalize: true,
			});
			if (!(output.data instanceof Float32Array)) {
				throw new Error(`Expected Float32Array from pipeline, got ${typeof output.data}`);
			}
			const data = new Float32Array(output.data);
			if (!this.#dimensionsDetected) {
				this.#dimensions = data.length;
				this.#dimensionsDetected = true;
			}
			return data;
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
			const prefixed = texts.map((t) => this.#applyPrefix(t, "document"));
			const output = await pipeline(prefixed, {
				pooling: this.pooling,
				normalize: true,
			});
			if (!(output.data instanceof Float32Array)) {
				throw new Error(`Expected Float32Array from pipeline, got ${typeof output.data}`);
			}
			const data = output.data;
			if (!this.#dimensionsDetected && data.length > 0) {
				this.#dimensions = data.length / texts.length;
				this.#dimensionsDetected = true;
			}
			const dims = this.#dimensions;
			const results: Float32Array[] = [];
			for (let i = 0; i < texts.length; i++) {
				results.push(new Float32Array(data.buffer, i * dims * 4, dims));
			}
			return results;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			if (err instanceof EmbedFailedError) throw err;
			throw new EmbedFailedError(this.model, err);
		}
	}
}
