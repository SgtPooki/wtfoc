import type { CollectionHead } from "../schemas/manifest.js";

/**
 * @deprecated Use CollectionHead. Alias for migration.
 */
export type HeadManifest = CollectionHead;

/**
 * Result of reading a collection head, including the store-assigned headId
 * used for conflict detection on subsequent writes.
 */
export interface StoredHead {
	headId: string;
	manifest: CollectionHead;
}

/**
 * Pluggable manifest store. Manages the single mutable CollectionHead
 * pointer over immutable segment and revision data.
 *
 * Conflict detection: `putHead` accepts `prevHeadId` and rejects
 * if it doesn't match the current head (single-writer enforcement).
 */
export interface ManifestStore {
	getHead(projectName: string): Promise<StoredHead | null>;
	putHead(
		projectName: string,
		manifest: CollectionHead,
		prevHeadId: string | null,
	): Promise<StoredHead>;
	listProjects(): Promise<string[]>;
}
