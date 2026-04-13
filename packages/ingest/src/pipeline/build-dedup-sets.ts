import type { DocumentCatalog, Segment, SegmentSummary } from "@wtfoc/common";

export interface DedupSets {
	knownFingerprints: Set<string>;
	knownChunkIds: Set<string>;
}

/**
 * Build dedup sets from document catalog (fast O(1) path).
 * Preferred when catalog has entries.
 */
export function buildDedupSetsFromCatalog(catalog: DocumentCatalog): DedupSets {
	const knownFingerprints = new Set<string>();
	const knownChunkIds = new Set<string>();

	for (const entry of Object.values(catalog.documents)) {
		for (const chunkId of entry.chunkIds) {
			knownChunkIds.add(chunkId);
		}
		for (const chunkId of entry.supersededChunkIds ?? []) {
			knownChunkIds.add(chunkId);
		}
		for (const fp of entry.contentFingerprints ?? []) {
			knownFingerprints.add(fp);
		}
	}

	return { knownFingerprints, knownChunkIds };
}

/**
 * Build dedup sets by downloading and scanning segments (legacy fallback).
 * Used for collections without a catalog.
 */
export async function buildDedupSetsFromSegments(
	segments: SegmentSummary[],
	download: (id: string) => Promise<Uint8Array>,
): Promise<DedupSets> {
	const knownFingerprints = new Set<string>();
	const knownChunkIds = new Set<string>();

	for (const segSummary of segments) {
		try {
			const segBytes = await download(segSummary.id);
			const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
			for (const c of seg.chunks) {
				knownChunkIds.add(c.id);
				if ("contentFingerprint" in c && typeof c.contentFingerprint === "string") {
					knownFingerprints.add(c.contentFingerprint);
				}
			}
		} catch {
			// Segment may not be downloadable (e.g. FOC-only), skip
		}
	}

	return { knownFingerprints, knownChunkIds };
}
