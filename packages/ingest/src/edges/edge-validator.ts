import type { Edge } from "@wtfoc/common";

/**
 * Post-extraction acceptance gates for LLM-produced edges.
 * Filters out low-quality edges and downgrades overclaimed relations.
 */

/** Placeholder patterns that indicate an unresolved target */
const PLACEHOLDER_PATTERNS = [
	/^LINK_TO_/i,
	/^TODO/i,
	/^TBD$/i,
	/^PLACEHOLDER/i,
	/^INSERT_/i,
	/^EXAMPLE_/i,
	/^\[.*\]$/,
	/^#$/,
];

/** Proposal/planning language — indicates intent, not fact */
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

/** "Context only" evidence that supports mention/reference, not strong relations */
const CONTEXT_ONLY_PATTERNS = [
	/^Context:/i,
	/^see\s+[#@]/i,
	/^see\s+http/i,
	/^flagged by/i,
	/^related to/i,
	/^fictional,?\s+see/i,
	/^mentioned in/i,
	/^cf\.\s/i,
];

/** Uncertainty markers — reject for strong factual relations */
const UNCERTAINTY_PATTERNS = [
	/\bmaybe\b/i,
	/\bprobably\b/i,
	/\blikely\b/i,
	/\bsoon will\b/i,
	/\bmight\b/i,
	/\bpossibly\b/i,
];

/** Relation-specific cue words — evidence must contain at least one for strong types */
const RELATION_CUES: Record<string, RegExp[]> = {
	addresses: [
		/\bfix/i,
		/\bresolv/i,
		/\baddress/i,
		/\bhandl/i,
		/\bmitigat/i,
		/\bwork(?:ing)?\s+(?:on|for)\b/i,
		/\btackl/i,
		/\bsolv/i,
	],
	changes: [
		/\bchang/i,
		/\bupdat/i,
		/\bmodif/i,
		/\brenam/i,
		/\bremov/i,
		/\badd(?:ed|s|ing)?\s+support/i,
		/\brefactor/i,
		/\bmigrat/i,
	],
	implements: [
		/\bimplement/i,
		/\bread?liz/i,
		/\bbuild/i,
		/\bcreate[sd]?\b/i,
		/\badd(?:ed|s|ing)?\b/i,
	],
	closes: [/\bclose[sd]?\b/i, /\bfix(?:e[sd])?\b/i, /\bresolve[sd]?\b/i],
	tests: [/\btest/i, /\bverif/i, /\bvalidat/i, /\bcheck/i, /\bassert/i],
};

/** Target types that are incompatible with certain edge types */
const INCOMPATIBLE_TARGET_TYPES: Record<string, Set<string>> = {
	addresses: new Set(["organization", "person", "event"]),
	changes: new Set(["pr", "organization", "person", "concept"]),
	implements: new Set(["organization", "person"]),
	closes: new Set(["organization", "person", "concept"]),
};

/** Target types that require resolvable IDs */
const RESOLVABLE_TARGET_TYPES = new Set(["file", "issue", "pr", "url", "document"]);

const MIN_TARGET_ID_LENGTH = 3;

export interface ValidationResult {
	accepted: Edge[];
	rejected: Array<{ edge: Edge; reason: string }>;
}

/**
 * Validate and filter LLM-extracted edges through acceptance gates.
 * Some edges are downgraded to weaker types rather than rejected.
 */
export function validateEdges(edges: Edge[]): ValidationResult {
	const accepted: Edge[] = [];
	const rejected: Array<{ edge: Edge; reason: string }> = [];

	for (const edge of edges) {
		const downgraded = maybeDowngrade(edge);
		const reason = getRejectReason(downgraded);
		if (reason) {
			rejected.push({ edge: downgraded, reason });
		} else {
			accepted.push(downgraded);
		}
	}

	return { accepted, rejected };
}

/**
 * Downgrade overclaimed relations to weaker types based on evidence quality.
 */
function maybeDowngrade(edge: Edge): Edge {
	// Downgrade: "context only" evidence on strong relations → references
	const strongTypes = new Set(["addresses", "implements", "changes", "closes", "tests"]);
	if (strongTypes.has(edge.type)) {
		for (const pattern of CONTEXT_ONLY_PATTERNS) {
			if (pattern.test(edge.evidence)) {
				return { ...edge, type: "references" };
			}
		}
	}

	// Downgrade: target type incompatible with edge type
	const incompatible = INCOMPATIBLE_TARGET_TYPES[edge.type];
	if (incompatible?.has(edge.targetType)) {
		return { ...edge, type: "references" };
	}

	// Downgrade: strong relation without relation-specific cues → references
	const cues = RELATION_CUES[edge.type];
	if (cues && cues.length > 0) {
		const hasCue = cues.some((pattern) => pattern.test(edge.evidence));
		if (!hasCue) {
			return { ...edge, type: "references" };
		}
	}

	// Downgrade: "changes -> pr" → references (changes is for files/behavior, not PRs)
	if (edge.type === "changes" && edge.targetType === "pr") {
		return { ...edge, type: "references" };
	}

	return edge;
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
				return `proposal language in "${edge.type}": ${edge.evidence.slice(0, 80)}`;
			}
		}
	}

	// Gate 3: Reject too-short target IDs
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

	// Gate 6: Reject low-confidence discusses edges
	if (edge.type === "discusses" && edge.confidence < 0.6) {
		return `low-confidence discusses edge (${edge.confidence})`;
	}

	// Gate 7: Reject uncertainty markers in strong factual relations
	const strongFactual = new Set(["implements", "changes", "closes", "tests"]);
	if (strongFactual.has(edge.type)) {
		for (const pattern of UNCERTAINTY_PATTERNS) {
			if (pattern.test(edge.evidence)) {
				return `uncertainty in factual "${edge.type}": ${edge.evidence.slice(0, 80)}`;
			}
		}
	}

	return null;
}
