import type { Segment } from "@wtfoc/common";
import type { TraceHop } from "./trace.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InsightKind = "convergence" | "evidence-chain" | "temporal-cluster";

export interface TraceInsight {
	kind: InsightKind;
	/** Human-readable summary of the insight */
	summary: string;
	/** Hops that contribute to this insight */
	hopIndices: number[];
	/** Strength 0-1 (higher = more significant) */
	strength: number;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect cross-source insights from collected trace hops.
 *
 * Three kinds:
 * 1. Convergence — multiple independent source types discuss the same topic
 * 2. Evidence chains — connected paths across 3+ source types via edges
 * 3. Temporal clusters — recent activity concentration on the traced topic
 */
export function detectInsights(
	hops: TraceHop[],
	segments: Segment[],
	signal?: AbortSignal,
): TraceInsight[] {
	const insights: TraceInsight[] = [];

	insights.push(...detectConvergence(hops));
	insights.push(...detectEvidenceChains(hops));
	signal?.throwIfAborted();
	insights.push(...detectTemporalClusters(hops, segments, signal));

	// Sort by strength descending
	insights.sort((a, b) => b.strength - a.strength);
	return insights;
}

// ─── Convergence ────────────────────────────────────────────────────────────

/**
 * Convergence: When results from 3+ distinct source types appear,
 * it signals that a topic is discussed across the organization —
 * not just in one silo.
 */
function detectConvergence(hops: TraceHop[]): TraceInsight[] {
	// Group hops by source type
	const byType = new Map<string, number[]>();
	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (!hop) continue;
		const indices = byType.get(hop.sourceType) ?? [];
		indices.push(i);
		byType.set(hop.sourceType, indices);
	}

	const sourceTypeCount = byType.size;
	if (sourceTypeCount < 3) return [];

	const types = [...byType.keys()];
	const allIndices = [...byType.values()].flat();

	// Strength scales with how many source types converge (3≈0.8, 4≈0.9, 5+=1.0 cap)
	const strength = Math.min(0.5 + sourceTypeCount * 0.1, 1.0);

	const typeLabels = types.map(formatSourceType);
	return [
		{
			kind: "convergence",
			summary: `${sourceTypeCount} source types surface results for this topic: ${typeLabels.join(", ")}`,
			hopIndices: allIndices.sort((a, b) => a - b),
			strength,
		},
	];
}

// ─── Evidence Chains ────────────────────────────────────────────────────────

/**
 * Evidence chain: A true path through the DFS tree that crosses 3+ source
 * types via explicit edges. Uses `parentHopIndex` to reconstruct actual
 * root-to-leaf paths (not just consecutive hops in array order).
 *
 * E.g., Slack message → GitHub issue → PR → Code change
 */
function detectEvidenceChains(hops: TraceHop[]): TraceInsight[] {
	// Find leaf hops (edge hops that no other hop points to as parent)
	const hasChild = new Set<number>();
	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (hop?.parentHopIndex != null) {
			hasChild.add(hop.parentHopIndex);
		}
	}

	// For each leaf, walk parentHopIndex back to root to get a true path
	const paths: Array<{ indices: number[]; types: Set<string> }> = [];

	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (!hop) continue;
		// Only start from edge-connected leaves
		if (hop.connection.method !== "edge") continue;
		if (hasChild.has(i)) continue;

		// Walk back to root
		const path: number[] = [];
		let current: number | undefined = i;
		while (current != null) {
			path.push(current);
			current = hops[current]?.parentHopIndex;
		}
		path.reverse();

		// Collect unique source types along the path
		const types = new Set<string>();
		for (const idx of path) {
			const h = hops[idx];
			if (h) types.add(h.sourceType);
		}

		if (types.size >= 3) {
			paths.push({ indices: path, types });
		}
	}

	if (paths.length === 0) return [];

	// Deduplicate and rank:
	// 1. Sort by source-type diversity (most types first), then by length
	paths.sort((a, b) => b.types.size - a.types.size || b.indices.length - a.indices.length);

	// 2. Drop paths that are subpaths of an already-kept path
	const isPrefix = (prefix: number[], full: number[]): boolean => {
		if (prefix.length > full.length) return false;
		for (let i = 0; i < prefix.length; i++) {
			if (prefix[i] !== full[i]) return false;
		}
		return true;
	};
	const kept: typeof paths = [];
	for (const path of paths) {
		const isSubpath = kept.some((k) => isPrefix(path.indices, k.indices));
		if (!isSubpath) kept.push(path);
	}

	// 3. Deduplicate chains with identical type sequences (keep the one with more types)
	const seenSummaries = new Set<string>();
	const unique: typeof kept = [];
	for (const path of kept) {
		const typeSequence = path.indices
			.map((i) => formatSourceType(hops[i]?.sourceType ?? "unknown"))
			.filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]);
		const key = typeSequence.join(" → ");
		if (!seenSummaries.has(key)) {
			seenSummaries.add(key);
			unique.push(path);
		}
	}

	// 4. Cap at 3 chains to avoid noisy output
	return unique.slice(0, 3).map((path) => {
		const typeSequence = path.indices
			.map((i) => formatSourceType(hops[i]?.sourceType ?? "unknown"))
			.filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]);

		const strength = Math.min(0.5 + path.types.size * 0.15, 1.0);

		return {
			kind: "evidence-chain" as const,
			summary: `Cross-source evidence trail: ${typeSequence.join(" → ")}`,
			hopIndices: path.indices,
			strength,
		};
	});
}

// ─── Temporal Clusters ──────────────────────────────────────────────────────

const RECENT_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * Temporal cluster: When a disproportionate share of trace results have
 * recent timestamps, it signals active/trending discussion.
 */
function detectTemporalClusters(
	hops: TraceHop[],
	segments: Segment[],
	signal?: AbortSignal,
): TraceInsight[] {
	// Collect the storageIds we actually need timestamps for
	const neededIds = new Set<string>();
	for (const hop of hops) {
		neededIds.add(hop.storageId);
	}

	// Build a targeted lookup — only resolve timestamps for hop storageIds
	const timestamps = new Map<string, string>();
	for (const seg of segments) {
		if (timestamps.size >= neededIds.size) break;
		signal?.throwIfAborted();
		for (const chunk of seg.chunks) {
			if (chunk.timestamp && neededIds.has(chunk.storageId)) {
				timestamps.set(chunk.storageId, chunk.timestamp);
			}
		}
	}

	const now = Date.now();
	const recentCutoff = now - RECENT_DAYS * MS_PER_DAY;

	let recentCount = 0;
	let withTimestamp = 0;
	const recentIndices: number[] = [];

	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (!hop) continue;
		const ts = timestamps.get(hop.storageId);
		if (!ts) continue;

		const time = new Date(ts).getTime();
		if (Number.isNaN(time)) continue;
		withTimestamp++;
		if (time >= recentCutoff) {
			recentCount++;
			recentIndices.push(i);
		}
	}

	// Need at least 2 recent results with timestamps to detect a cluster
	if (withTimestamp < 2 || recentCount < 2) return [];

	const recentRatio = recentCount / withTimestamp;

	// If >50% of timestamped results are recent, that's a temporal signal
	if (recentRatio < 0.5) return [];

	const strength = Math.min(0.4 + recentRatio * 0.5, 1.0);

	return [
		{
			kind: "temporal-cluster",
			summary: `${recentCount} of ${withTimestamp} results have activity within the last ${RECENT_DAYS} days — this topic is actively discussed`,
			hopIndices: recentIndices,
			strength,
		},
	];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, string> = {
	"slack-message": "Slack",
	"discord-message": "Discord",
	"github-issue": "GitHub Issues",
	"github-pr": "GitHub PRs",
	"github-issue-comment": "GitHub Comments",
	"github-pr-comment": "GitHub PR Comments",
	"github-pr-review": "GitHub Reviews",
	"hn-story": "Hacker News",
	"hn-comment": "HN Comments",
	code: "Code",
	markdown: "Docs",
	"doc-page": "Web Docs",
};

function formatSourceType(sourceType: string): string {
	return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}
