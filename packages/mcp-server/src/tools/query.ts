import type { Embedder } from "@wtfoc/common";
import { query } from "@wtfoc/search";
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

export async function handleQuery(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: { queryText: string; collection: string; topK?: number },
	collectionLoader?: CollectionLoader,
): Promise<string> {
	const { vectorIndex } = await resolveCollection(store, params.collection, collectionLoader);
	const result = await query(params.queryText, embedder, vectorIndex, {
		topK: params.topK ?? 10,
	});
	return JSON.stringify(result, null, 2);
}
