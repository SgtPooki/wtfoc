import type { Embedder } from "@wtfoc/common";
import { type TraceMode, trace } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import type { CollectionLoader } from "../helpers.js";
import { resolveCollection } from "../helpers.js";

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
