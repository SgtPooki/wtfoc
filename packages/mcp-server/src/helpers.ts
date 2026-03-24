import type {
	CollectionHead,
	Embedder,
	Segment,
	VectorEntry,
	VectorIndex,
} from "@wtfoc/common";
import {
	InMemoryVectorIndex,
	OpenAIEmbedder,
	TransformersEmbedder,
} from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";

export interface LoadedCollection {
	vectorIndex: VectorIndex;
	segments: Segment[];
}

/**
 * Load all segments from a collection into an in-memory vector index.
 * Adapted from packages/cli/src/cli.ts loadCollection.
 */
export async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	const segments: Segment[] = [];

	for (const segSummary of manifest.segments) {
		const segBytes = await store.storage.download(segSummary.id);
		const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
		segments.push(segment);

		const entries: VectorEntry[] = segment.chunks.map((c) => ({
			id: c.id,
			vector: new Float32Array(c.embedding),
			storageId: c.storageId || segSummary.id,
			metadata: {
				sourceType: c.sourceType,
				source: c.source,
				sourceUrl: c.sourceUrl ?? "",
				content: c.content,
				...c.metadata,
			},
		}));
		await vectorIndex.add(entries);
	}

	return { vectorIndex, segments };
}

/**
 * Create an embedder from environment variables.
 *
 * WTFOC_EMBEDDER=api + WTFOC_EMBEDDER_URL + WTFOC_EMBEDDER_MODEL → OpenAI-compatible API
 * Otherwise → local TransformersEmbedder (MiniLM, 384d)
 */
export function createEmbedder(): { embedder: Embedder; modelName: string } {
	const type = process.env["WTFOC_EMBEDDER"] ?? "local";
	const url = process.env["WTFOC_EMBEDDER_URL"];
	const model = process.env["WTFOC_EMBEDDER_MODEL"];
	const key = process.env["WTFOC_EMBEDDER_KEY"];

	if (type === "api" || url || model) {
		const urlShortcuts: Record<string, string> = {
			lmstudio: "http://localhost:1234/v1",
			ollama: "http://localhost:11434/v1",
		};
		const rawUrl = url ?? type;
		const baseUrl = urlShortcuts[rawUrl] ?? rawUrl;

		if (!baseUrl.startsWith("http")) {
			throw new Error(
				`WTFOC_EMBEDDER_URL must be a URL or shortcut (lmstudio, ollama). Got: "${rawUrl}"`,
			);
		}

		if (!model) {
			throw new Error(
				"WTFOC_EMBEDDER_MODEL is required for API embedders. " +
					"Set the env var to match the model your server has loaded.",
			);
		}

		const apiKey = key ?? process.env["WTFOC_OPENAI_API_KEY"] ?? "no-key";
		const embedder = new OpenAIEmbedder({ apiKey, baseUrl, model });
		return { embedder, modelName: model };
	}

	// Default: local transformers.js
	try {
		const embedder = new TransformersEmbedder();
		return { embedder, modelName: "Xenova/all-MiniLM-L6-v2" };
	} catch {
		// Fallback to zero-vector if transformers unavailable
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
