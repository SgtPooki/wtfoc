import type { Chunk } from "@wtfoc/common";
import { rechunkOversized } from "../chunker.js";
import type { RawSourceIndex } from "../raw-source-archive.js";
import type { DocumentFilters, LogSink, PipelineState } from "./types.js";

/**
 * Fields that are either derived (filePath, language, repo) or used internally
 * by the archive entry itself — they don't need to be duplicated into the
 * metadata payload.
 */
const ARCHIVE_METADATA_SKIP_FIELDS = new Set(["filePath", "language", "repo"]);

/**
 * Extract adapter-supplied metadata from a chunk for persisting in the raw
 * source archive. Coerces non-string values to strings so the archive schema
 * stays `Record<string, string>`. Returns undefined if nothing remains.
 */
export function pickArchiveMetadata(
	chunkMetadata: Record<string, string | number | boolean>,
): Record<string, string> | undefined {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(chunkMetadata)) {
		if (ARCHIVE_METADATA_SKIP_FIELDS.has(key)) continue;
		if (value === undefined || value === null) continue;
		out[key] = String(value);
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Pure filter: determines whether a chunk passes document-level filters.
 * Extracted from ingest.ts shouldIncludeChunk closure.
 */
export function shouldIncludeChunk(chunk: Chunk, filters: DocumentFilters): boolean {
	// --document-ids: only include chunks matching these document IDs
	if (filters.documentIds && chunk.documentId && !filters.documentIds.has(chunk.documentId)) {
		return false;
	}
	// --source-paths: only include chunks whose filePath metadata matches
	if (filters.sourcePaths) {
		const filePath = chunk.metadata.filePath;
		if (!filePath) return false;
		const matches = filters.sourcePaths.some((p) => filePath === p || filePath.startsWith(`${p}/`));
		if (!matches) return false;
	}
	// --changed-since: only include chunks with timestamps after the threshold
	if (filters.changedSinceMs != null) {
		const ts = chunk.timestamp ?? chunk.metadata.updatedAt ?? chunk.metadata.createdAt;
		if (!ts) return false;
		const chunkTime = new Date(ts).getTime();
		if (Number.isNaN(chunkTime) || chunkTime < filters.changedSinceMs) return false;
	}
	return true;
}

export interface ProcessStreamDeps {
	state: PipelineState;
	adapterStream: AsyncIterable<Chunk>;
	filters: DocumentFilters;
	maxBatch: number;
	maxChunkChars: number;
	flushBatch: (chunks: Chunk[]) => Promise<void>;
	archiveRawSource: (
		index: RawSourceIndex,
		docId: string,
		versionId: string,
		rawContent: string,
		meta: {
			sourceType: string;
			sourceUrl?: string;
			sourceKey: string;
			filePath?: string;
			metadata?: Record<string, string>;
			upload: (data: Uint8Array) => Promise<string>;
		},
	) => Promise<void>;
	isArchived: (index: RawSourceIndex, docId: string, versionId: string) => boolean;
	uploadData: (data: Uint8Array) => Promise<string>;
	sourceKey: string;
	log: LogSink;
}

/**
 * Stream chunks from adapter, rechunk oversized ones, archive raw sources,
 * apply filters, dedup, and flush batches.
 * Extracted from ingest.ts lines 568-642.
 */
export async function processStream(deps: ProcessStreamDeps): Promise<void> {
	const { state, filters } = deps;

	for await (const rawChunk of deps.adapterStream) {
		// Track max timestamp from source-provided data for cursor persistence
		const chunkTs =
			rawChunk.timestamp ?? rawChunk.metadata.updatedAt ?? rawChunk.metadata.createdAt ?? "";
		if (chunkTs > state.maxTimestamp) state.maxTimestamp = chunkTs;

		// Archive raw source content before chunking
		if (
			rawChunk.rawContent &&
			rawChunk.documentId &&
			rawChunk.documentVersionId &&
			!deps.isArchived(state.archiveIndex, rawChunk.documentId, rawChunk.documentVersionId)
		) {
			await deps.archiveRawSource(
				state.archiveIndex,
				rawChunk.documentId,
				rawChunk.documentVersionId,
				rawChunk.rawContent,
				{
					sourceType: rawChunk.sourceType,
					sourceUrl: rawChunk.sourceUrl,
					sourceKey: deps.sourceKey,
					filePath:
						typeof rawChunk.metadata.filePath === "string" ? rawChunk.metadata.filePath : undefined,
					metadata: pickArchiveMetadata(rawChunk.metadata),
					upload: deps.uploadData,
				},
			);
			state.stats.archivedCount++;
		}
		// Strip rawContent before further processing (not persisted in segments)
		delete rawChunk.rawContent;

		// Apply document-level filters
		if (!shouldIncludeChunk(rawChunk, filters)) {
			state.stats.chunksFiltered++;
			continue;
		}

		const chunks = rechunkOversized([rawChunk], deps.maxChunkChars);
		if (chunks.length > 1) state.stats.rechunkedCount += chunks.length;

		for (const chunk of chunks) {
			// Track document identity in catalog even if content is unchanged
			if (chunk.documentId && chunk.documentVersionId) {
				const key = chunk.documentId;
				if (!state.catalogPendingChunks.has(key)) {
					state.catalogPendingChunks.set(key, []);
				}
				(state.catalogPendingChunks.get(key) as Chunk[]).push(chunk);
			}

			// Dedup: skip re-embedding when content is unchanged
			const dedupKey = chunk.contentFingerprint ?? chunk.id;
			if (state.knownFingerprints.has(dedupKey) || state.knownChunkIds.has(chunk.id)) {
				state.stats.chunksSkipped++;
				continue;
			}
			state.batch.push(chunk);
			if (state.batch.length >= deps.maxBatch) {
				await deps.flushBatch(state.batch);
				state.batch = [];
			}
		}
	}
	// Flush remaining chunks
	await deps.flushBatch(state.batch);
	state.batch = [];
}
