import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DocumentCatalog, DocumentCatalogEntry, DocumentLifecycleState } from "@wtfoc/common";

/**
 * Get the catalog file path for a collection.
 */
export function catalogFilePath(manifestDir: string, collectionName: string): string {
	return join(manifestDir, `${collectionName}.document-catalog.json`);
}

/**
 * Read the document catalog from disk. Returns null if file doesn't exist or is corrupt.
 */
export async function readCatalog(catalogPath: string): Promise<DocumentCatalog | null> {
	try {
		const data = await readFile(catalogPath, "utf-8");
		const parsed = JSON.parse(data) as DocumentCatalog;
		if (
			parsed.schemaVersion !== 1 ||
			!parsed.documents ||
			typeof parsed.documents !== "object" ||
			Array.isArray(parsed.documents)
		) {
			return null;
		}
		return parsed;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code?: string }).code === "ENOENT"
		) {
			return null;
		}
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[wtfoc] Warning: failed to read document catalog at ${catalogPath}: ${message}`);
		return null;
	}
}

/**
 * Write the document catalog atomically (temp + rename).
 */
export async function writeCatalog(catalogPath: string, catalog: DocumentCatalog): Promise<void> {
	await mkdir(dirname(catalogPath), { recursive: true });
	const tmpPath = `${catalogPath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(catalog, null, 2));
	await rename(tmpPath, catalogPath);
}

/**
 * Create an empty document catalog for a collection.
 */
export function createEmptyCatalog(collectionId: string): DocumentCatalog {
	return {
		schemaVersion: 1,
		collectionId,
		documents: {},
	};
}

/**
 * Get the set of active chunk IDs from the catalog for dedup/filtering.
 */
export function getActiveChunkIds(catalog: DocumentCatalog): Set<string> {
	const ids = new Set<string>();
	for (const entry of Object.values(catalog.documents)) {
		if (entry.state === "active") {
			for (const id of entry.chunkIds) {
				ids.add(id);
			}
		}
	}
	return ids;
}

/**
 * Get all chunk IDs for documents in a specific lifecycle state.
 */
export function getChunkIdsByState(
	catalog: DocumentCatalog,
	state: DocumentLifecycleState,
): Set<string> {
	const ids = new Set<string>();
	for (const entry of Object.values(catalog.documents)) {
		if (entry.state === state) {
			for (const id of entry.chunkIds) {
				ids.add(id);
			}
		}
	}
	return ids;
}

/**
 * Look up a document entry by its documentId.
 */
export function getDocument(
	catalog: DocumentCatalog,
	documentId: string,
): DocumentCatalogEntry | undefined {
	return catalog.documents[documentId];
}

export interface UpdateDocumentOptions {
	documentId: string;
	versionId: string;
	chunkIds: string[];
	sourceType: string;
	mutability: "mutable-state" | "append-only";
}

/**
 * Update or create a document entry in the catalog.
 * For mutable-state documents: supersedes the previous version.
 * For append-only documents: keeps existing chunks, adds new ones.
 * Returns the superseded chunk IDs (if any) for lifecycle edge emission.
 */
export function updateDocument(
	catalog: DocumentCatalog,
	options: UpdateDocumentOptions,
): { supersededChunkIds: string[]; previousVersionId: string | null } {
	const existing = catalog.documents[options.documentId];

	if (!existing) {
		catalog.documents[options.documentId] = {
			documentId: options.documentId,
			currentVersionId: options.versionId,
			previousVersionIds: [],
			chunkIds: options.chunkIds,
			state: "active",
			mutability: options.mutability,
			sourceType: options.sourceType,
			updatedAt: new Date().toISOString(),
		};
		return { supersededChunkIds: [], previousVersionId: null };
	}

	if (options.mutability === "append-only") {
		// Append-only: add new chunks alongside existing ones, don't supersede
		const newChunks = options.chunkIds.filter((id) => !existing.chunkIds.includes(id));
		existing.chunkIds = [...existing.chunkIds, ...newChunks];
		existing.currentVersionId = options.versionId;
		existing.updatedAt = new Date().toISOString();
		return { supersededChunkIds: [], previousVersionId: null };
	}

	// Mutable-state: supersede the previous version
	if (existing.currentVersionId === options.versionId) {
		// Same version — no change needed
		return { supersededChunkIds: [], previousVersionId: null };
	}

	const previousVersionId = existing.currentVersionId;
	const supersededChunkIds = [...existing.chunkIds];

	existing.previousVersionIds = [previousVersionId, ...existing.previousVersionIds];
	existing.currentVersionId = options.versionId;
	existing.chunkIds = options.chunkIds;
	existing.state = "active";
	existing.updatedAt = new Date().toISOString();

	return { supersededChunkIds, previousVersionId };
}

/**
 * Mark a document as archived (e.g., file deleted from repo).
 * Returns the chunk IDs that were archived.
 */
export function archiveDocument(
	catalog: DocumentCatalog,
	documentId: string,
): { archivedChunkIds: string[] } {
	const existing = catalog.documents[documentId];
	if (!existing) return { archivedChunkIds: [] };

	const archivedChunkIds = [...existing.chunkIds];
	existing.state = "archived";
	existing.updatedAt = new Date().toISOString();

	return { archivedChunkIds };
}

/**
 * Handle a file rename: archive the old documentId.
 * The new documentId entry will be created when the renamed file is ingested.
 */
export function renameDocument(catalog: DocumentCatalog, oldDocumentId: string): void {
	const existing = catalog.documents[oldDocumentId];
	if (!existing) return;

	existing.state = "archived";
	existing.updatedAt = new Date().toISOString();
}
