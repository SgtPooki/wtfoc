import type { ArtifactSummaryEntry, CollectionRevision } from "@wtfoc/common";
import { createHash } from "node:crypto";

export interface RevisionDiff {
	added: ArtifactSummaryEntry[];
	removed: ArtifactSummaryEntry[];
	unchanged: ArtifactSummaryEntry[];
	counts: { added: number; removed: number; unchanged: number };
}

/**
 * Compute a revision diff from two revisions' artifact summaries.
 * Uses contentIdentity for equality — no full artifact download needed (FR-010).
 */
export function computeRevisionDiff(
	left: CollectionRevision,
	right: CollectionRevision,
): RevisionDiff {
	const leftMap = new Map(
		left.artifactSummaries.map((s) => [s.artifactId, s]),
	);
	const rightMap = new Map(
		right.artifactSummaries.map((s) => [s.artifactId, s]),
	);

	const added: ArtifactSummaryEntry[] = [];
	const removed: ArtifactSummaryEntry[] = [];
	const unchanged: ArtifactSummaryEntry[] = [];

	for (const [id, entry] of rightMap) {
		const leftEntry = leftMap.get(id);
		if (!leftEntry) {
			added.push(entry);
		} else if (leftEntry.contentIdentity === entry.contentIdentity) {
			unchanged.push(entry);
		} else {
			removed.push(leftEntry);
			added.push(entry);
		}
	}

	for (const [id, entry] of leftMap) {
		if (!rightMap.has(id)) {
			removed.push(entry);
		}
	}

	return {
		added,
		removed,
		unchanged,
		counts: {
			added: added.length,
			removed: removed.length,
			unchanged: unchanged.length,
		},
	};
}

/**
 * Generate a backend-neutral contentIdentity for an artifact.
 * - FOC-backed: use the IPFS CID
 * - Local: SHA-256 hex of the canonical serialized bytes
 */
export function generateContentIdentity(
	data: Uint8Array,
	ipfsCid?: string,
): string {
	if (ipfsCid) return ipfsCid;
	return createHash("sha256").update(data).digest("hex");
}
