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
export function detectInsights(hops: TraceHop[], segments: Segment[]): TraceInsight[] {
	const insights: TraceInsight[] = [];

	insights.push(...detectConvergence(hops));
	insights.push(...detectEvidenceChains(hops));
	insights.push(...detectTemporalClusters(hops, segments));

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
			summary: `${sourceTypeCount} source types independently discuss this topic: ${typeLabels.join(", ")}`,
			hopIndices: allIndices,
			strength,
		},
	];
}

// ─── Evidence Chains ────────────────────────────────────────────────────────

/**
 * Evidence chain: A sequence of edge-connected hops that cross 3+ source
 * types. These show the "story" of how information flows across systems.
 *
 * E.g., Slack message → GitHub issue → PR → Code change
 *
 * Note: Since trace uses DFS, consecutive edge hops may include sibling
 * branches (not strictly linear paths). The chain represents "connected
 * subgraph crossing N source types" rather than a single linear path.
 * This is intentional — the insight value is in source-type diversity
 * of the connected component, not path linearity.
 */
function detectEvidenceChains(hops: TraceHop[]): TraceInsight[] {
	// Walk hops in order; edge hops that follow a previous hop form a chain
	const chains: Array<{ indices: number[]; types: Set<string> }> = [];
	let currentChain: { indices: number[]; types: Set<string> } | null = null;

	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (!hop) continue;

		if (hop.connection.method === "edge") {
			if (!currentChain) {
				// Start a new chain — include the previous hop as the chain root
				// (the seed that the edge came from)
				const rootIdx = findChainRoot(hops, i);
				const rootHop = rootIdx >= 0 ? hops[rootIdx] : undefined;
				currentChain = {
					indices: rootIdx >= 0 ? [rootIdx, i] : [i],
					types: new Set<string>(),
				};
				if (rootHop) currentChain.types.add(rootHop.sourceType);
			} else {
				currentChain.indices.push(i);
			}
			currentChain.types.add(hop.sourceType);
		} else {
			// Semantic hop breaks the chain
			if (currentChain && currentChain.types.size >= 3) {
				chains.push(currentChain);
			}
			currentChain = null;
		}
	}

	// Don't forget the last chain
	if (currentChain && currentChain.types.size >= 3) {
		chains.push(currentChain);
	}

	return chains.map((chain) => {
		const typeSequence = chain.indices
			.map((i) => formatSourceType(hops[i]?.sourceType ?? "unknown"))
			.filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]); // dedupe consecutive

		const strength = Math.min(0.5 + chain.types.size * 0.15, 1.0);

		return {
			kind: "evidence-chain" as const,
			summary: `Cross-source evidence trail: ${typeSequence.join(" → ")}`,
			hopIndices: chain.indices,
			strength,
		};
	});
}

/**
 * Find the most recent non-edge hop before `edgeIdx` — that's the seed
 * the edge chain grew from.
 */
function findChainRoot(hops: TraceHop[], edgeIdx: number): number {
	for (let i = edgeIdx - 1; i >= 0; i--) {
		if (hops[i]?.connection.method !== "edge") return i;
	}
	return -1;
}

// ─── Temporal Clusters ──────────────────────────────────────────────────────

const RECENT_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * Temporal cluster: When a disproportionate share of trace results have
 * recent timestamps, it signals active/trending discussion.
 */
function detectTemporalClusters(hops: TraceHop[], segments: Segment[]): TraceInsight[] {
	// Collect the storageIds we actually need timestamps for
	const neededIds = new Set<string>();
	for (const hop of hops) {
		neededIds.add(hop.storageId);
	}

	// Build a targeted lookup — only resolve timestamps for hop storageIds
	const timestamps = new Map<string, string>();
	for (const seg of segments) {
		if (timestamps.size >= neededIds.size) break;
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

		withTimestamp++;
		const time = new Date(ts).getTime();
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
