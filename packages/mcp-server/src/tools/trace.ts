import type { Embedder } from "@wtfoc/common";
import { type TraceMode, trace } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import { loadCollection } from "../helpers.js";

export async function handleTrace(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: { query: string; collection: string; mode?: string },
): Promise<string> {
	const head = await store.manifests.getHead(params.collection);
	if (!head) {
		throw new Error(`Collection "${params.collection}" not found`);
	}

	const mode: TraceMode = params.mode === "analytical" ? "analytical" : "discovery";
	const { vectorIndex, segments } = await loadCollection(store, head.manifest);
	const result = await trace(params.query, embedder, vectorIndex, segments, { mode });
	return JSON.stringify(result, null, 2);
}
