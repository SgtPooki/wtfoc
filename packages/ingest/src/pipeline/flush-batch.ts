import type { Chunk, CollectionHead, Embedder, ManifestStore } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { mergeEdges } from "../edges/merge.js";
import { HeuristicChunkScorer } from "../scoring.js";
import { buildSegment, extractSegmentMetadata, segmentId } from "../segment-builder.js";
import type { CreateEdgeExtractorFn, LogSink, PublishSegmentFn } from "./types.js";

export interface FlushBatchDeps {
	embedder: Embedder;
	publishSegment: PublishSegmentFn;
	manifests: ManifestStore;
	createEdgeExtractor: CreateEdgeExtractorFn;
	adapterExtractEdges: (chunks: Chunk[]) => Promise<
		Array<{
			type: string;
			sourceId: string;
			targetType: string;
			targetId: string;
			evidence: string;
			confidence: number;
		}>
	>;
	collectionName: string;
	collectionId: string;
	modelName: string;
	description: string | undefined;
	log: LogSink;
	batchNumber: number;
}

export interface FlushBatchResult {
	chunksIngested: number;
}

/**
 * Embed a batch of chunks, extract edges, build segment, publish, and update manifest.
 * Extracted from ingest.ts flushBatch closure (lines 359-484).
 */
export async function flushBatch(
	batchChunks: Chunk[],
	deps: FlushBatchDeps,
): Promise<FlushBatchResult> {
	if (batchChunks.length === 0) return { chunksIngested: 0 };

	// Extract edges for this batch
	const extractor = deps.createEdgeExtractor();
	const edges = mergeEdges([
		{ extractorName: "adapter", edges: await deps.adapterExtractEdges(batchChunks) },
		{ extractorName: "composite", edges: await extractor.extract(batchChunks) },
	]);

	// Embed this batch
	deps.log({
		level: "info",
		phase: "embed",
		message: `Embedding batch ${deps.batchNumber} (${batchChunks.length} chunks)...`,
	});
	const embeddings = await deps.embedder.embedBatch(batchChunks.map((c) => c.content));

	const scorer = new HeuristicChunkScorer();
	const signalScoresBatch = scorer.scoreBatch(
		batchChunks.map((c) => ({ content: c.content, sourceType: c.sourceType })),
	);

	const segmentChunks = batchChunks.map((chunk, i) => {
		const emb = embeddings[i];
		if (!emb)
			throw new Error(
				`Missing embedding for chunk ${i} — expected ${batchChunks.length} embeddings`,
			);
		return {
			chunk,
			embedding: Array.from(emb),
			signalScores: signalScoresBatch[i],
		};
	});

	const segment = buildSegment(segmentChunks, edges, {
		embeddingModel: deps.modelName,
		embeddingDimensions: deps.embedder.dimensions,
	});

	const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
	const segId = segmentId(segment);

	// Publish segment via injected function (handles FOC vs local)
	const publishResult = await deps.publishSegment(segmentBytes, segId);
	const resultId = publishResult.resultId;
	const batchForManifest = publishResult.batchRecord;

	// Re-read head for each batch to avoid manifest conflicts
	const currentHead = await deps.manifests.getHead(deps.collectionName);
	const currentPrevHeadId = currentHead ? currentHead.headId : null;

	const manifest: CollectionHead = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		collectionId: currentHead?.manifest.collectionId ?? deps.collectionId,
		name: deps.collectionName,
		description: currentHead?.manifest.description ?? deps.description,
		currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
		prevHeadId: currentPrevHeadId,
		segments: [
			...(currentHead?.manifest.segments ?? []),
			{
				id: resultId,
				sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
				chunkCount: batchChunks.length,
				...extractSegmentMetadata(batchChunks),
			},
		],
		totalChunks: (currentHead?.manifest.totalChunks ?? 0) + batchChunks.length,
		embeddingModel: deps.modelName,
		embeddingDimensions: deps.embedder.dimensions,
		createdAt: currentHead?.manifest.createdAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	if (batchForManifest || currentHead?.manifest.batches) {
		manifest.batches = [
			...(currentHead?.manifest.batches ?? []),
			...(batchForManifest ? [batchForManifest] : []),
		];
	}

	await deps.manifests.putHead(deps.collectionName, manifest, currentPrevHeadId);

	return { chunksIngested: batchChunks.length };
}
