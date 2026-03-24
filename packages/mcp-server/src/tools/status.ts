import type { createStore } from "@wtfoc/store";

export async function handleStatus(
	store: ReturnType<typeof createStore>,
	params: { collection: string },
): Promise<string> {
	const head = await store.manifests.getHead(params.collection);
	if (!head) {
		throw new Error(`Collection "${params.collection}" not found`);
	}

	const status = {
		collection: params.collection,
		totalChunks: head.manifest.totalChunks,
		segments: head.manifest.segments.length,
		embeddingModel: head.manifest.embeddingModel,
		embeddingDimensions: head.manifest.embeddingDimensions,
		createdAt: head.manifest.createdAt,
		updatedAt: head.manifest.updatedAt,
	};
	return JSON.stringify(status, null, 2);
}
