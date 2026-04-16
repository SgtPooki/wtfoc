import {
	type CollectionHead,
	type Embedder,
	type EmbedderProfile,
	type ResolvedEmbedderConfig,
	URL_SHORTCUTS,
} from "@wtfoc/common";
import { resolveUrlShortcut } from "@wtfoc/config";
import { AstChunker, registerChunker } from "@wtfoc/ingest";
import type { MountedCollection } from "@wtfoc/search";
import {
	InMemoryVectorIndex,
	mountCollection,
	OpenAIEmbedder,
	TransformersEmbedder,
} from "@wtfoc/search";
import { createStore, getLocalManifestDir } from "@wtfoc/store";
import type { Command } from "commander";
import type { OutputFormat } from "./output.js";

export interface EmbedderOpts {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
	embedderRateLimit?: string;
	embedderMaxRetries?: string;
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
		.option("--embedder-model <model>", "Embedder model name")
		.option(
			"--embedder-rate-limit <rpm>",
			"Max requests per minute (pre-emptive pacing for rate-limited APIs)",
		)
		.option(
			"--embedder-max-retries <n>",
			"Max retries on 429/5xx/transient provider errors (default: 8)",
		) as T;
}

export function withExtractorOptions<T extends Command>(cmd: T): T {
	return cmd
		.option("--extractor-enabled", "Enable LLM edge extraction")
		.option("--extractor-url <url>", "LLM API base URL (or shortcut: lmstudio, ollama)")
		.option("--extractor-model <model>", "LLM model name for edge extraction")
		.option("--extractor-key <key>", "LLM API key")
		.option("--extractor-json-mode <mode>", "JSON response mode: auto (default), on, off")
		.option("--extractor-timeout <ms>", "LLM request timeout in ms (default: 60000)")
		.option("--extractor-concurrency <n>", "Max parallel LLM requests (default: 4)")
		.option(
			"--extractor-max-input-tokens <n>",
			"Max input tokens per LLM request (default: 4000)",
		) as T;
}

export function withTreeSitterOptions<T extends Command>(cmd: T): T {
	return cmd.option(
		"--tree-sitter-url <url>",
		"Tree-sitter parser sidecar URL (env: WTFOC_TREE_SITTER_URL)",
	) as T;
}

/**
 * Resolve tree-sitter sidecar URL from CLI flag or environment variable.
 */
export function resolveTreeSitterUrl(opts: { treeSitterUrl?: string }): string | undefined {
	return opts.treeSitterUrl ?? process.env.WTFOC_TREE_SITTER_URL ?? undefined;
}

/**
 * Install `AstChunker` into the chunker registry when a tree-sitter sidecar
 * URL is available (#220 Session 2). Without this call the default registry
 * only has `ast-heuristic` — selectChunker() prefers "ast" if registered,
 * so this is the one line that flips ingest onto AST-aware chunking.
 *
 * Safe to call multiple times; re-registration overwrites the previous entry.
 * No-op when no sidecar URL is resolvable.
 *
 * @returns `true` when AstChunker was registered, `false` when the helper was
 *          a no-op. Callers use this for user-facing status output.
 */
export function registerAstChunkerIfAvailable(opts: { treeSitterUrl?: string }): boolean {
	const url = resolveTreeSitterUrl(opts);
	if (!url) return false;
	registerChunker(new AstChunker({ sidecarUrl: url }));
	return true;
}

export function getStore(program: Command) {
	const globalOpts = program.opts();
	const storageType = (globalOpts.storage ?? "local") as "local" | "foc";
	return createStore({ storage: storageType });
}

export function getManifestDir(store: Parameters<typeof getLocalManifestDir>[0]): string {
	return getLocalManifestDir(store);
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
function resolveProfile(resolvedConfig?: ResolvedEmbedderConfig): EmbedderProfile | undefined {
	const profileName = resolvedConfig?.profile;
	if (!profileName) return undefined;
	const profiles = resolvedConfig?.profiles ?? {};
	const profile = profiles[profileName];
	if (!profile) {
		const available = Object.keys(profiles);
		console.error(
			available.length > 0
				? `Unknown embedder profile: "${profileName}". Available: ${available.join(", ")}`
				: `Unknown embedder profile: "${profileName}". No profiles defined in .wtfoc.json — add embedder.profiles to your config.`,
		);
		process.exit(2);
	}
	return profile;
}

export function createEmbedder(
	opts: {
		embedder?: string;
		embedderUrl?: string;
		embedderKey?: string;
		embedderModel?: string;
		embedderRateLimit?: string;
		embedderMaxRetries?: string;
	},
	resolvedConfig?: ResolvedEmbedderConfig,
): { embedder: Embedder; modelName: string } {
	const profile = resolveProfile(resolvedConfig);

	const url =
		resolvedConfig?.url ?? (opts.embedderUrl ? resolveUrlShortcut(opts.embedderUrl) : undefined);
	const model = resolvedConfig?.model ?? opts.embedderModel ?? profile?.model;
	const key =
		resolvedConfig?.key ?? opts.embedderKey ?? process.env.WTFOC_OPENAI_API_KEY ?? "no-key";
	const type = opts.embedder ?? "local";
	const prefix = resolvedConfig?.prefix ?? profile?.prefix;
	// requestDimensions: only send in API body when user explicitly configured it
	// (profile dimensions are informational, not an API parameter)
	const explicitDimensions = resolvedConfig?.dimensions;
	const dimensions = explicitDimensions ?? profile?.dimensions;
	const pooling = resolvedConfig?.pooling ?? profile?.pooling;

	// API-based embedder (any OpenAI-compatible endpoint)
	if (url || type === "api" || type in URL_SHORTCUTS) {
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

		const rateLimitRpm = opts.embedderRateLimit
			? Number.parseFloat(opts.embedderRateLimit)
			: undefined;
		const minRequestIntervalMs =
			rateLimitRpm && rateLimitRpm > 0 ? Math.ceil(60_000 / rateLimitRpm) : undefined;
		const maxRetries = opts.embedderMaxRetries
			? Number.parseInt(opts.embedderMaxRetries, 10)
			: undefined;

		const embedder = new OpenAIEmbedder({
			apiKey: key,
			baseUrl,
			model,
			dimensions,
			requestDimensions: explicitDimensions,
			prefix,
			minRequestIntervalMs,
			maxRetries,
		});
		return { embedder, modelName: model };
	}

	// Default: local transformers.js (works everywhere, lower quality)
	if (type === "local" || type === "transformers") {
		const localModel = model ?? "Xenova/all-MiniLM-L6-v2";
		try {
			console.error(
				`ℹ️  Using local embedder: ${localModel} (${dimensions ?? "auto"}d). For better results, use --embedder-url lmstudio --embedder-model <model>`,
			);
			const embedder = new TransformersEmbedder(localModel, {
				dimensions,
				pooling,
				prefix,
			});
			return { embedder, modelName: localModel };
		} catch {
			const fallbackDims = dimensions ?? 384;
			console.error("⚠️  TransformersEmbedder unavailable, using zero-vector fallback");
			return {
				embedder: {
					dimensions: fallbackDims,
					async embed(): Promise<Float32Array> {
						return new Float32Array(fallbackDims);
					},
					async embedBatch(texts: string[]): Promise<Float32Array[]> {
						return texts.map(() => new Float32Array(fallbackDims));
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
	options?: { excludeChunkIds?: ReadonlySet<string> },
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	return mountCollection(manifest, store.storage, vectorIndex, {
		excludeChunkIds: options?.excludeChunkIds,
	});
}
