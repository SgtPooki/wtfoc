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
 *
 * Gold edges support `acceptableAlternatives` for cases where multiple
 * type/target interpretations are valid (e.g., "discusses" or "references"
 * for the same target). This avoids penalizing plausible model outputs.
 */

export type MatchMode = "exact" | "substring" | "regex";

/** An acceptable alternative interpretation of a gold edge */
export interface AlternativeMatch {
	/** Override type (defaults to the gold edge's type) */
	type?: string;
	/** Override targetType (defaults to the gold edge's targetType) */
	targetType?: string;
	/** Override targetPattern (defaults to the gold edge's targetPattern) */
	targetPattern?: string;
	/** Override match mode (defaults to the gold edge's match) */
	match?: MatchMode;
}

export interface GoldEdge {
	/** Canonical edge type expected */
	type: string;
	/** Expected target type */
	targetType: string;
	/** Pattern to match against targetId */
	targetPattern: string;
	/** How to match targetPattern against the produced targetId */
	match: MatchMode;
	/** Alternative interpretations that also count as true positives */
	acceptableAlternatives?: AlternativeMatch[];
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
				acceptableAlternatives: [
					{ type: "references", targetType: "document" },
					{ type: "references", targetType: "file" },
				],
			},
			{ type: "closes", targetType: "issue", targetPattern: "#142", match: "substring" },
			{
				type: "changes",
				targetType: "file",
				targetPattern: "llm.ts",
				match: "substring",
				acceptableAlternatives: [
					{ type: "references", targetType: "file" },
					{ type: "documents", targetType: "file" },
				],
			},
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
				acceptableAlternatives: [{ type: "references", targetType: "person" }],
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
				acceptableAlternatives: [{ type: "documents", targetType: "file" }],
			},
			{ type: "references", targetType: "pr", targetPattern: "#189", match: "substring" },
			{
				type: "addresses",
				targetType: "concept",
				targetPattern: "rate limit",
				match: "substring",
				// This could also be "discusses" or "references" — a bug report
				// mentioning rate limits doesn't necessarily "address" them
				acceptableAlternatives: [
					{ type: "discusses", targetType: "concept" },
					{ type: "references", targetType: "concept" },
				],
			},
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
				acceptableAlternatives: [
					{ type: "references", targetType: "file" },
					{ type: "documents", targetType: "file" },
				],
			},
			{
				type: "addresses",
				targetType: "concept",
				targetPattern: "false positive",
				match: "substring",
				acceptableAlternatives: [
					{ type: "discusses", targetType: "concept" },
					{ type: "references", targetType: "concept" },
				],
			},
		],
	},

	// ── Chunk 4: TypeScript code with imports ─────────────────────────
	{
		chunkId: "eval-chunk-04",
		expectedEdges: [
			{
				type: "imports",
				targetType: "file",
				targetPattern: "edge-validator",
				match: "substring",
				acceptableAlternatives: [
					{ type: "references", targetType: "file" },
					{ type: "depends-on", targetType: "file" },
				],
			},
			{
				type: "imports",
				targetType: "file",
				targetPattern: "llm-client",
				match: "substring",
				acceptableAlternatives: [
					{ type: "references", targetType: "file" },
					{ type: "depends-on", targetType: "file" },
				],
			},
		],
	},

	// ── Chunk 5: Architecture documentation ───────────────────────────
	{
		chunkId: "eval-chunk-05",
		expectedEdges: [
			{
				type: "documents",
				targetType: "file",
				targetPattern: "extractor.ts",
				match: "substring",
				acceptableAlternatives: [{ type: "references", targetType: "file" }],
			},
			{
				type: "documents",
				targetType: "file",
				targetPattern: "heuristic.ts",
				match: "substring",
				acceptableAlternatives: [{ type: "references", targetType: "file" }],
			},
			{
				type: "references",
				targetType: "file",
				targetPattern: "merge.ts",
				match: "substring",
				acceptableAlternatives: [{ type: "documents", targetType: "file" }],
			},
			{
				type: "depends-on",
				targetType: "package",
				targetPattern: "@wtfoc/common",
				match: "exact",
				acceptableAlternatives: [
					{ type: "references", targetType: "package" },
					{ type: "imports", targetType: "package" },
				],
			},
		],
	},

	// ── Chunk 6: Slack discussion with links ──────────────────────────
	{
		chunkId: "eval-chunk-06",
		expectedEdges: [
			{
				type: "references",
				targetType: "issue",
				targetPattern: "#193",
				match: "substring",
				acceptableAlternatives: [{ type: "references", targetType: "url" }],
			},
			{ type: "references", targetType: "pr", targetPattern: "#195", match: "substring" },
			{
				type: "discusses",
				targetType: "concept",
				targetPattern: "resolution",
				match: "substring",
				acceptableAlternatives: [
					{ type: "discusses", targetType: "concept", targetPattern: "normalization" },
					{ type: "references", targetType: "concept" },
				],
			},
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
				// Slack message attribution could be "mentions" which normalizes to "discusses"
				acceptableAlternatives: [
					{ type: "discusses", targetType: "person" },
					{ type: "references", targetType: "person" },
				],
			},
		],
	},

	// ── Chunk 7: NEGATIVE — Proposal language ─────────────────────────
	{
		chunkId: "eval-chunk-07",
		expectedEdges: [
			// cc @danielrios is a mention, not authorship — accept discusses/references too
			{
				type: "discusses",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
				acceptableAlternatives: [
					{ type: "references", targetType: "person" },
					{ type: "authored-by", targetType: "person" },
				],
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
	{
		chunkId: "eval-chunk-09",
		expectedEdges: [
			// After downgrade, these should be references, not discusses
			{
				type: "references",
				targetType: "pr",
				targetPattern: "#195",
				match: "substring",
				acceptableAlternatives: [{ type: "discusses", targetType: "pr" }],
			},
			{
				type: "references",
				targetType: "issue",
				targetPattern: "#102",
				match: "substring",
				acceptableAlternatives: [{ type: "discusses", targetType: "issue" }],
			},
		],
		forbiddenEdges: [{ type: "closes" }, { type: "implements" }],
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
			{
				type: "references",
				targetType: "issue",
				targetPattern: "#203",
				match: "substring",
				acceptableAlternatives: [{ type: "discusses", targetType: "issue" }],
			},
			{
				type: "changes",
				targetType: "file",
				targetPattern: "llm-client.ts",
				match: "substring",
				acceptableAlternatives: [
					{ type: "references", targetType: "file" },
					{ type: "documents", targetType: "file" },
				],
			},
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
				acceptableAlternatives: [
					{ type: "discusses", targetType: "concept", targetPattern: "traversal" },
					{ type: "references", targetType: "concept" },
				],
			},
			{
				type: "discusses",
				targetType: "concept",
				targetPattern: "source-type weighting",
				match: "substring",
				acceptableAlternatives: [
					{ type: "discusses", targetType: "concept", targetPattern: "weighting" },
					{ type: "discusses", targetType: "concept", targetPattern: "scoring" },
					{ type: "references", targetType: "concept" },
				],
			},
			{
				type: "authored-by",
				targetType: "person",
				targetPattern: "danielrios",
				match: "substring",
				acceptableAlternatives: [
					{ type: "discusses", targetType: "person" },
					{ type: "references", targetType: "person" },
				],
			},
		],
	},
];

/** Version identifier for this gold set — include in eval reports for traceability. */
export const GOLD_SET_VERSION = "v2-relaxed-2026-04-12";
