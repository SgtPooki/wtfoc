import type { CollectionHead, Embedder, ResolvedEmbedderConfig } from "@wtfoc/common";
import { resolveUrlShortcut } from "@wtfoc/config";
import type { MountedCollection } from "@wtfoc/search";
import {
	InMemoryVectorIndex,
	mountCollection,
	OpenAIEmbedder,
	TransformersEmbedder,
} from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import type { Command } from "commander";
import type { OutputFormat } from "./output.js";

export interface EmbedderOpts {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}

export type LoadedCollection = MountedCollection;

export function parseSinceDuration(duration: string): string {
	const match = duration.match(/^(\d+)([dh])$/);
	if (!match?.[1] || !match[2]) {
		console.error(
			`Invalid --since format: "${duration}". Use <number>d (days) or <number>h (hours). Example: 90d`,
		);
		process.exit(2);
	}
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	const now = new Date();
	if (unit === "d") now.setDate(now.getDate() - value);
	else if (unit === "h") now.setHours(now.getHours() - value);
	return now.toISOString();
}

export function withEmbedderOptions<T extends Command>(cmd: T): T {
	return cmd
		.option(
			"--embedder <type>",
			"Embedder: local (default), api (requires --embedder-url + --embedder-model)",
		)
		.option("--embedder-url <url>", "Embedder API URL (or shortcut: lmstudio, ollama)")
		.option("--embedder-key <key>", "Embedder API key")
		.option("--embedder-model <model>", "Embedder model name") as T;
}

export function withExtractorOptions<T extends Command>(cmd: T): T {
	return cmd
		.option("--extractor-enabled", "Enable LLM edge extraction")
		.option("--extractor-url <url>", "LLM API base URL (or shortcut: lmstudio, ollama)")
		.option("--extractor-model <model>", "LLM model name for edge extraction")
		.option("--extractor-key <key>", "LLM API key")
		.option("--extractor-json-mode <mode>", "JSON response mode: auto (default), on, off")
		.option("--extractor-timeout <ms>", "LLM request timeout in ms (default: 60000)")
		.option("--extractor-concurrency <n>", "Max parallel LLM requests (default: 4)") as T;
}

export function getStore(program: Command) {
	const globalOpts = program.opts();
	const storageType = (globalOpts.storage ?? "local") as "local" | "foc";
	return createStore({ storage: storageType });
}

export function getFormat(opts: { json?: boolean; quiet?: boolean }): OutputFormat {
	if (opts.json) return "json";
	if (opts.quiet) return "quiet";
	return "human";
}

export function getFirstMatchGroup(
	match: RegExpMatchArray | RegExpExecArray,
	index = 1,
): string | null {
	return typeof match[index] === "string" ? match[index] : null;
}

/**
 * Create an embedder from resolved config or CLI flags.
 *
 * When resolvedConfig is provided (from .wtfoc.json + env + CLI merge),
 * it takes priority. Otherwise falls back to raw CLI opts for backwards compat.
 *
 * URL shortcuts (lmstudio, ollama) are resolved via @wtfoc/config.
 */
export function createEmbedder(
	opts: {
		embedder?: string;
		embedderUrl?: string;
		embedderKey?: string;
		embedderModel?: string;
	},
	resolvedConfig?: ResolvedEmbedderConfig,
): { embedder: Embedder; modelName: string } {
	const url =
		resolvedConfig?.url ?? (opts.embedderUrl ? resolveUrlShortcut(opts.embedderUrl) : undefined);
	const model = resolvedConfig?.model ?? opts.embedderModel;
	const key =
		resolvedConfig?.key ?? opts.embedderKey ?? process.env.WTFOC_OPENAI_API_KEY ?? "no-key";
	const type = opts.embedder ?? "local";

	// API-based embedder (any OpenAI-compatible endpoint)
	if (url || model || type === "api") {
		const baseUrl = url ?? resolveUrlShortcut(type);

		if (!baseUrl.startsWith("http")) {
			console.error(
				`Error: --embedder-url must be a URL or shortcut (lmstudio, ollama). Got: "${baseUrl}"`,
			);
			process.exit(2);
		}

		if (!model) {
			console.error("Error: --embedder-model is required for API embedders.");
			console.error("  The model name must match what the server has loaded.");
			console.error("  Example: --embedder-url lmstudio --embedder-model mxbai-embed-large-v1");
			process.exit(2);
		}

		const embedder = new OpenAIEmbedder({ apiKey: key, baseUrl, model });
		return { embedder, modelName: model };
	}

	// Default: local transformers.js (works everywhere, lower quality)
	if (type === "local" || type === "transformers") {
		try {
			console.error(
				"ℹ️  Using local MiniLM embedder (384d). For better results, use --embedder-url lmstudio --embedder-model <model>",
			);
			const embedder = new TransformersEmbedder();
			return { embedder, modelName: "Xenova/all-MiniLM-L6-v2" };
		} catch {
			console.error("⚠️  TransformersEmbedder unavailable, using zero-vector fallback");
			return {
				embedder: {
					dimensions: 384,
					async embed(): Promise<Float32Array> {
						return new Float32Array(384);
					},
					async embedBatch(texts: string[]): Promise<Float32Array[]> {
						return texts.map(() => new Float32Array(384));
					},
				},
				modelName: "zero-vector-fallback",
			};
		}
	}

	console.error(
		`Unknown embedder: "${type}". Use "local" or provide --embedder-url + --embedder-model.`,
	);
	process.exit(2);
}

export async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	return mountCollection(manifest, store.storage, vectorIndex);
}
