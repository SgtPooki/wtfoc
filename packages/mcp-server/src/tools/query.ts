import type { Embedder } from "@wtfoc/common";
import { query } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import type { CollectionLoader } from "../helpers.js";
import { resolveCollection } from "../helpers.js";

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
