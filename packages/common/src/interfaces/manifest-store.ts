import type { HeadManifest } from "../schemas/manifest.js";

/**
 * Pluggable manifest store. Manages the mutable head pointer
 * over immutable segment data.
 */
export interface ManifestStore {
	getHead(projectName: string): Promise<HeadManifest | null>;
	putHead(projectName: string, manifest: HeadManifest): Promise<void>;
	listProjects(): Promise<string[]>;
}
