import {
	type Chunk,
	type CollectionHead,
	CURRENT_SCHEMA_VERSION,
	type Segment,
} from "@wtfoc/common";
import { buildSegment, DEFAULT_MAX_CHUNK_CHARS, rechunkOversized, segmentId } from "@wtfoc/ingest";
import { bundleAndUpload, generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getStore,
	withEmbedderOptions,
} from "../helpers.js";

export function registerReindexCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("reindex")
			.description(
				"Re-embed a collection with a new embedding model (optionally re-chunk oversized content)",
			)
			.requiredOption("-c, --collection <name>", "Source collection name")
			.option("--target <name>", "Target collection name (default: overwrite source)")
			.option("--batch-size <number>", "Chunks per embedding batch", "500")
			.option("--rechunk", "Re-chunk oversized content before re-embedding")
			.option(
				"--max-chunk-chars <number>",
				`Max chars per chunk when rechunking (default: ${DEFAULT_MAX_CHUNK_CHARS})`,
			),
	).action(
		async (
			opts: {
				collection: string;
				target?: string;
				batchSize: string;
				rechunk?: boolean;
				maxChunkChars?: string;
			} & EmbedderOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const { embedder, modelName } = createEmbedder(opts);
			const storageType = (program.opts().storage ?? "local") as string;
			const batchSize = Number.parseInt(opts.batchSize, 10);
			const targetName = opts.target ?? opts.collection;

			// Load the source collection
			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			const oldModel = head.manifest.embeddingModel;
			if (oldModel === modelName && targetName === opts.collection && !opts.rechunk) {
				console.error(`Collection already uses model "${modelName}". Nothing to do.`);
				console.error(`   Use --rechunk to re-chunk oversized content with the same model.`);
				process.exit(0);
			}

			// Probe embed to detect dimensions (OpenAI-compatible embedders auto-detect on first call)
			if (format !== "quiet") console.error("⏳ Detecting embedding dimensions...");
			await embedder.embed("dimension probe");

			if (format !== "quiet") {
				console.error(
					`🔄 Re-indexing "${opts.collection}"${targetName !== opts.collection ? ` → "${targetName}"` : ""}`,
				);
				console.error(`   Old model: ${oldModel} (${head.manifest.embeddingDimensions}d)`);
				console.error(`   New model: ${modelName} (${embedder.dimensions}d)`);
				console.error(
					`   Segments: ${head.manifest.segments.length}, Chunks: ${head.manifest.totalChunks}`,
				);
			}

			// Load all existing segments and extract chunks + edges, preserving embeddings
			const allChunks: Chunk[] = [];
			const allEdges: import("@wtfoc/common").Edge[] = [];
			const existingEmbeddings = new Map<string, number[]>();

			for (const segSummary of head.manifest.segments) {
				const segBytes = await store.storage.download(segSummary.id);
				const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;

				for (const c of segment.chunks) {
					allChunks.push({
						id: c.id,
						content: c.content,
						sourceType: c.sourceType,
						source: c.source,
						sourceUrl: c.sourceUrl,
						timestamp: c.timestamp,
						chunkIndex: 0,
						totalChunks: 0,
						metadata: c.metadata,
					});
					existingEmbeddings.set(c.id, c.embedding);
				}

				for (const e of segment.edges) {
					allEdges.push(e);
				}
			}

			if (format !== "quiet") {
				console.error(`   Loaded ${allChunks.length} chunks and ${allEdges.length} edges`);
			}

			// Partial rechunk: only re-chunk oversized, preserve chunks within limit
			const preservedChunks: Array<{ chunk: Chunk; embedding: number[] }> = [];
			let chunksToEmbed: Chunk[] = [];

			if (opts.rechunk) {
				const maxChars = opts.maxChunkChars
					? Number.parseInt(opts.maxChunkChars, 10)
					: (embedder.maxInputChars ?? DEFAULT_MAX_CHUNK_CHARS);

				const withinLimit: Chunk[] = [];
				const oversized: Chunk[] = [];
				for (const chunk of allChunks) {
					if (chunk.content.length <= maxChars) {
						withinLimit.push(chunk);
					} else {
						oversized.push(chunk);
					}
				}

				// Preserve within-limit chunks with their original embeddings (FR-007, FR-008)
				const sameModel = oldModel === modelName;
				if (sameModel) {
					for (const chunk of withinLimit) {
						const emb = existingEmbeddings.get(chunk.id);
						if (emb) {
							preservedChunks.push({ chunk, embedding: emb });
						} else {
							chunksToEmbed.push(chunk);
						}
					}
				} else {
					// Model changed — must re-embed everything
					chunksToEmbed.push(...withinLimit);
				}

				// Re-chunk oversized, then add to embed queue
				const rechunked = rechunkOversized(oversized, maxChars);
				chunksToEmbed.push(...rechunked);

				if (format !== "quiet") {
					if (preservedChunks.length > 0) {
						console.error(
							`   Preserved ${preservedChunks.length} chunks, re-chunked ${oversized.length} oversized → ${rechunked.length} new chunks`,
						);
					} else if (oversized.length > 0) {
						console.error(
							`   Re-chunked: ${allChunks.length} → ${withinLimit.length + rechunked.length} chunks (max ${maxChars} chars)`,
						);
					}
				}
			} else {
				// No rechunk — re-embed all chunks (model change or target change)
				chunksToEmbed = [...allChunks];
			}

			// Re-embed in batches, writing manifest after each batch for crash resilience
			let chunksProcessed = 0;

			// Build the full list: preserved first, then to-embed in batches
			const allSegmentChunks: Array<{ chunk: Chunk; embedding: number[] }> = [...preservedChunks];

			for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
				const batchChunks = chunksToEmbed.slice(i, i + batchSize);
				const batchNum = Math.floor(i / batchSize) + 1;
				const totalBatches = Math.ceil(chunksToEmbed.length / batchSize);

				if (format !== "quiet" && chunksToEmbed.length > 0) {
					console.error(
						`⏳ Embedding batch ${batchNum}/${totalBatches} (${batchChunks.length} chunks)...`,
					);
				}

				const embeddings = await embedder.embedBatch(batchChunks.map((c) => c.content));

				for (let j = 0; j < batchChunks.length; j++) {
					const chunk = batchChunks[j];
					const emb = embeddings[j];
					if (!chunk || !emb) {
						throw new Error(
							`Missing embedding for chunk ${j} — expected ${batchChunks.length} embeddings`,
						);
					}
					allSegmentChunks.push({ chunk, embedding: Array.from(emb) });
				}
			}

			// Now write segments from allSegmentChunks in batch-sized groups
			for (let i = 0; i < allSegmentChunks.length; i += batchSize) {
				const batchEntries = allSegmentChunks.slice(i, i + batchSize);
				const batchChunks = batchEntries.map((e) => e.chunk);
				const batchEdges = allEdges.filter((e) => batchChunks.some((c) => c.id === e.sourceId));

				const segmentChunks = batchEntries;

				const segment = buildSegment(segmentChunks, batchEdges, {
					embeddingModel: modelName,
					embeddingDimensions: embedder.dimensions,
				});

				const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
				const segId = segmentId(segment);

				let resultId: string;
				let batchRecord: import("@wtfoc/common").BatchRecord | undefined;

				if (storageType === "foc") {
					if (format !== "quiet") console.error("⏳ Bundling into CAR...");
					const bundleResult = await bundleAndUpload(
						[{ id: segId, data: segmentBytes }],
						store.storage,
					);
					resultId = bundleResult.segmentCids.get(segId) ?? segId;
					batchRecord = bundleResult.batch;
				} else {
					const segmentResult = await store.storage.upload(segmentBytes);
					resultId = segmentResult.id;
				}

				if (format !== "quiet") {
					console.error(`   Segment stored: ${resultId.slice(0, 16)}...`);
				}

				chunksProcessed += batchChunks.length;

				// Write manifest after each batch for crash resilience
				const currentTarget = await store.manifests.getHead(targetName);
				const prevHeadId = currentTarget ? currentTarget.headId : null;

				const manifest: CollectionHead = {
					schemaVersion: CURRENT_SCHEMA_VERSION,
					collectionId: currentTarget?.manifest.collectionId ?? generateCollectionId(targetName),
					name: targetName,
					currentRevisionId: currentTarget?.manifest.currentRevisionId ?? null,
					prevHeadId,
					segments: [
						...(currentTarget?.manifest.segments ?? []),
						{
							id: resultId,
							sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
							chunkCount: batchChunks.length,
						},
					],
					totalChunks: chunksProcessed,
					embeddingModel: modelName,
					embeddingDimensions: embedder.dimensions,
					createdAt: currentTarget?.manifest.createdAt ?? head.manifest.createdAt,
					updatedAt: new Date().toISOString(),
				};

				if (batchRecord || currentTarget?.manifest.batches) {
					manifest.batches = [
						...(currentTarget?.manifest.batches ?? []),
						...(batchRecord ? [batchRecord] : []),
					];
				}

				await store.manifests.putHead(targetName, manifest, prevHeadId);
			}

			if (format === "json") {
				console.log(
					JSON.stringify({
						source: opts.collection,
						target: targetName,
						oldModel,
						newModel: modelName,
						chunks: chunksProcessed,
					}),
				);
			} else if (format !== "quiet") {
				console.error(
					`\n✅ Re-indexed "${opts.collection}"${targetName !== opts.collection ? ` → "${targetName}"` : ""}`,
				);
				console.error(`   ${chunksProcessed} chunks re-embedded with ${modelName}`);
				console.error(`   Old segments preserved (immutable audit trail)`);
			}

			// synapse-sdk keeps HTTP connections alive with no cleanup method
			if (storageType === "foc") process.exit(0);
		},
	);
}
