import type { Edge } from "@wtfoc/common";

/**
 * Compute canonical dedup key for an edge.
 * Uses JSON encoding to avoid delimiter collisions.
 */
export function edgeKey(edge: Edge): string {
	return JSON.stringify([edge.type, edge.sourceId, edge.targetType, edge.targetId]);
}

interface MergedEdge {
	edge: Edge;
	provenance: Set<string>;
	evidenceParts: string[];
}

/**
 * Merge and deduplicate edges from multiple extractors.
 *
 * - Canonical key: (type, sourceId, targetType, targetId) via JSON encoding
 * - Evidence: merged from all contributors, separated by " | "
 * - Confidence: max(individual) + 0.05 per additional agreeing extractor (capped at 1.0)
 * - Provenance: union of extractor names
 */
export function mergeEdges(results: Array<{ extractorName: string; edges: Edge[] }>): Edge[] {
	const merged = new Map<string, MergedEdge>();

	for (const { extractorName, edges } of results) {
		for (const edge of edges) {
			const key = edgeKey(edge);
			const existing = merged.get(key);

			if (existing) {
				existing.provenance.add(extractorName);
				if (!existing.evidenceParts.includes(edge.evidence)) {
					existing.evidenceParts.push(edge.evidence);
				}
				if (edge.confidence > existing.edge.confidence) {
					existing.edge = { ...existing.edge, confidence: edge.confidence };
				}
			} else {
				merged.set(key, {
					edge: { ...edge },
					provenance: new Set([extractorName]),
					evidenceParts: [edge.evidence],
				});
			}
		}
	}

	const output: Edge[] = [];
	for (const { edge, provenance, evidenceParts } of merged.values()) {
		const agreementBoost = Math.max(0, (provenance.size - 1) * 0.05);
		const finalConfidence = Math.min(1.0, edge.confidence + agreementBoost);

		output.push({
			...edge,
			confidence: finalConfidence,
			evidence: evidenceParts.join(" | "),
			provenance: [...provenance],
		});
	}

	return output;
}
