import type { Edge } from "@wtfoc/common";

/**
 * Post-extraction acceptance gates for LLM-produced edges.
 * Filters out low-quality edges that would hurt trust.
 */

/** Placeholder patterns that indicate an unresolved target */
const PLACEHOLDER_PATTERNS = [
	/^LINK_TO_/i,
	/^TODO/i,
	/^TBD$/i,
	/^PLACEHOLDER/i,
	/^INSERT_/i,
	/^EXAMPLE_/i,
	/^\[.*\]$/, // bracketed placeholders like [link]
	/^#$/, // bare hash
];

/** Proposal/planning language that indicates the edge is about intent, not fact */
const PROPOSAL_PATTERNS = [
	/\bshould\b/i,
	/\bmakes sense to\b/i,
	/\bbelongs in\b/i,
	/\bwe need to\b/i,
	/\bplan to\b/i,
	/\bwould be good to\b/i,
	/\bconsider\b.*\badding\b/i,
	/\bI think\b.*\bshould\b/i,
];

/** Target types that require resolvable IDs */
const RESOLVABLE_TARGET_TYPES = new Set(["file", "issue", "pr", "url", "document"]);

/** Minimum target ID length for non-concept targets */
const MIN_TARGET_ID_LENGTH = 3;

export interface ValidationResult {
	accepted: Edge[];
	rejected: Array<{ edge: Edge; reason: string }>;
}

/**
 * Validate and filter LLM-extracted edges through acceptance gates.
 */
export function validateEdges(edges: Edge[]): ValidationResult {
	const accepted: Edge[] = [];
	const rejected: Array<{ edge: Edge; reason: string }> = [];

	for (const edge of edges) {
		const reason = getRejectReason(edge);
		if (reason) {
			rejected.push({ edge, reason });
		} else {
			accepted.push(edge);
		}
	}

	return { accepted, rejected };
}

function getRejectReason(edge: Edge): string | null {
	// Gate 1: Reject placeholder targets
	for (const pattern of PLACEHOLDER_PATTERNS) {
		if (pattern.test(edge.targetId)) {
			return `placeholder target: ${edge.targetId}`;
		}
	}

	// Gate 2: Reject proposal language in factual relation types
	const factualTypes = new Set(["documents", "tests", "implements", "changes", "closes"]);
	if (factualTypes.has(edge.type)) {
		for (const pattern of PROPOSAL_PATTERNS) {
			if (pattern.test(edge.evidence)) {
				return `proposal language in factual edge type "${edge.type}": ${edge.evidence.slice(0, 80)}`;
			}
		}
	}

	// Gate 3: Reject too-short or too-vague target IDs
	if (edge.targetId.length < MIN_TARGET_ID_LENGTH) {
		return `target ID too short: "${edge.targetId}"`;
	}

	// Gate 4: Reject non-resolvable targets for types that should be resolvable
	if (RESOLVABLE_TARGET_TYPES.has(edge.targetType)) {
		const hasPath = edge.targetId.includes("/") || edge.targetId.includes(".");
		const hasNumber = /[#@]\d+|\d+/.test(edge.targetId);
		const hasUrl = edge.targetId.startsWith("http");
		if (!hasPath && !hasNumber && !hasUrl) {
			return `non-resolvable ${edge.targetType} target: "${edge.targetId}"`;
		}
	}

	// Gate 5: Reject empty or trivially short evidence
	if (!edge.evidence || edge.evidence.trim().length < 10) {
		return `evidence too short: "${edge.evidence}"`;
	}

	// Gate 6: Demote "discusses" edges with low confidence to rejected
	if (edge.type === "discusses" && edge.confidence < 0.6) {
		return `low-confidence discusses edge (${edge.confidence})`;
	}

	return null;
}
