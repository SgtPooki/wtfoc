import type { LineageChain } from "./lineage.js";
import type { TraceHop } from "./trace.js";

export interface TraceConclusion {
	primaryArtifact?: { hopIndex: number; summary: string };
	candidateFixes: Array<{ hopIndex: number; summary: string }>;
	relatedContext: Array<{ hopIndex: number; summary: string }>;
	recommendedNextReads: Array<{ hopIndex: number; reason: string }>;
}

const FIX_EDGE_TYPES = new Set(["closes", "addresses"]);

/**
 * Build a heuristic-based conclusion block for agent consumers.
 * Returns undefined if no hops (no signal to analyze).
 */
export function buildConclusion(
	hops: TraceHop[],
	chains: LineageChain[],
): TraceConclusion | undefined {
	if (hops.length === 0) return undefined;

	// Primary artifact: highest-confidence seed (no parentHopIndex)
	const seeds = hops.map((h, i) => ({ hop: h, i })).filter(({ hop }) => hop.parentHopIndex == null);
	const primary =
		seeds.length > 0
			? seeds.reduce((best, cur) =>
					cur.hop.connection.confidence > best.hop.connection.confidence ? cur : best,
				)
			: { hop: hops[0], i: 0 };

	// Candidate fixes: edge-based hops with closes/addresses edge types
	const candidateFixes = hops
		.map((hop, i) => ({ hop, i }))
		.filter(
			({ hop }) =>
				hop.connection.method === "edge" &&
				hop.connection.edgeType != null &&
				FIX_EDGE_TYPES.has(hop.connection.edgeType),
		)
		.map(({ hop, i }) => ({
			hopIndex: i,
			summary: `${hop.sourceType}: ${hop.source} (${hop.connection.edgeType})`,
		}));

	// Related context: hops not in any chain
	const hopsInChains = new Set(chains.flatMap((c) => c.hopIndices));
	const relatedContext = hops
		.map((hop, i) => ({ hop, i }))
		.filter(({ i }) => !hopsInChains.has(i))
		.map(({ hop, i }) => ({
			hopIndex: i,
			summary: `${hop.sourceType}: ${hop.source}`,
		}));

	// Recommended next reads: leaf hops of chains (last hop in each chain)
	const leafIndices = new Set(chains.map((c) => c.hopIndices[c.hopIndices.length - 1]));
	const recommendedNextReads = [...leafIndices].map((i) => ({
		hopIndex: i,
		reason: `End of evidence chain — follow up on ${hops[i].sourceType}: ${hops[i].source}`,
	}));

	return {
		primaryArtifact: {
			hopIndex: primary.i,
			summary: `${primary.hop.sourceType}: ${primary.hop.source}`,
		},
		candidateFixes,
		relatedContext,
		recommendedNextReads,
	};
}
