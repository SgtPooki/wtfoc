import type { RawSourceEntry, RawSourceIndex } from "./raw-source-archive.js";
import {
	archiveIndexPath,
	findEntriesBySourceKey,
	readArchiveIndex,
} from "./raw-source-archive.js";

/**
 * A donor collection with matching source material.
 */
export interface SourceMatch {
	collectionName: string;
	archiveEntries: RawSourceEntry[];
}

/**
 * Result of scanning collections for reusable source material.
 */
export interface ScanResult {
	matches: SourceMatch[];
}

/**
 * Validate that a donor archive entry has all required fields for cross-collection reuse.
 */
export function validateDonorEntry(entry: RawSourceEntry): boolean {
	if (!entry.sourceKey) return false;
	if (!entry.storageId) return false;
	if (!entry.documentId) return false;
	if (!entry.documentVersionId) return false;
	return true;
}

/**
 * Scan all collections' raw source archives for entries matching the given sourceKey.
 * Excludes the specified collection (self) from results.
 * Results are cached within a single invocation via the optional cache parameter.
 */
export async function scanForReusableSources(
	manifestDir: string,
	sourceKey: string,
	excludeCollection: string,
	listProjects: () => Promise<string[]>,
	cache?: Map<string, RawSourceIndex | null>,
): Promise<ScanResult> {
	const projects = await listProjects();
	const matches: SourceMatch[] = [];

	for (const name of projects) {
		if (name === excludeCollection) continue;

		let index: RawSourceIndex | null | undefined;
		if (cache) {
			if (cache.has(name)) {
				index = cache.get(name);
			} else {
				index = await readArchiveIndex(archiveIndexPath(manifestDir, name));
				cache.set(name, index);
			}
		} else {
			index = await readArchiveIndex(archiveIndexPath(manifestDir, name));
		}

		if (!index) continue;

		const entries = findEntriesBySourceKey(index, sourceKey).filter(validateDonorEntry);
		if (entries.length > 0) {
			matches.push({ collectionName: name, archiveEntries: entries });
		}
	}

	return { matches };
}
