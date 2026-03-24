import type { Embedder } from "@wtfoc/common";
import { trace } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import { loadCollection } from "../helpers.js";

export async function handleTrace(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: { query: string; collection: string },
): Promise<string> {
	const head = await store.manifests.getHead(params.collection);
	if (!head) {
		throw new Error(`Collection "${params.collection}" not found`);
	}

	const { vectorIndex, segments } = await loadCollection(store, head.manifest);
	const result = await trace(params.query, embedder, vectorIndex, segments);
	return JSON.stringify(result, null, 2);
}
