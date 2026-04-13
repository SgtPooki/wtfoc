import type { Edge, Segment } from "@wtfoc/common";
import { normalizeRepoSource } from "./normalize-source.js";

/**
 * Lightweight source index for checking whether edge targets resolve
 * to existing chunks. Used by both the trace engine and CLI tools.
 */
export interface SourceIndex {
	/** All chunk IDs */
	chunkIds: Set<string>;
	/** Lowercased source strings → chunk IDs */
	bySource: Map<string, string[]>;
	/** Lowercased "repo#N" (without org) → chunk IDs for renamed repo resolution */
	byRepoName: Map<string, string[]>;
}

/**
 * Build a source index from segments for edge resolution checks.
 */
export function buildSourceIndex(segments: Segment[]): SourceIndex {
	const chunkIds = new Set<string>();
	const bySource = new Map<string, string[]>();
	const byRepoName = new Map<string, string[]>();

	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			chunkIds.add(chunk.id);

			const key = normalizeRepoSource(chunk.source);
			const ids = bySource.get(key) ?? [];
			ids.push(chunk.id);
			bySource.set(key, ids);

			const slashIdx = key.indexOf("/");
			if (slashIdx !== -1) {
				const repoKey = key.slice(slashIdx + 1);
				const repoIds = byRepoName.get(repoKey) ?? [];
				repoIds.push(chunk.id);
				byRepoName.set(repoKey, repoIds);
			}
		}
	}

	return { chunkIds, bySource, byRepoName };
}

/**
 * Check whether an edge targetId resolves to any chunk in the index.
 * Uses the same 3-tier resolution as the trace engine:
 * 1. Direct chunk ID match
 * 2. Exact source match (case-insensitive)
 * 3. Partial source match for structured IDs (contains / or :)
 */
export function resolves(targetId: string, index: SourceIndex): boolean {
	// 1. Direct chunk ID match
	if (index.chunkIds.has(targetId)) return true;

	// 2. Exact source match (case-insensitive, URL-normalized)
	const lower = normalizeRepoSource(targetId);
	if (index.bySource.has(lower)) return true;

	// 3. Partial source match for structured IDs
	if (targetId.includes("/") || targetId.includes(":")) {
		for (const source of index.bySource.keys()) {
			if (source.includes(lower)) return true;
		}

		// Strip org/repo prefix (first two segments) and retry partial match
		const pathSegments = lower.split("/");
		if (pathSegments.length > 2) {
			const repoLocalPath = pathSegments.slice(2).join("/");
			for (const source of index.bySource.keys()) {
				if (source.includes(repoLocalPath)) return true;
			}
		}
	}

	// 4. Renamed repo fallback — strip org and match by repo name only
	const slashIdx = lower.indexOf("/");
	if (slashIdx !== -1) {
		const repoKey = lower.slice(slashIdx + 1);
		if (index.byRepoName.has(repoKey)) return true;
	}

	return false;
}

export interface EdgeResolutionStats {
	totalEdges: number;
	resolvedEdges: number;
	bareRefs: number;
	unresolvedEdges: number;
	/** Concept-type edges (unresolvable by design — semantic labels, not chunk IDs) */
	conceptEdges: number;
	/** Package-type edges (npm packages are never ingested as chunks) */
	packageEdges: number;
	/** URL-type edges (external URLs won't resolve to local chunks) */
	urlEdges: number;
	unresolvedByRepo: Map<string, number>;
}

/**
 * Analyze edge resolution across all segments plus any overlay edges.
 *
 * @param overlayEdges - Additional edges from extract-edges overlays that are
 *   not yet baked into segment blobs. Passing them here lets the dogfood loop
 *   measure the effect of post-hoc extraction without running compact-edges.
 */
export function analyzeEdgeResolution(
	segments: Segment[],
	index: SourceIndex,
	overlayEdges: Edge[] = [],
): EdgeResolutionStats {
	const repoCounts = new Map<string, number>();
	let totalEdges = 0;
	let resolvedEdges = 0;
	let bareRefs = 0;
	let conceptEdges = 0;
	let packageEdges = 0;
	let urlEdges = 0;

	// Collect all edges: segment-baked first, then overlay
	const allEdges: Edge[] = [];
	for (const seg of segments) {
		for (const edge of seg.edges) {
			allEdges.push(edge);
		}
	}
	for (const edge of overlayEdges) {
		allEdges.push(edge);
	}

	for (const edge of allEdges) {
		totalEdges++;

		if (/^#\d+$/.test(edge.targetId)) {
			bareRefs++;
			continue;
		}

		// Concept edges are semantic labels, not chunk IDs — track separately
		if (edge.targetType === "concept") {
			conceptEdges++;
			continue;
		}

		// Package and URL edges are structurally out of scope for local collections
		if (edge.targetType === "package") {
			packageEdges++;
			continue;
		}
		if (edge.targetType === "url") {
			urlEdges++;
			continue;
		}

		if (resolves(edge.targetId, index)) {
			resolvedEdges++;
			continue;
		}

		const match = edge.targetId.match(/^([^#]+)#/);
		if (match) {
			const repo = match[1];
			if (!repo) continue;
			repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
		}
	}

	return {
		totalEdges,
		resolvedEdges,
		bareRefs,
		unresolvedEdges: totalEdges - resolvedEdges - bareRefs - conceptEdges - packageEdges - urlEdges,
		conceptEdges,
		packageEdges,
		urlEdges,
		unresolvedByRepo: repoCounts,
	};
}
