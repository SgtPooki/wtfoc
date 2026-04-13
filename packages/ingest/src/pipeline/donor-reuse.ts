import type { Chunk, DocumentCatalog, StorageBackend } from "@wtfoc/common";
import type { RawSourceEntry, RawSourceIndex } from "../raw-source-archive.js";
import type { ScanResult } from "../source-scanner.js";
import type { LogSink, PipelineState } from "./types.js";

/** All I/O dependencies for donor reuse — fully injected, no globals. */
export interface DonorReuseDeps {
	sourceReuse: boolean;
	isPartialRun: boolean;
	sourceKey: string;
	collectionName: string;
	manifestDir: string;
	listProjects: () => Promise<string[]>;
	storage: StorageBackend;
	scanForReusable: (
		manifestDir: string,
		sourceKey: string,
		collectionName: string,
		listProjects: () => Promise<string[]>,
	) => Promise<ScanResult>;
	replayFromArchive: (entries: RawSourceEntry[], storage: StorageBackend) => AsyncIterable<Chunk>;
	readDonorCatalog: (catPath: string) => Promise<DocumentCatalog | null>;
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
			upload: (data: Uint8Array) => Promise<string>;
		},
	) => Promise<void>;
	isArchived: (index: RawSourceIndex, docId: string, versionId: string) => boolean;
	uploadData: (data: Uint8Array) => Promise<string>;
	log: LogSink;
}

/**
 * Cross-collection source reuse: pre-populate archive and dedup sets from donors.
 * Extracted from ingest.ts lines 486-566.
 */
export async function reuseDonorSources(state: PipelineState, deps: DonorReuseDeps): Promise<void> {
	if (!deps.sourceReuse || deps.isPartialRun) return;

	const scanResult = await deps.scanForReusable(
		deps.manifestDir,
		deps.sourceKey,
		deps.collectionName,
		deps.listProjects,
	);

	if (scanResult.matches.length === 0) return;

	state.stats.donorCollectionNames = scanResult.matches.map((m) => m.collectionName);

	deps.log({
		level: "info",
		phase: "donor-reuse",
		message: `Found source material in ${state.stats.donorCollectionNames.length} donor collection(s): ${state.stats.donorCollectionNames.join(", ")}`,
	});

	for (const match of scanResult.matches) {
		const donorCatalog = await deps.readDonorCatalog(match.collectionName);

		for await (const replayedChunk of deps.replayFromArchive(match.archiveEntries, deps.storage)) {
			// Archive donor content into recipient collection (pre-cache)
			if (
				replayedChunk.rawContent &&
				replayedChunk.documentId &&
				replayedChunk.documentVersionId &&
				!deps.isArchived(
					state.archiveIndex,
					replayedChunk.documentId,
					replayedChunk.documentVersionId,
				)
			) {
				await deps.archiveRawSource(
					state.archiveIndex,
					replayedChunk.documentId,
					replayedChunk.documentVersionId,
					replayedChunk.rawContent,
					{
						sourceType: replayedChunk.sourceType,
						sourceUrl: replayedChunk.sourceUrl,
						sourceKey: deps.sourceKey,
						filePath: replayedChunk.metadata.filePath,
						upload: deps.uploadData,
					},
				);
				state.stats.archivedCount++;
			}

			// Add per-chunk fingerprints from donor catalog for accurate dedup
			if (donorCatalog && replayedChunk.documentId) {
				const donorDoc = donorCatalog.documents[replayedChunk.documentId];
				if (donorDoc) {
					for (const fp of donorDoc.contentFingerprints ?? []) {
						state.knownFingerprints.add(fp);
					}
					for (const chunkId of donorDoc.chunkIds) {
						state.knownChunkIds.add(chunkId);
					}
				}
			}
			state.stats.reusedFromDonors++;
		}
	}
}
