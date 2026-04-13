import type { Edge, EvalCheck, EvalStageResult, Segment } from "@wtfoc/common";
import { analyzeEdgeResolution, buildSourceIndex, type SourceIndex } from "../edge-resolution.js";
import { normalizeRepoSource } from "../normalize-source.js";

/**
 * Resolve a target ID and return the first matched chunk ID, or undefined.
 * Extends the existing resolves() logic to expose the matched chunk.
 */
function resolveTarget(targetId: string, index: SourceIndex): string | undefined {
	// 1. Direct chunk ID match
	if (index.chunkIds.has(targetId)) return targetId;

	// 2. Exact source match (case-insensitive, URL-normalized)
	const lower = normalizeRepoSource(targetId);
	const exact = index.bySource.get(lower);
	if (exact && exact.length > 0) return exact[0];

	// 3. Partial source match for structured IDs
	if (targetId.includes("/") || targetId.includes(":")) {
		for (const [source, ids] of index.bySource.entries()) {
			if (source.includes(lower) && ids.length > 0) return ids[0];
		}

		// Strip org/repo prefix (first two segments) and retry partial match
		const pathSegments = lower.split("/");
		if (pathSegments.length > 2) {
			const repoLocalPath = pathSegments.slice(2).join("/");
			for (const [source, ids] of index.bySource.entries()) {
				if (source.includes(repoLocalPath) && ids.length > 0) return ids[0];
			}
		}
	}

	// 4. Renamed repo fallback
	const slashIdx = lower.indexOf("/");
	if (slashIdx !== -1) {
		const repoKey = lower.slice(slashIdx + 1);
		const repoIds = index.byRepoName.get(repoKey);
		if (repoIds && repoIds.length > 0) return repoIds[0];
	}

	return undefined;
}

/**
 * Evaluate edge resolution quality: resolution rate, cross-source density,
 * source-type pairs, top unresolved repos.
 *
 * @param overlayEdges - Additional edges from extract-edges overlays (not yet
 *   baked into segments). Pass the output of loadAllOverlayEdges() so the
 *   dogfood loop measures the full post-extraction graph.
 */
export async function evaluateEdgeResolution(
	segments: Segment[],
	overlayEdges: Edge[] = [],
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const checks: EvalCheck[] = [];

	if (segments.length === 0) {
		return {
			stage: "edge-resolution",
			startedAt,
			durationMs: Math.round(performance.now() - t0),
			verdict: "pass",
			summary: "No segments to evaluate",
			metrics: {
				totalEdges: 0,
				resolvedEdges: 0,
				bareRefs: 0,
				unresolvedEdges: 0,
				resolutionRate: 0,
				bareRefRate: 0,
				crossSourceEdgeDensity: 0,
				sourceTypePairs: {},
				topUnresolvedRepos: [],
			},
			checks: [],
		};
	}

	const index = buildSourceIndex(segments);
	const stats = analyzeEdgeResolution(segments, index, overlayEdges);

	const resolutionRate = stats.totalEdges > 0 ? stats.resolvedEdges / stats.totalEdges : 0;
	const bareRefRate = stats.totalEdges > 0 ? stats.bareRefs / stats.totalEdges : 0;
	// Adjusted rate excludes concept edges and bare refs from the denominator
	// (concept edges are semantic labels that can never resolve to chunks)
	const adjustedDenominator = stats.totalEdges - stats.conceptEdges - stats.bareRefs;
	const adjustedResolutionRate =
		adjustedDenominator > 0 ? stats.resolvedEdges / adjustedDenominator : 0;

	// In-scope rate excludes concept, bare refs, package, and url edges
	const inScopeDenominator =
		stats.totalEdges - stats.conceptEdges - stats.bareRefs - stats.packageEdges - stats.urlEdges;
	const inScopeResolutionRate =
		inScopeDenominator > 0 ? stats.resolvedEdges / inScopeDenominator : 0;

	// Build chunk → sourceType map for cross-source analysis
	const chunkSourceType = new Map<string, string>();
	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			chunkSourceType.set(chunk.id, chunk.sourceType);
		}
	}

	// Collect all edges for cross-source and per-source-type analysis
	const allEdgesFlat: Edge[] = [];
	for (const seg of segments) {
		for (const edge of seg.edges) allEdgesFlat.push(edge);
	}
	for (const edge of overlayEdges) allEdgesFlat.push(edge);

	// Per-source-type resolution breakdown
	const perSourceTypeStats = new Map<string, { total: number; resolved: number }>();
	for (const edge of allEdgesFlat) {
		const st = chunkSourceType.get(edge.sourceId);
		if (!st) continue;
		const entry = perSourceTypeStats.get(st) ?? { total: 0, resolved: 0 };
		entry.total++;
		if (
			!/^#\d+$/.test(edge.targetId) &&
			edge.targetType !== "concept" &&
			resolveTarget(edge.targetId, index)
		) {
			entry.resolved++;
		}
		perSourceTypeStats.set(st, entry);
	}
	const perSourceTypeBreakdown: Record<
		string,
		{ total: number; resolved: number; resolutionRate: number }
	> = {};
	for (const [st, entry] of perSourceTypeStats) {
		perSourceTypeBreakdown[st] = {
			total: entry.total,
			resolved: entry.resolved,
			resolutionRate: entry.total > 0 ? entry.resolved / entry.total : 0,
		};
	}

	// Cross-source density + source-type pairs
	let crossSourceEdges = 0;
	const sourceTypePairs: Record<string, number> = {};

	for (const edge of allEdgesFlat) {
		if (/^#\d+$/.test(edge.targetId)) continue; // skip bare refs

		const resolvedChunkId = resolveTarget(edge.targetId, index);
		if (!resolvedChunkId) continue;

		const sourceSt = chunkSourceType.get(edge.sourceId);
		const targetSt = chunkSourceType.get(resolvedChunkId);

		if (sourceSt && targetSt && sourceSt !== targetSt) {
			crossSourceEdges++;
			const pair = `${sourceSt}->${targetSt}`;
			sourceTypePairs[pair] = (sourceTypePairs[pair] || 0) + 1;
		}
	}

	const crossSourceEdgeDensity =
		stats.resolvedEdges > 0 ? crossSourceEdges / stats.resolvedEdges : 0;

	// Top unresolved repos
	const topUnresolvedRepos = [...stats.unresolvedByRepo.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([repo, count]) => ({ repo, count }));

	// Checks
	checks.push({
		name: "resolution-rate",
		passed: resolutionRate >= 0.05,
		actual: Math.round(resolutionRate * 1000) / 1000,
		expected: 0.05,
		detail:
			resolutionRate < 0.05
				? `Resolution rate ${(resolutionRate * 100).toFixed(1)}% below 5% minimum`
				: undefined,
	});

	let verdict: "pass" | "warn" | "fail" = "pass";
	if (resolutionRate < 0.05) verdict = "fail";
	else if (resolutionRate < 0.23) verdict = "warn";

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "edge-resolution",
		startedAt,
		durationMs,
		verdict,
		summary: `${stats.resolvedEdges}/${stats.totalEdges} edges resolved (${(resolutionRate * 100).toFixed(1)}%), ${crossSourceEdges} cross-source`,
		metrics: {
			totalEdges: stats.totalEdges,
			resolvedEdges: stats.resolvedEdges,
			bareRefs: stats.bareRefs,
			unresolvedEdges: stats.unresolvedEdges,
			conceptEdges: stats.conceptEdges,
			packageEdges: stats.packageEdges,
			urlEdges: stats.urlEdges,
			resolutionRate,
			adjustedResolutionRate,
			inScopeResolutionRate,
			bareRefRate,
			crossSourceEdgeDensity,
			sourceTypePairs,
			perSourceTypeBreakdown,
			topUnresolvedRepos,
		},
		checks,
	};
}
