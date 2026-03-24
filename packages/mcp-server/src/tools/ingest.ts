import {
	type Chunk,
	type CollectionHead,
	CURRENT_SCHEMA_VERSION,
	type Embedder,
} from "@wtfoc/common";
import { buildSegment, getAdapter, RegexEdgeExtractor, segmentId } from "@wtfoc/ingest";
import { type createStore, generateCollectionId } from "@wtfoc/store";

function parseSinceDuration(duration: string): string {
	const match = duration.match(/^(\d+)([dh])$/);
	if (!match?.[1] || !match[2]) {
		throw new Error(
			`Invalid --since format: "${duration}". Use <number>d (days) or <number>h (hours). Example: 90d`,
		);
	}
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	const now = new Date();
	if (unit === "d") now.setDate(now.getDate() - value);
	else if (unit === "h") now.setHours(now.getHours() - value);
	return now.toISOString();
}

export async function handleIngest(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	modelName: string,
	params: { sourceType: string; source: string; collection: string; since?: string },
): Promise<string> {
	const maybeAdapter = getAdapter(params.sourceType);
	if (!maybeAdapter) {
		throw new Error(
			`Unknown source type: "${params.sourceType}". Check wtfoc_list_sources for available types.`,
		);
	}
	const adapter = maybeAdapter;

	// Get or create manifest
	const head = await store.manifests.getHead(params.collection);
	let prevHeadId: string | null = null;
	if (head) {
		prevHeadId = head.headId;
	}

	// Check model mismatch
	if (
		head &&
		head.manifest.embeddingModel !== "pending" &&
		head.manifest.embeddingModel !== modelName
	) {
		throw new Error(
			`Model mismatch: collection uses "${head.manifest.embeddingModel}" but embedder is "${modelName}". ` +
				"Mixed embeddings will produce poor search results.",
		);
	}

	// Build raw config
	const rawConfig: Record<string, unknown> = { source: params.source };
	if (params.since) rawConfig.since = parseSinceDuration(params.since);

	const config = adapter.parseConfig(rawConfig);
	const maxBatch = 500;

	// Build dedup set from existing segments
	const knownChunkIds = new Set<string>();
	if (head) {
		for (const segSummary of head.manifest.segments) {
			try {
				const segBytes = await store.storage.download(segSummary.id);
				const seg = JSON.parse(new TextDecoder().decode(segBytes));
				for (const c of seg.chunks) {
					knownChunkIds.add(c.id);
				}
			} catch {
				// Segment may not be downloadable, skip
			}
		}
	}

	let batch: Chunk[] = [];
	let totalChunksIngested = 0;
	let totalChunksSkipped = 0;
	let batchNumber = 0;

	async function flushBatch(batchChunks: Chunk[]): Promise<void> {
		if (batchChunks.length === 0) return;
		batchNumber++;

		const edgeExtractor = new RegexEdgeExtractor();
		const edges = [...adapter.extractEdges(batchChunks), ...edgeExtractor.extract(batchChunks)];

		const embeddings = await embedder.embedBatch(batchChunks.map((c) => c.content));

		const segmentChunks = batchChunks.map((chunk, i) => {
			const emb = embeddings[i];
			if (!emb)
				throw new Error(
					`Missing embedding for chunk ${i} — expected ${batchChunks.length} embeddings`,
				);
			return { chunk, embedding: Array.from(emb) };
		});

		const segment = buildSegment(segmentChunks, edges, {
			embeddingModel: modelName,
			embeddingDimensions: embedder.dimensions,
		});

		const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
		const segId = segmentId(segment);

		const segmentResult = await store.storage.upload(segmentBytes);
		const resultId = segmentResult.id;

		// Re-read head to avoid manifest conflicts
		const currentHead = await store.manifests.getHead(params.collection);
		const currentPrevHeadId = currentHead ? currentHead.headId : null;

		const manifest: CollectionHead = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(params.collection),
			name: params.collection,
			currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
			prevHeadId: currentPrevHeadId,
			segments: [
				...(currentHead?.manifest.segments ?? []),
				{
					id: resultId,
					sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
					chunkCount: batchChunks.length,
				},
			],
			totalChunks: (currentHead?.manifest.totalChunks ?? 0) + batchChunks.length,
			embeddingModel: modelName,
			embeddingDimensions: embedder.dimensions,
			createdAt: currentHead?.manifest.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await store.manifests.putHead(params.collection, manifest, currentPrevHeadId);
		totalChunksIngested += batchChunks.length;
	}

	// Stream chunks from adapter, flushing each batch
	for await (const chunk of adapter.ingest(config)) {
		if (knownChunkIds.has(chunk.id)) {
			totalChunksSkipped++;
			continue;
		}
		batch.push(chunk);
		if (batch.length >= maxBatch) {
			await flushBatch(batch);
			batch = [];
		}
	}
	await flushBatch(batch);

	const summary = {
		chunksIngested: totalChunksIngested,
		chunksSkipped: totalChunksSkipped,
		batches: batchNumber,
		source: params.source,
		sourceType: params.sourceType,
		collection: params.collection,
	};
	return JSON.stringify(summary, null, 2);
}
