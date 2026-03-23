import type { HeadManifest } from "../schemas/manifest.js";

/**
 * Result of reading a head manifest, including the store-assigned headId
 * used for conflict detection on subsequent writes.
 */
export interface StoredHead {
	/** Store-assigned identifier for this head revision (content hash, storage ID, etc.) */
	headId: string;
	/** The manifest data */
	manifest: HeadManifest;
}

/**
 * Pluggable manifest store. Manages the mutable head pointer
 * over immutable segment data.
 *
 * Conflict detection: `putHead` accepts `prevHeadId` and rejects
 * if it doesn't match the current head (single-writer enforcement).
 */
export interface ManifestStore {
	getHead(projectName: string): Promise<StoredHead | null>;
	putHead(projectName: string, manifest: HeadManifest, prevHeadId: string | null): Promise<StoredHead>;
	listProjects(): Promise<string[]>;
}
