import type { Embedder, PrefixFormatter } from "@wtfoc/common";
import { EmbedFailedError } from "@wtfoc/common";

const DEFAULT_MODEL = "text-embedding-3-small";
const API_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MAX_RETRIES = 8;
const DEFAULT_INITIAL_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 60000;

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
	/** Max retries on retryable errors (429, 5xx, transient provider errors). Default: 8 */
	maxRetries?: number;
	/** Initial backoff delay in ms. Default: 2000 */
	initialDelayMs?: number;
	/** Max backoff delay in ms. Default: 60000 */
	maxDelayMs?: number;
	/**
	 * Minimum interval between requests in ms. Used to pre-emptively pace requests
	 * to respect provider rate limits (e.g. 3100ms ≈ 19 RPM). Default: 0 (no pacing).
	 */
	minRequestIntervalMs?: number;
	/**
	 * Base delay (ms) on provider routing errors (e.g. "No successful provider responses").
	 * Retries grow linearly: delay * (attempt + 1). Should be ≥ the provider's rate-limit
	 * window so old requests age out before retry. Default: 60000.
	 */
	providerErrorBaseDelayMs?: number;
	/**
	 * Optional per-call telemetry hook. Maintainer-only: dogfood and the
	 * autoresearch sweep harness pass a sink to capture token usage,
	 * response model id (drift detection), and call duration. Consumers
	 * leave this unset and pay zero overhead.
	 */
	usageSink?: (usage: {
		requestModelId: string;
		providerResponseModelId?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		durationMs: number;
	}) => void;
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
	readonly #maxRetries: number;
	readonly #initialDelayMs: number;
	readonly #maxDelayMs: number;
	readonly #minRequestIntervalMs: number;
	readonly #providerErrorBaseDelayMs: number;
	readonly #usageSink: OpenAIEmbedderOptions["usageSink"];
	#lastRequestAt = 0;

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
		this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.#initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
		this.#maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
		this.#minRequestIntervalMs = options.minRequestIntervalMs ?? 0;
		this.#providerErrorBaseDelayMs = options.providerErrorBaseDelayMs ?? 60_000;
		this.#usageSink = options.usageSink;

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

		// Pre-emptive pacing: enforce min interval between requests
		if (this.#minRequestIntervalMs > 0) {
			const elapsed = Date.now() - this.#lastRequestAt;
			const wait = this.#minRequestIntervalMs - elapsed;
			if (wait > 0) {
				await new Promise((resolve) => setTimeout(resolve, wait));
				signal?.throwIfAborted();
			}
		}
		this.#lastRequestAt = Date.now();
		const callStart = performance.now();

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
		const serializedBody = JSON.stringify(body);

		let lastError: unknown;
		for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
			signal?.throwIfAborted();

			let response: Response;
			try {
				response = await fetch(this.#baseUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.#apiKey}`,
					},
					body: serializedBody,
					signal,
				});
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") throw err;
				lastError = err;
				if (attempt < this.#maxRetries) {
					await this.#sleepBackoff(attempt, null, `network error: ${stringifyError(err)}`);
					continue;
				}
				throw new EmbedFailedError(this.model, err);
			}

			// Retryable HTTP status codes (429, 5xx)
			if (response.status === 429 || response.status >= 500) {
				const respBody = await response.text().catch(() => "");
				lastError = `HTTP ${response.status}: ${respBody.slice(0, 200)}`;
				if (attempt < this.#maxRetries) {
					const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
					await this.#sleepBackoff(attempt, retryAfter, `HTTP ${response.status}`);
					continue;
				}
				throw new EmbedFailedError(this.model, `HTTP ${response.status}: ${respBody}`);
			}

			if (!response.ok) {
				const respBody = await response.text().catch(() => "");
				throw new EmbedFailedError(this.model, `HTTP ${response.status}: ${respBody}`);
			}

			const json = await response.json().catch(() => null);

			// OpenRouter-style: 200 OK with an error body (transient provider errors).
			// Treat as retryable if the error looks transient (provider routing failed).
			if (json && typeof json === "object" && "error" in json) {
				const errObj = (json as { error?: { message?: string; code?: number } }).error;
				const errMsg = errObj?.message ?? "";
				const retryable = isTransientProviderError(errMsg);
				lastError = `Provider error: ${errMsg}`;
				if (retryable && attempt < this.#maxRetries) {
					// Provider routing failures are almost always rate-limit windows.
					// Wait long enough for the sliding window to clear: base delay on
					// first attempt, growing linearly — short retries would just burn
					// more window slots and dig deeper.
					const waitMs = this.#providerErrorBaseDelayMs * (attempt + 1);
					await this.#sleepBackoff(attempt, waitMs, `provider error: ${errMsg.slice(0, 80)}`);
					continue;
				}
				throw new EmbedFailedError(
					this.model,
					`Provider error: ${JSON.stringify(json).slice(0, 200)}`,
				);
			}

			const data = (json as { data?: unknown } | null)?.data;

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

			if (this.#usageSink) {
				const usage = (json as { usage?: { prompt_tokens?: number; total_tokens?: number } } | null)
					?.usage;
				const responseModel = (json as { model?: string } | null)?.model;
				this.#usageSink({
					requestModelId: this.model,
					providerResponseModelId: responseModel,
					promptTokens: usage?.prompt_tokens,
					totalTokens: usage?.total_tokens,
					durationMs: performance.now() - callStart,
				});
			}

			return sorted.map((d) => new Float32Array(d.embedding));
		}

		throw new EmbedFailedError(
			this.model,
			`Exhausted ${this.#maxRetries} retries. Last error: ${stringifyError(lastError)}`,
		);
	}

	async #sleepBackoff(attempt: number, retryAfterMs: number | null, reason: string): Promise<void> {
		// Honor Retry-After header if given; otherwise exponential backoff with full jitter.
		const base = Math.min(this.#initialDelayMs * 2 ** attempt, this.#maxDelayMs);
		const jittered = Math.floor(Math.random() * base);
		const delayMs = retryAfterMs ?? jittered;
		console.error(
			`⏳ OpenAIEmbedder retry ${attempt + 1}/${this.#maxRetries} after ${delayMs}ms (${reason})`,
		);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}

/**
 * Parse a Retry-After header value. Supports seconds (delta-seconds) and HTTP-date.
 * Returns milliseconds, or null if unparseable.
 */
function parseRetryAfter(value: string | null): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
	const parsed = Date.parse(value);
	if (Number.isFinite(parsed)) {
		const delta = parsed - Date.now();
		return delta > 0 ? delta : 0;
	}
	return null;
}

/**
 * Detect transient provider-side errors that are safe to retry.
 * OpenRouter returns 200 OK with `{error:{...}}` when upstream providers fail or throttle.
 */
function isTransientProviderError(message: string): boolean {
	if (!message) return false;
	const lower = message.toLowerCase();
	return (
		lower.includes("no successful provider responses") ||
		lower.includes("rate limit") ||
		lower.includes("rate-limit") ||
		lower.includes("overloaded") ||
		lower.includes("temporarily unavailable") ||
		lower.includes("timeout")
	);
}

function stringifyError(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}
