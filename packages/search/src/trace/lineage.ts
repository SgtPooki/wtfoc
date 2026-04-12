import type { TraceHop } from "./trace.js";

export interface LineageChain {
	/** Hop indices forming this causal chain, root to leaf */
	hopIndices: number[];
	/** Source type sequence with consecutive duplicates removed */
	typeSequence: string[];
	/** Number of distinct source types in the chain */
	sourceTypeDiversity: number;
}

/**
 * Reconstruct lineage chains from TraceHop DFS tree via parentHopIndex.
 * Each chain is a root-to-leaf path. Sorted by length desc, then diversity desc.
 */
export function buildLineageChains(hops: TraceHop[]): LineageChain[] {
	if (hops.length === 0) return [];

	// Build children index
	const children = new Map<number, number[]>();
	const roots: number[] = [];

	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		if (!hop) continue;
		const parent = hop.parentHopIndex;
		if (parent == null) {
			roots.push(i);
		} else {
			const kids = children.get(parent) ?? [];
			kids.push(i);
			children.set(parent, kids);
		}
	}

	// Walk each root to all leaves, collecting paths
	const chains: LineageChain[] = [];

	function walk(index: number, path: number[]): void {
		const currentPath = [...path, index];
		const kids = children.get(index);
		if (!kids || kids.length === 0) {
			// Leaf — emit chain
			chains.push(buildChain(currentPath, hops));
		} else {
			for (const child of kids) {
				walk(child, currentPath);
			}
		}
	}

	for (const root of roots) {
		walk(root, []);
	}

	// Sort by length desc, then diversity desc
	chains.sort((a, b) => {
		const lenDiff = b.hopIndices.length - a.hopIndices.length;
		if (lenDiff !== 0) return lenDiff;
		return b.sourceTypeDiversity - a.sourceTypeDiversity;
	});

	return chains;
}

function buildChain(hopIndices: number[], hops: TraceHop[]): LineageChain {
	const types = hopIndices.map((i) => hops[i]?.sourceType ?? "unknown");
	const uniqueTypes = new Set(types);

	// Deduplicate consecutive types
	const typeSequence: string[] = [];
	for (const t of types) {
		if (typeSequence.length === 0 || typeSequence[typeSequence.length - 1] !== t) {
			typeSequence.push(t);
		}
	}

	return {
		hopIndices,
		typeSequence,
		sourceTypeDiversity: uniqueTypes.size,
	};
}
