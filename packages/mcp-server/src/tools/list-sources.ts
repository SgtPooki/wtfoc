import type { createStore } from "@wtfoc/store";

export async function handleListSources(store: ReturnType<typeof createStore>): Promise<string> {
	const names = await store.manifests.listProjects();

	if (names.length === 0) {
		return JSON.stringify([]);
	}

	const collections = await Promise.all(
		names.map(async (name) => {
			const head = await store.manifests.getHead(name);
			if (!head) return null;
			const m = head.manifest;
			return {
				name: m.name,
				description: m.description,
				chunks: m.totalChunks,
				segments: m.segments.length,
				model: m.embeddingModel,
				updated: m.updatedAt,
			};
		}),
	);

	return JSON.stringify(
		collections.filter((c) => c !== null),
		null,
		2,
	);
}
