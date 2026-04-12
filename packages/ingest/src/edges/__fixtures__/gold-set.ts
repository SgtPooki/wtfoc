/**
 * Gold-set definitions for edge-quality evaluation.
 *
 * Each entry maps a fixture chunk ID to expected edges (positive assertions)
 * and negative assertions (edges that should NOT appear).
 *
 * Match modes:
 * - "exact"     — targetId must match exactly
 * - "substring" — targetId must contain the pattern
 * - "regex"     — targetId must match the regex pattern
 */

export type MatchMode = "exact" | "substring" | "regex";

export interface GoldEdge {
	/** Canonical edge type expected */
	type: string;
	/** Expected target type */
	targetType: string;
	/** Pattern to match against targetId */
	targetPattern: string;
	/** How to match targetPattern against the produced targetId */
	match: MatchMode;
}

export interface ForbiddenEdge {
	/** Edge type that must NOT appear */
	type: string;
	/** Optional: only forbidden for this target type */
	targetType?: string;
}

export interface GoldEntry {
	chunkId: string;
	/** Edges that should be found — missing ones count as false negatives */
	expectedEdges: GoldEdge[];
	/** Specific edges that must NOT appear — present ones count as false positives */
	forbiddenEdges?: ForbiddenEdge[];
	/** If true, the chunk should produce zero accepted edges */
	expectNoEdges?: boolean;
}

export const GOLD_SET: GoldEntry[] = [
	// ── Chunk 1: PR implementing feature, closes issue ────────────────
	{
		chunkId: "eval-chunk-01",
		expectedEdges: [
			{
				type: "implements",
				targetType: "document",
				targetPattern: "003-edge-extraction",
				match: "substring",
			},
			{ type: "closes", targetType: "issue", targetPattern: "#142", match: "substring" },
			{ type: "changes", targetType: "file", targetPattern: "llm.ts", match: "substring" },
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
			},
		],
	},

	// ── Chunk 2: Bug report referencing files and PR ──────────────────
	{
		chunkId: "eval-chunk-02",
		expectedEdges: [
			{
				type: "references",
				targetType: "file",
				targetPattern: "llm-client.ts",
				match: "substring",
			},
			{ type: "references", targetType: "pr", targetPattern: "#189", match: "substring" },
			{ type: "addresses", targetType: "concept", targetPattern: "rate limit", match: "substring" },
		],
	},

	// ── Chunk 3: Code review fixing a bug ─────────────────────────────
	{
		chunkId: "eval-chunk-03",
		expectedEdges: [
			{
				type: "changes",
				targetType: "file",
				targetPattern: "edge-validator.ts",
				match: "substring",
			},
			{
				type: "addresses",
				targetType: "concept",
				targetPattern: "false positive",
				match: "substring",
			},
		],
	},

	// ── Chunk 4: TypeScript code with imports ─────────────────────────
	// Note: LLM may extract imports but the regex extractor handles these better.
	// We mainly check the LLM doesn't hallucinate unrelated edges.
	{
		chunkId: "eval-chunk-04",
		expectedEdges: [
			{ type: "imports", targetType: "file", targetPattern: "edge-validator", match: "substring" },
			{ type: "imports", targetType: "file", targetPattern: "llm-client", match: "substring" },
		],
	},

	// ── Chunk 5: Architecture documentation ───────────────────────────
	{
		chunkId: "eval-chunk-05",
		expectedEdges: [
			{ type: "documents", targetType: "file", targetPattern: "extractor.ts", match: "substring" },
			{ type: "documents", targetType: "file", targetPattern: "heuristic.ts", match: "substring" },
			{ type: "references", targetType: "file", targetPattern: "merge.ts", match: "substring" },
			{ type: "depends-on", targetType: "package", targetPattern: "@wtfoc/common", match: "exact" },
		],
	},

	// ── Chunk 6: Slack discussion with links ──────────────────────────
	{
		chunkId: "eval-chunk-06",
		expectedEdges: [
			{ type: "references", targetType: "issue", targetPattern: "#193", match: "substring" },
			{ type: "references", targetType: "pr", targetPattern: "#195", match: "substring" },
			{
				type: "discusses",
				targetType: "concept",
				targetPattern: "edge resolution",
				match: "substring",
			},
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
			},
		],
	},

	// ── Chunk 7: NEGATIVE — Proposal language ─────────────────────────
	{
		chunkId: "eval-chunk-07",
		expectedEdges: [
			// It's fine to produce weak references or discusses for mentioned entities
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
			},
		],
		forbiddenEdges: [
			// Proposal language should NOT produce strong factual types
			{ type: "implements" },
			{ type: "changes" },
			{ type: "closes" },
		],
	},

	// ── Chunk 8: NEGATIVE — Placeholders and uncertainty ──────────────
	{
		chunkId: "eval-chunk-08",
		// Gates should reject placeholder targets and uncertainty language
		expectNoEdges: true,
		expectedEdges: [],
		forbiddenEdges: [
			{ type: "implements" },
			{ type: "changes" },
			{ type: "closes" },
			{ type: "addresses" },
		],
	},

	// ── Chunk 9: NEGATIVE — Status/temporal language ──────────────────
	// "discusses" with status language should downgrade to "references"
	{
		chunkId: "eval-chunk-09",
		expectedEdges: [
			// After downgrade, these should be references, not discusses
			{ type: "references", targetType: "pr", targetPattern: "#195", match: "substring" },
			{ type: "references", targetType: "issue", targetPattern: "#102", match: "substring" },
		],
		forbiddenEdges: [
			// Status language should prevent strong types
			{ type: "closes" },
			{ type: "implements" },
		],
	},

	// ── Chunk 10: NEGATIVE — Plain listing, no relations ──────────────
	{
		chunkId: "eval-chunk-10",
		expectNoEdges: true,
		expectedEdges: [],
	},

	// ── Chunk 11: Multi-issue PR ──────────────────────────────────────
	{
		chunkId: "eval-chunk-11",
		expectedEdges: [
			{ type: "closes", targetType: "issue", targetPattern: "#193", match: "substring" },
			{ type: "closes", targetType: "issue", targetPattern: "#188", match: "substring" },
			{ type: "references", targetType: "issue", targetPattern: "#203", match: "substring" },
			{ type: "changes", targetType: "file", targetPattern: "llm-client.ts", match: "substring" },
		],
	},

	// ── Chunk 12: Architecture discussion with concepts ───────────────
	{
		chunkId: "eval-chunk-12",
		expectedEdges: [
			{
				type: "discusses",
				targetType: "concept",
				targetPattern: "knowledge graph",
				match: "substring",
			},
			{
				type: "discusses",
				targetType: "concept",
				targetPattern: "source-type weighting",
				match: "substring",
			},
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
			},
		],
	},
];

/** Version identifier for this gold set — include in eval reports for traceability. */
export const GOLD_SET_VERSION = "v1-seed-2026-04-12";
