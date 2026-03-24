import type { Embedder } from "@wtfoc/common";
import { query } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import { loadCollection } from "../helpers.js";

export async function handleQuery(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: { queryText: string; collection: string; topK?: number },
): Promise<string> {
	const head = await store.manifests.getHead(params.collection);
	if (!head) {
		throw new Error(`Collection "${params.collection}" not found`);
	}

	const { vectorIndex } = await loadCollection(store, head.manifest);
	const result = await query(params.queryText, embedder, vectorIndex, {
		topK: params.topK ?? 10,
	});
	return JSON.stringify(result, null, 2);
}
