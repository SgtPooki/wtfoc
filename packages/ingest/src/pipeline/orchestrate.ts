import type { Chunk } from "@wtfoc/common";
import { catalogFilePath, createEmptyCatalog, readCatalog } from "../document-catalog.js";
import { archiveRawSource, createEmptyArchiveIndex, isArchived } from "../raw-source-archive.js";
import { replayFromArchive } from "../source-replay.js";
import { scanForReusableSources } from "../source-scanner.js";
import { buildDedupSetsFromCatalog, buildDedupSetsFromSegments } from "./build-dedup-sets.js";
import { reuseDonorSources } from "./donor-reuse.js";
import { flushBatch } from "./flush-batch.js";
import { decideCursorValue } from "./persist-cursor.js";
import { processStream } from "./process-stream.js";
import type { IngestOptions, IngestResult, OrchestrateDeps, PipelineState } from "./types.js";
import { handleRenames, updateCatalogFromChunks } from "./update-catalog.js";

/**
 * Main pipeline entry point. Wires all stages with explicit dependencies.
 * No global state, no CLI parsing — pure orchestration.
 */
export async function orchestrate(
	options: IngestOptions,
	deps: OrchestrateDeps,
): Promise<IngestResult> {
	const { store, embedder, adapter, log } = deps;

	// Use pre-loaded or create empty catalog and archive index
	const catalog = options.catalog ?? createEmptyCatalog(options.collectionId);
	const archiveIndex = options.archiveIndex ?? createEmptyArchiveIndex(options.collectionId);

	// Initialize pipeline state
	const state: PipelineState = {
		knownFingerprints: new Set(),
		knownChunkIds: new Set(),
		archiveIndex,
		catalog,
		catalogPendingChunks: new Map(),
		batch: [],
		batchNumber: 0,
		stats: {
			chunksIngested: 0,
			chunksSkipped: 0,
			chunksFiltered: 0,
			docsSuperseded: 0,
			archivedCount: 0,
			rechunkedCount: 0,
			reusedFromDonors: 0,
			donorCollectionNames: [],
			batchesWritten: 0,
		},
		maxTimestamp: "",
	};

	// Build dedup sets from existing catalog or segments
	const catalogHasEntries = Object.keys(catalog.documents).length > 0;
	const head = await store.manifests.getHead(options.collectionName);

	if (catalogHasEntries) {
		const dedupSets = buildDedupSetsFromCatalog(catalog);
		state.knownChunkIds = dedupSets.knownChunkIds;
		state.knownFingerprints = dedupSets.knownFingerprints;
		if (state.knownChunkIds.size > 0) {
			log({
				level: "info",
				phase: "dedup",
				message: `${state.knownChunkIds.size} existing chunks from catalog (fast dedup, ${state.knownFingerprints.size} fingerprints)`,
			});
		}
	} else if (head) {
		const segDedupSets = await buildDedupSetsFromSegments(head.manifest.segments, (id) =>
			store.storage.download(id),
		);
		state.knownChunkIds = segDedupSets.knownChunkIds;
		state.knownFingerprints = segDedupSets.knownFingerprints;
		if (state.knownChunkIds.size > 0) {
			log({
				level: "info",
				phase: "dedup",
				message: `${state.knownChunkIds.size} existing chunks from segments (legacy dedup)`,
			});
		}
	}

	// Cross-collection source reuse: pre-populate archive and dedup sets from donors
	if (options.manifestDir) {
		await reuseDonorSources(state, {
			sourceReuse: options.sourceReuse,
			isPartialRun: options.isPartialRun,
			sourceKey: options.sourceKey,
			collectionName: options.collectionName,
			manifestDir: options.manifestDir,
			listProjects: () => store.manifests.listProjects(),
			storage: store.storage,
			scanForReusable: scanForReusableSources,
			replayFromArchive,
			readDonorCatalog: async (collectionName) => {
				const catPath = catalogFilePath(options.manifestDir as string, collectionName);
				return readCatalog(catPath);
			},
			archiveRawSource: async (index, docId, versionId, rawContent, meta) => {
				await archiveRawSource(index, docId, versionId, rawContent, meta);
			},
			isArchived: (index, docId, versionId) => isArchived(index, docId, versionId),
			uploadData: async (data) => {
				const result = await store.storage.upload(data);
				return result.id;
			},
			log,
		});
	}

	// Stream and process chunks
	await processStream({
		state,
		adapterStream: adapter.ingest(options.adapterConfig),
		filters: options.filters,
		maxBatch: options.maxBatch,
		maxChunkChars: options.maxChunkChars,
		flushBatch: async (chunks: Chunk[]) => {
			if (chunks.length === 0) return;
			state.batchNumber++;
			const result = await flushBatch(chunks, {
				embedder,
				publishSegment: deps.publishSegment,
				manifests: store.manifests,
				createEdgeExtractor: deps.createEdgeExtractor,
				adapterExtractEdges: (c) => adapter.extractEdges(c),
				collectionName: options.collectionName,
				collectionId: options.collectionId,
				modelName: options.modelName,
				description: options.description,
				log,
				batchNumber: state.batchNumber,
			});
			state.stats.chunksIngested += result.chunksIngested;
			state.stats.batchesWritten++;
		},
		archiveRawSource: async (index, docId, versionId, rawContent, meta) => {
			await archiveRawSource(index, docId, versionId, rawContent, meta);
		},
		isArchived: (index, docId, versionId) => isArchived(index, docId, versionId),
		uploadData: async (data) => {
			const result = await store.storage.upload(data);
			return result.id;
		},
		sourceKey: options.sourceKey,
		log,
	});

	// Update catalog from pending chunks
	let catalogModified = false;
	if (state.catalogPendingChunks.size > 0) {
		const catalogResult = updateCatalogFromChunks(
			state.catalog,
			state.catalogPendingChunks,
			options.appendOnlyTypes,
		);
		state.stats.docsSuperseded = catalogResult.docsSuperseded;
		catalogModified = true;
	}

	// Handle renames independently — can exist even with zero new chunks
	if (!options.isPartialRun && options.renames && options.renames.length > 0 && options.repoArg) {
		const renameCount = handleRenames(state.catalog, options.renames, options.repoArg);
		if (renameCount > 0) catalogModified = true;
	}

	// Determine emptiness
	const empty = state.stats.chunksIngested === 0 && state.stats.chunksSkipped === 0;

	// Decide cursor value
	const cursorDecision = decideCursorValue({
		isPartialRun: options.isPartialRun,
		repoHeadSha: options.repoHeadSha ?? null,
		maxTimestamp: state.maxTimestamp,
		existingCursorValue: options.existingCursorValue ?? null,
	});

	return {
		chunksIngested: state.stats.chunksIngested,
		chunksSkipped: state.stats.chunksSkipped,
		chunksFiltered: state.stats.chunksFiltered,
		docsSuperseded: state.stats.docsSuperseded,
		archivedCount: state.stats.archivedCount,
		rechunkedCount: state.stats.rechunkedCount,
		reusedFromDonors: state.stats.reusedFromDonors,
		donorCollectionNames: state.stats.donorCollectionNames,
		batchesWritten: state.stats.batchesWritten,
		empty,
		cursorValue: cursorDecision.cursorValue,
		cursorReason: cursorDecision.reason,
		catalog: state.catalog,
		archiveIndex: state.archiveIndex,
		catalogModified,
		catalogDocumentsUpdated: state.catalogPendingChunks.size,
	};
}
