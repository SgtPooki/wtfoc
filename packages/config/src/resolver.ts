import type { ProjectConfig, ResolvedConfig } from "@wtfoc/common";
import { resolveUrlShortcut } from "./shortcuts.js";

export interface ConfigSources {
	cli?: {
		embedderUrl?: string;
		embedderModel?: string;
		embedderKey?: string;
		extractorEnabled?: boolean;
		extractorUrl?: string;
		extractorModel?: string;
		extractorKey?: string;
		extractorTimeout?: number;
		extractorConcurrency?: number;
	};
	file?: ProjectConfig;
}

export function resolveConfig(sources: ConfigSources): ResolvedConfig {
	const cli = sources.cli;
	const file = sources.file;

	const rawEmbedderUrl = cli?.embedderUrl ?? file?.embedder?.url ?? process.env.WTFOC_EMBEDDER_URL;

	const embedderUrl = rawEmbedderUrl ? resolveUrlShortcut(rawEmbedderUrl) : undefined;

	const embedderModel =
		cli?.embedderModel ?? file?.embedder?.model ?? process.env.WTFOC_EMBEDDER_MODEL;

	const embedderKey =
		cli?.embedderKey ??
		file?.embedder?.key ??
		process.env.WTFOC_EMBEDDER_KEY ??
		process.env.WTFOC_OPENAI_API_KEY;

	const extractorEnabledRaw =
		cli?.extractorEnabled ?? file?.extractor?.enabled ?? process.env.WTFOC_EXTRACTOR_ENABLED;
	const extractorEnabled =
		typeof extractorEnabledRaw === "boolean" ? extractorEnabledRaw : extractorEnabledRaw === "true";

	const rawExtractorUrl =
		cli?.extractorUrl ?? file?.extractor?.url ?? process.env.WTFOC_EXTRACTOR_URL;

	const extractorUrl = rawExtractorUrl ? resolveUrlShortcut(rawExtractorUrl) : undefined;

	const extractorModel =
		cli?.extractorModel ?? file?.extractor?.model ?? process.env.WTFOC_EXTRACTOR_MODEL;

	const extractorApiKey =
		cli?.extractorKey ?? file?.extractor?.apiKey ?? process.env.WTFOC_EXTRACTOR_API_KEY;

	const extractorTimeoutRaw =
		cli?.extractorTimeout ?? file?.extractor?.timeout ?? process.env.WTFOC_EXTRACTOR_TIMEOUT_MS;
	const parsedTimeout =
		typeof extractorTimeoutRaw === "number"
			? extractorTimeoutRaw
			: extractorTimeoutRaw
				? Number.parseInt(extractorTimeoutRaw, 10)
				: 20000;
	const extractorTimeout = Number.isNaN(parsedTimeout) ? 20000 : parsedTimeout;

	const extractorConcurrencyRaw =
		cli?.extractorConcurrency ??
		file?.extractor?.concurrency ??
		process.env.WTFOC_EXTRACTOR_MAX_CONCURRENCY;
	const parsedConcurrency =
		typeof extractorConcurrencyRaw === "number"
			? extractorConcurrencyRaw
			: extractorConcurrencyRaw
				? Number.parseInt(extractorConcurrencyRaw, 10)
				: 4;
	const extractorConcurrency = Number.isNaN(parsedConcurrency) ? 4 : parsedConcurrency;

	const ignorePatterns = file?.ignore ?? [];

	return {
		embedder: {
			url: embedderUrl,
			model: embedderModel,
			key: embedderKey,
		},
		extractor: {
			enabled: extractorEnabled,
			url: extractorUrl,
			model: extractorModel,
			apiKey: extractorApiKey,
			timeout: extractorTimeout,
			concurrency: extractorConcurrency,
		},
		ignore: ignorePatterns,
	};
}
