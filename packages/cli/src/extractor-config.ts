/**
 * LLM edge extractor configuration resolver.
 *
 * Discriminated union: disabled (default) | enabled (requires url + model).
 * Precedence: CLI flags > env vars > defaults.
 *
 * .wtfoc.json support tracked in #39 (project config file).
 */

export type LlmExtractorConfig = LlmExtractorDisabled | LlmExtractorEnabled;

export interface LlmExtractorDisabled {
	enabled: false;
}

export interface LlmExtractorEnabled {
	enabled: true;
	baseUrl: string;
	model: string;
	apiKey?: string;
	jsonMode: "auto" | "on" | "off";
	timeoutMs: number;
	maxConcurrency: number;
	maxInputTokens: number;
}

export interface ExtractorCliOpts {
	extractorEnabled?: boolean;
	extractorUrl?: string;
	extractorModel?: string;
	extractorKey?: string;
	extractorJsonMode?: string;
	extractorTimeout?: string;
	extractorConcurrency?: string;
}

/**
 * URL shortcuts matching the embedder pattern.
 */
const URL_SHORTCUTS: Record<string, string> = {
	lmstudio: "http://localhost:1234/v1",
	ollama: "http://localhost:11434/v1",
};

/**
 * Resolve LLM extractor config from CLI flags and environment variables.
 * Returns disabled config by default.
 */
export function resolveExtractorConfig(opts: ExtractorCliOpts): LlmExtractorConfig {
	const enabled =
		opts.extractorEnabled ??
		(process.env.WTFOC_EXTRACTOR_ENABLED === "true" || process.env.WTFOC_EXTRACTOR_ENABLED === "1");

	if (!enabled) {
		return { enabled: false };
	}

	const rawUrl = opts.extractorUrl ?? process.env.WTFOC_EXTRACTOR_URL;
	if (!rawUrl) {
		throw new Error(
			"--extractor-url is required when LLM extraction is enabled. " +
				"Provide a base URL (e.g. http://localhost:1234/v1) or shortcut (lmstudio, ollama).",
		);
	}
	const baseUrl = URL_SHORTCUTS[rawUrl] ?? rawUrl;
	if (!baseUrl.startsWith("http")) {
		throw new Error(
			`--extractor-url must be a URL or shortcut (lmstudio, ollama). Got: "${rawUrl}"`,
		);
	}

	const model = opts.extractorModel ?? process.env.WTFOC_EXTRACTOR_MODEL;
	if (!model) {
		throw new Error(
			"--extractor-model is required when LLM extraction is enabled. " +
				"The model name must match what the server has loaded.",
		);
	}

	const apiKey = opts.extractorKey ?? process.env.WTFOC_EXTRACTOR_API_KEY;

	const jsonModeRaw = opts.extractorJsonMode ?? process.env.WTFOC_EXTRACTOR_JSON_MODE ?? "auto";
	const jsonMode = (["auto", "on", "off"].includes(jsonModeRaw) ? jsonModeRaw : "auto") as
		| "auto"
		| "on"
		| "off";

	const timeoutMs = Number.parseInt(
		opts.extractorTimeout ?? process.env.WTFOC_EXTRACTOR_TIMEOUT_MS ?? "60000",
		10,
	);

	const maxConcurrency = Number.parseInt(
		opts.extractorConcurrency ?? process.env.WTFOC_EXTRACTOR_MAX_CONCURRENCY ?? "4",
		10,
	);

	return {
		enabled: true,
		baseUrl,
		model,
		apiKey,
		jsonMode,
		timeoutMs: Number.isNaN(timeoutMs) ? 60000 : timeoutMs,
		maxConcurrency: Number.isNaN(maxConcurrency) ? 4 : maxConcurrency,
		maxInputTokens: 4000,
	};
}
