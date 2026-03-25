/**
 * Seed helpers — programmatically ingest fixture data into a local store.
 */
import type { CollectionHead, Embedder } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { buildSegment, chunkMarkdown, RegexEdgeExtractor } from "@wtfoc/ingest";
import type { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { generateCollectionId } from "@wtfoc/store";

export interface SeedOptions {
	storage: LocalStorageBackend;
	manifests: LocalManifestStore;
	embedder: Embedder;
}

export interface SeedResult {
	collectionName: string;
	headId: string;
	chunkCount: number;
}

export async function seedCollection(
	name: string,
	markdownSources: Array<{ source: string; content: string }>,
	opts: SeedOptions,
): Promise<SeedResult> {
	const { storage, manifests, embedder } = opts;
	let prevHeadId: string | null = null;
	let totalChunks = 0;
	const allSegmentRefs: CollectionHead["segments"] = [];

	for (const { source, content } of markdownSources) {
		const chunks = chunkMarkdown(content, {
			source,
			chunkSize: 500,
			chunkOverlap: 50,
		});
		if (chunks.length === 0) continue;

		const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));
		const edgeExtractor = new RegexEdgeExtractor();
		const edges = await edgeExtractor.extract(chunks);

		const segment = buildSegment(
			chunks.map((chunk, i) => {
				const emb = embeddings[i];
				if (!emb) throw new Error(`Missing embedding ${i}`);
				return { chunk, embedding: Array.from(emb) };
			}),
			edges,
			{ embeddingModel: embedder.model ?? "unknown", embeddingDimensions: embedder.dimensions },
		);

		const segBytes = new TextEncoder().encode(JSON.stringify(segment));
		const result = await storage.upload(segBytes);

		allSegmentRefs.push({
			id: result.id,
			sourceTypes: [...new Set(chunks.map((c) => c.sourceType))],
			chunkCount: chunks.length,
		});
		totalChunks += chunks.length;
	}

	const head: CollectionHead = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		collectionId: generateCollectionId(name),
		name,
		currentRevisionId: null,
		prevHeadId: null,
		segments: allSegmentRefs,
		totalChunks,
		embeddingModel: embedder.model ?? "unknown",
		embeddingDimensions: embedder.dimensions,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	const stored = await manifests.putHead(name, head, prevHeadId);
	return { collectionName: name, headId: stored.headId, chunkCount: totalChunks };
}
