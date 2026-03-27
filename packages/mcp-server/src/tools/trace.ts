import type { Embedder } from "@wtfoc/common";
import { type TraceMode, trace } from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";
import type { CollectionLoader } from "../helpers.js";
import { resolveCollection } from "../helpers.js";

export async function handleTrace(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	params: {
		query: string;
		collection: string;
		mode?: TraceMode;
		maxTotal?: number;
		maxPerSource?: number;
		maxHops?: number;
	},
	collectionLoader?: CollectionLoader,
): Promise<string> {
	const { vectorIndex, segments } = await resolveCollection(
		store,
		params.collection,
		collectionLoader,
	);
	const mode: TraceMode = params.mode ?? "discovery";
	const result = await trace(params.query, embedder, vectorIndex, segments, {
		mode,
		maxTotal: params.maxTotal,
		maxPerSource: params.maxPerSource,
		maxHops: params.maxHops,
	});
	return JSON.stringify(result, null, 2);
}
