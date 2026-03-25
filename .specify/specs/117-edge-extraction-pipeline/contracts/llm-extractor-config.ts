/**
 * CONTRACT: LLM Edge Extractor Configuration
 *
 * Separate from embedder config. Supports CLI flags, env vars,
 * and .wtfoc.json project config.
 *
 * Uses discriminated union: disabled config requires no fields,
 * enabled config requires url + model.
 */

/**
 * Discriminated union for LLM extractor configuration.
 * When disabled (default), no url/model required.
 * When enabled, url and model are mandatory.
 */
export type LlmExtractorConfig = LlmExtractorDisabled | LlmExtractorEnabled;

export interface LlmExtractorDisabled {
	enabled: false;
}

export interface LlmExtractorEnabled {
	enabled: true;
	/** Provider type — only "openai-compatible" for v1 */
	provider: "openai-compatible";
	/** Base URL for the LLM API (e.g. http://localhost:1234/v1). Appends /chat/completions. */
	url: string;
	/** Model name (e.g. "Qwen2.5-Coder-32B-Instruct") */
	model: string;
	/** API key — optional for local servers */
	apiKey?: string;
	/** JSON response format mode */
	jsonMode: "auto" | "on" | "off";
	/** Request timeout in ms (default: 20000) */
	timeoutMs: number;
	/** Max parallel LLM requests (default: 4) */
	maxConcurrency: number;
	/** Max input tokens per request (default: 4000) */
	maxInputTokens: number;
}

/**
 * CLI flag names:
 *   --extractor-url       → url (base URL, like embedder)
 *   --extractor-model     → model
 *   --extractor-key       → apiKey
 *   --extractor-enabled   → enabled (presence = true)
 *   --extractor-json-mode → jsonMode
 *   --extractor-timeout   → timeoutMs
 *   --extractor-concurrency → maxConcurrency
 *
 * Environment variables:
 *   WTFOC_EXTRACTOR_URL
 *   WTFOC_EXTRACTOR_MODEL
 *   WTFOC_EXTRACTOR_API_KEY
 *   WTFOC_EXTRACTOR_ENABLED
 *   WTFOC_EXTRACTOR_TIMEOUT_MS
 *   WTFOC_EXTRACTOR_MAX_CONCURRENCY
 *
 * .wtfoc.json section:
 *   { "edgeExtraction": { enabled: true, url: "...", model: "...", ... } }
 *
 * Precedence: CLI flags > .wtfoc.json > env vars > defaults
 */
