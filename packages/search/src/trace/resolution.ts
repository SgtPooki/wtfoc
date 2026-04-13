import { normalizeRepoSource } from "../normalize-source.js";
import type { ChunkData, ChunkIndexes } from "./indexing.js";

/**
 * Resolve an edge targetId to matching chunks using indexed lookups.
 *
 * Resolution order (first match wins):
 * 1. Direct chunk ID match (O(1))
 * 2. Exact source match (O(1)) — e.g. targetId "FilOzone/synapse-sdk#142"
 *    matches chunks with source "FilOzone/synapse-sdk#142"
 * 3. Partial source match — for cross-source edges where targetId is a
 *    substring of the source (e.g. file path edges). Limited to avoid
 *    false positives.
 */
export function findChunksByTarget(
	targetId: string,
	indexes: ChunkIndexes,
): Array<[string, ChunkData]> {
	const results: Array<[string, ChunkData]> = [];

	// 1. Direct chunk ID match
	const directMatch = indexes.byId.get(targetId);
	if (directMatch) {
		results.push([targetId, directMatch]);
		return results;
	}

	// 2. Exact source match (O(1) via normalized source index)
	const lowerTarget = normalizeRepoSource(targetId);
	const sourceMatches = indexes.bySource.get(lowerTarget);
	if (sourceMatches) {
		for (const id of sourceMatches) {
			const data = indexes.byId.get(id);
			if (data) results.push([id, data]);
		}
		if (results.length > 0) return results;
	}

	// 3. Partial source match — only for structured IDs (contains / or :)
	//    to avoid false positives on short targetIds like "#42"
	//    Capped at 10 results to avoid O(n) blowup on large collections
	if (targetId.includes("/") || targetId.includes(":")) {
		for (const [source, chunkIds] of indexes.bySource) {
			if (source.includes(lowerTarget)) {
				for (const id of chunkIds) {
					const data = indexes.byId.get(id);
					if (data) results.push([id, data]);
				}
				if (results.length >= 10) break;
			}
		}
		if (results.length > 0) return results;

		// Strip org/repo prefix (first two segments) and retry partial match
		const pathSegments = lowerTarget.split("/");
		if (pathSegments.length > 2) {
			const repoLocalPath = pathSegments.slice(2).join("/");
			for (const [source, chunkIds] of indexes.bySource) {
				if (source.includes(repoLocalPath)) {
					for (const id of chunkIds) {
						const data = indexes.byId.get(id);
						if (data) results.push([id, data]);
					}
					if (results.length >= 10) break;
				}
			}
			if (results.length > 0) return results;
		}
	}

	// 4. Renamed repo fallback — strip org prefix and match by repo name only (O(1))
	//    e.g. "FILCAT/pdp#24" → look up "pdp#24" which matches "FilOzone/pdp#24"
	const slashIdx = lowerTarget.indexOf("/");
	if (slashIdx !== -1) {
		const repoKey = lowerTarget.slice(slashIdx + 1);
		const repoMatches = indexes.byRepoName.get(repoKey);
		if (repoMatches) {
			for (const id of repoMatches) {
				const data = indexes.byId.get(id);
				if (data) results.push([id, data]);
			}
		}
	}

	return results;
}
