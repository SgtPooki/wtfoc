import type { Chunk, DocumentCatalog } from "@wtfoc/common";
import { archiveDocument, renameDocument, updateDocument } from "../document-catalog.js";

export interface CatalogUpdateResult {
	docsSuperseded: number;
}

/**
 * Update document catalog from all pending chunks (including dedup-skipped).
 * Handles tombstones, mutable-state superseding, and append-only appending.
 *
 * Extracted from ingest.ts lines 644-726.
 */
export function updateCatalogFromChunks(
	catalog: DocumentCatalog,
	pendingChunks: Map<string, Chunk[]>,
	appendOnlyTypes: Set<string>,
): CatalogUpdateResult {
	let docsSuperseded = 0;

	for (const [docId, docChunks] of pendingChunks) {
		const firstChunk = docChunks[0];
		if (!firstChunk?.documentVersionId) continue;

		// Tombstone chunks signal deletion
		if (firstChunk.sourceType === "tombstone") {
			archiveDocument(catalog, docId);
			continue;
		}

		// Source-specific mutability:
		// - HN stories/comments are append-only (content doesn't change)
		// - Everything else is mutable-state
		const mutability = appendOnlyTypes.has(firstChunk.sourceType)
			? ("append-only" as const)
			: ("mutable-state" as const);

		const fingerprints = docChunks
			.map((c) => c.contentFingerprint)
			.filter((fp): fp is string => fp !== undefined);

		const result = updateDocument(catalog, {
			documentId: docId,
			versionId: firstChunk.documentVersionId,
			chunkIds: docChunks.map((c) => c.id),
			contentFingerprints: fingerprints,
			sourceType: firstChunk.sourceType,
			mutability,
		});

		if (result.previousVersionId && result.supersededChunkIds.length > 0) {
			docsSuperseded++;
		}
	}

	return { docsSuperseded };
}

/**
 * Handle git-diff renames by archiving old document IDs.
 * Returns the number of documents archived.
 *
 * Extracted from ingest.ts lines 686-712.
 */
export function handleRenames(
	catalog: DocumentCatalog,
	renames: Array<{ oldPath: string; newPath: string }>,
	repoArg: string,
): number {
	let count = 0;
	for (const { oldPath } of renames) {
		const oldDocId = `${repoArg}/${oldPath}`;
		const existing = catalog.documents[oldDocId];
		if (existing) {
			renameDocument(catalog, oldDocId);
			count++;
		}
	}
	return count;
}
