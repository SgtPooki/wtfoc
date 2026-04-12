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

	// Related context: hops not in any multi-hop chain (2+ hops).
	// Single-hop roots are "related context", not meaningful chains.
	const multiHopChains = chains.filter((c) => c.hopIndices.length >= 2);
	const hopsInChains = new Set(multiHopChains.flatMap((c) => c.hopIndices));
	const relatedContext = hops
		.map((hop, i) => ({ hop, i }))
		.filter(({ i }) => !hopsInChains.has(i))
		.map(({ hop, i }) => ({
			hopIndex: i,
			summary: `${hop.sourceType}: ${hop.source}`,
		}));

	// Recommended next reads: leaf hops of multi-hop chains
	const leafIndices = new Set(
		multiHopChains.map((c) => c.hopIndices.at(-1)).filter((i): i is number => i != null),
	);
	const recommendedNextReads = [...leafIndices]
		.filter((i) => hops[i] != null)
		.map((i) => ({
			hopIndex: i,
			// biome-ignore lint: index is validated by filter above
			reason: `End of evidence chain — follow up on ${hops[i]!.sourceType}: ${hops[i]!.source}`,
		}));

	const primaryHop = primary.hop;
	if (!primaryHop) return undefined;

	return {
		primaryArtifact: {
			hopIndex: primary.i,
			summary: `${primaryHop.sourceType}: ${primaryHop.source}`,
		},
		candidateFixes,
		relatedContext,
		recommendedNextReads,
	};
}
