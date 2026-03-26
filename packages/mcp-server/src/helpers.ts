import type {
	CollectionHead,
	Embedder,
	EmbedderProfile,
	ResolvedEmbedderConfig,
} from "@wtfoc/common";
import { resolveUrlShortcut } from "@wtfoc/config";
import type { MountedCollection } from "@wtfoc/search";
import {
	InMemoryVectorIndex,
	mountCollection,
	OpenAIEmbedder,
	TransformersEmbedder,
} from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";

export type LoadedCollection = MountedCollection;

/**
 * Resolve a collection by name, returning the mounted vector index and segments.
 * When provided, MCP tools use this instead of loading from disk each request.
 */
export type CollectionLoader = (name: string) => Promise<{
	vectorIndex: import("@wtfoc/common").VectorIndex;
	segments: import("@wtfoc/common").Segment[];
} | null>;

export async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	return mountCollection(manifest, store.storage, vectorIndex);
}

function resolveProfile(resolvedConfig?: ResolvedEmbedderConfig): EmbedderProfile | undefined {
	const profileName = resolvedConfig?.profile ?? process.env.WTFOC_EMBEDDER_PROFILE;
	if (!profileName) return undefined;
	const profiles = resolvedConfig?.profiles ?? {};
	const profile = profiles[profileName];
	if (!profile) {
		const available = Object.keys(profiles);
		throw new Error(
			available.length > 0
				? `Unknown embedder profile: "${profileName}". Available: ${available.join(", ")}`
				: `Unknown embedder profile: "${profileName}". No profiles defined in .wtfoc.json — add embedder.profiles to your config.`,
		);
	}
	return profile;
}

/**
 * Resolve a collection using the injected loader (cache-aware) or fall back
 * to loading from disk. Shared by query and trace tool handlers.
 */
export async function resolveCollection(
	store: ReturnType<typeof createStore>,
	collection: string,
	collectionLoader?: CollectionLoader,
): Promise<LoadedCollection> {
	if (collectionLoader) {
		const loaded = await collectionLoader(collection);
		if (!loaded) throw new Error(`Collection "${collection}" not found`);
		return loaded as LoadedCollection;
	}
	const head = await store.manifests.getHead(collection);
	if (!head) throw new Error(`Collection "${collection}" not found`);
	return loadCollection(store, head.manifest);
}

/**
 * Create an embedder from resolved config or environment variables.
 *
 * When resolvedConfig is provided (from .wtfoc.json + env merge),
 * it takes priority. Otherwise falls back to env-var-only behavior.
 */
export function createEmbedder(resolvedConfig?: ResolvedEmbedderConfig): {
	embedder: Embedder;
	modelName: string;
} {
	const profile = resolveProfile(resolvedConfig);

	const url =
		resolvedConfig?.url ??
		(process.env.WTFOC_EMBEDDER_URL
			? resolveUrlShortcut(process.env.WTFOC_EMBEDDER_URL)
			: undefined);
	const model = resolvedConfig?.model ?? process.env.WTFOC_EMBEDDER_MODEL ?? profile?.model;
	const key =
		resolvedConfig?.key ?? process.env.WTFOC_EMBEDDER_KEY ?? process.env.WTFOC_OPENAI_API_KEY;
	const type = process.env.WTFOC_EMBEDDER ?? "local";
	const prefix = resolvedConfig?.prefix ?? profile?.prefix;
	const explicitDimensions = resolvedConfig?.dimensions;
	const dimensions = explicitDimensions ?? profile?.dimensions;
	const pooling = resolvedConfig?.pooling ?? profile?.pooling;

	if (type === "api" || url) {
		const baseUrl = url ?? resolveUrlShortcut(type);

		if (!baseUrl.startsWith("http")) {
			throw new Error(
				`WTFOC_EMBEDDER_URL must be a URL or shortcut (lmstudio, ollama). Got: "${baseUrl}"`,
			);
		}

		if (!model) {
			throw new Error(
				"WTFOC_EMBEDDER_MODEL is required for API embedders. " +
					"Set the env var to match the model your server has loaded.",
			);
		}

		const apiKey = key ?? "no-key";
		const embedder = new OpenAIEmbedder({
			apiKey,
			baseUrl,
			model,
			dimensions,
			requestDimensions: explicitDimensions,
			prefix,
		});
		return { embedder, modelName: model };
	}

	// Default: local transformers.js
	const localModel = model ?? "Xenova/all-MiniLM-L6-v2";
	try {
		const embedder = new TransformersEmbedder(localModel, {
			dimensions,
			pooling,
			prefix,
		});
		return { embedder, modelName: localModel };
	} catch {
		const fallbackDims = dimensions ?? 384;
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
