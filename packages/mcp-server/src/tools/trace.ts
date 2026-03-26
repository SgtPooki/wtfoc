import type { Embedder } from "@wtfoc/common";
import { type TraceMode, trace } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import { loadCollection } from "../helpers.js";
import type { CollectionLoader } from "../server.js";

async function resolveCollection(
	store: ReturnType<typeof createStore>,
	collection: string,
	collectionLoader?: CollectionLoader,
) {
	if (collectionLoader) {
		const loaded = await collectionLoader(collection);
		if (!loaded) throw new Error(`Collection "${collection}" not found`);
		return loaded;
	}
	const head = await store.manifests.getHead(collection);
	if (!head) throw new Error(`Collection "${collection}" not found`);
	return loadCollection(store, head.manifest);
}

export async function handleTrace(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: { query: string; collection: string; mode?: TraceMode },
	collectionLoader?: CollectionLoader,
): Promise<string> {
	const { vectorIndex, segments } = await resolveCollection(
		store,
		params.collection,
		collectionLoader,
	);
	const mode: TraceMode = params.mode ?? "discovery";
	const result = await trace(params.query, embedder, vectorIndex, segments, { mode });
	return JSON.stringify(result, null, 2);
}
