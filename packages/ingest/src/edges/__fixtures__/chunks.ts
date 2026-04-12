import type { Chunk } from "@wtfoc/common";

/** Helper to build a fixture chunk with sensible defaults. */
function chunk(
	id: string,
	content: string,
	sourceType: string,
	source: string,
	overrides: Partial<Chunk> = {},
): Chunk {
	return {
		id,
		content,
		sourceType,
		source,
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		...overrides,
	};
}

/**
 * Frozen fixture chunks for edge-quality evaluation.
 *
 * 12 chunks across 5 source types (github-pr, github-issue, code, markdown, slack-message).
 * Chunks 1-6 and 11-12 are positive examples (should produce edges).
 * Chunks 7-10 are negative/adversarial examples (should be rejected or downgraded).
 */
export const FIXTURE_CHUNKS: Chunk[] = [
	// ── Positive examples ─────────────────────────────────────────────

	// 1. PR implementing a feature and closing an issue
	chunk(
		"eval-chunk-01",
		`## feat(ingest): add LLM edge extraction pipeline

This PR implements the LLM-based edge extraction pipeline described in the architecture RFC (docs/rfcs/003-edge-extraction.md).

Closes #142

Changes:
- Added \`packages/ingest/src/edges/llm.ts\` — main extractor class
- Added \`packages/ingest/src/edges/llm-prompt.ts\` — system prompt with few-shot examples
- Added \`packages/ingest/src/edges/llm-client.ts\` — OpenAI-compatible HTTP client

Author: @danielrios

The extractor normalizes freeform LLM labels to 14 canonical edge types and clamps confidence to the 0.3–0.8 range.`,
		"github-pr",
		"SgtPooki/wtfoc#150",
	),

	// 2. Bug report referencing files and another PR
	chunk(
		"eval-chunk-02",
		`## Bug: edge extraction silently drops all edges on 429 rate limit

When the LLM endpoint returns HTTP 429, the extractor in \`packages/ingest/src/edges/llm-client.ts\` catches the error but returns an empty array instead of retrying. This means large ingestions silently lose edges for rate-limited batches.

Reproduction:
1. Start LM Studio with a small context model
2. Run \`wtfoc ingest\` on a collection with 500+ chunks
3. Observe 0 edges for batches after the rate limit kicks in

The fix in PR #189 adds exponential backoff retry, but it hasn't been merged yet.

See also: packages/ingest/src/edges/llm.ts line 140 where the semaphore controls concurrency.`,
		"github-issue",
		"SgtPooki/wtfoc#188",
	),

	// 3. Code review comment about fixing a bug
	chunk(
		"eval-chunk-03",
		`Review comment on packages/ingest/src/edges/edge-validator.ts:

The current placeholder detection misses targets like "INSERT_LINK_HERE" because the regex only checks for "LINK_TO_" prefix. I've updated the pattern list to also catch "INSERT_" prefixed targets.

Also changed the minimum evidence length from 5 to 10 characters — 5 chars was too permissive and let through evidence like "see #42" which doesn't actually explain the relationship.

These changes fix the false positive rate we observed in the wtfoc-source-v3 collection where 41 edges pointed to "owner/repo" placeholder text.`,
		"github-pr",
		"SgtPooki/wtfoc#195",
	),

	// 4. TypeScript code with imports
	chunk(
		"eval-chunk-04",
		`import type { Chunk, Edge, EdgeExtractor, StructuredEvidence } from "@wtfoc/common";
import { validateEdges } from "./edge-validator.js";
import { chatCompletion, type LlmClientOptions, parseJsonResponse } from "./llm-client.js";
import { buildExtractionMessages, estimatePromptOverhead, estimateTokens } from "./llm-prompt.js";

export class LlmEdgeExtractor implements EdgeExtractor {
  readonly #options: LlmEdgeExtractorOptions;

  constructor(options: LlmEdgeExtractorOptions) {
    this.#options = options;
  }

  async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
    signal?.throwIfAborted();
    if (chunks.length === 0) return [];
    // ... implementation
  }
}`,
		"code",
		"SgtPooki/wtfoc:packages/ingest/src/edges/llm.ts",
	),

	// 5. Architecture documentation
	chunk(
		"eval-chunk-05",
		`# Edge Extraction Architecture

The edge extraction pipeline processes chunks through multiple extractors in parallel:

1. **RegexEdgeExtractor** — Pattern-based extraction for explicit references (GitHub issue refs like \`#123\`, \`owner/repo#456\`, closing keywords). Documented in \`packages/ingest/src/edges/extractor.ts\`.

2. **HeuristicEdgeExtractor** — Slack permalinks, Jira keys (PROJ-123), Markdown hyperlinks. See \`packages/ingest/src/edges/heuristic.ts\`.

3. **LlmEdgeExtractor** — Semantic relationship detection via any OpenAI-compatible endpoint. Depends on the \`@wtfoc/common\` package for type definitions.

4. **CompositeEdgeExtractor** — Orchestrates all extractors and merges results via \`packages/ingest/src/edges/merge.ts\`.

All extracted edges pass through acceptance gates (\`edge-validator.ts\`) before storage.`,
		"markdown",
		"SgtPooki/wtfoc:docs/architecture/edge-extraction.md",
	),

	// 6. Slack discussion with links
	chunk(
		"eval-chunk-06",
		`<@danielrios> in #foc-dev:
Hey, I've been looking at the edge resolution stats from the latest wtfoc-source-v3 run and the numbers are rough — 77% unresolved. Most of the problem is repo reference normalization: we have "SgtPooki/wtfoc", "github.com/SgtPooki/wtfoc", and "https://github.com/SgtPooki/wtfoc" all as separate targets.

I filed https://github.com/SgtPooki/wtfoc/issues/193 to track it. The acceptance gates we added in #195 help with placeholder targets but don't touch normalization.

I think the real fix is canonicalizing repo refs before edge resolution — strip the domain prefix and normalize to owner/repo format.`,
		"slack-message",
		"#foc-dev",
		{ timestamp: "2026-04-10T14:30:00Z" },
	),

	// ── Negative / adversarial examples ───────────────────────────────

	// 7. NEGATIVE: Proposal language — should NOT produce implements/changes/closes
	chunk(
		"eval-chunk-07",
		`## Proposal: Add arXiv paper adapter

We should add an arXiv adapter to wtfoc so that research papers can be ingested alongside code and issues. This would be good to have for the academic use case.

I think we should implement it as a new source adapter in \`packages/ingest/src/adapters/arxiv.ts\`. It belongs in the same package as the other adapters.

We need to consider adding PDF parsing support too. The plan is to use a lightweight PDF-to-text library.

cc @danielrios — what do you think? Makes sense to prioritize this after the edge quality work lands.`,
		"github-issue",
		"SgtPooki/wtfoc#125",
	),

	// 8. NEGATIVE: Placeholder targets and uncertainty
	chunk(
		"eval-chunk-08",
		`## Draft: Edge confidence calibration

This PR might fix the confidence scoring issue. The changes probably affect how edges are weighted during search.

TODO: Link to the relevant issue
- Changes to LINK_TO_SCORING_MODULE
- Updates to PLACEHOLDER_CONFIG
- Maybe addresses the concern in [TBD]

This will likely need more work. I'm not sure if the approach is correct yet.`,
		"github-pr",
		"SgtPooki/wtfoc#999",
	),

	// 9. NEGATIVE: Status/temporal language — discusses should downgrade to references
	chunk(
		"eval-chunk-09",
		`<@sgtpooki> in #foc-dev:
Quick status update: PR #195 has been merged and the acceptance gates are now live. The edge quality improvements will be deployed soon.

The incremental ingest work (#102) is still blocked on the document catalog PR. That will be landed once the review is done.

Up until now we've been doing full re-ingestion on every run, but #102 will fix that.`,
		"slack-message",
		"#foc-dev",
		{ timestamp: "2026-04-11T09:00:00Z" },
	),

	// 10. NEGATIVE: Plain factual listing — should produce no edges
	chunk(
		"eval-chunk-10",
		`## Release Notes v0.0.3

- Improved error messages for missing configuration
- Updated Node.js engine requirement to >=24
- Bumped crawlee dependency to ^3.16.0
- Fixed TypeScript strict mode warnings
- Cleaned up unused imports across packages`,
		"markdown",
		"SgtPooki/wtfoc:CHANGELOG.md",
	),

	// ── More positive examples ────────────────────────────────────────

	// 11. Multi-issue PR
	chunk(
		"eval-chunk-11",
		`## fix(ingest): 4 correctness bugs from Codex comprehensive review

Closes #193 — fixes repo reference normalization so "github.com/X/Y" and "https://github.com/X/Y" both resolve to "X/Y".

Closes #188 — adds exponential backoff retry on 429 rate limits with Retry-After header support.

Also references #203 which tracks the broader edge quality validation effort. This PR doesn't fully address #203 but provides the foundation.

Changes:
- \`packages/ingest/src/edges/llm-client.ts\`: retry logic with backoff
- \`packages/ingest/src/edges/extractor.ts\`: repo ref normalization
- \`packages/ingest/src/edges/edge-validator.ts\`: tighter placeholder patterns
- \`packages/ingest/src/edges/llm.ts\`: improved error surfacing`,
		"github-pr",
		"SgtPooki/wtfoc#200",
	),

	// 12. Architecture discussion with concept targets
	chunk(
		"eval-chunk-12",
		`<@danielrios> in #foc-dev:
Been thinking about the knowledge graph traversal strategy. The current approach depends on edge confidence for ranking, but we also need source-type weighting — external docs shouldn't dominate over first-party code and issues.

This connects to the embedding model flexibility discussion. If we switch from MiniLM to a larger model, the semantic similarity scores change and that affects how edges interact with search results.

The core problem is that edge extraction and search relevance are coupled but tuned independently. We need a unified scoring framework that considers both.`,
		"slack-message",
		"#foc-dev",
		{ timestamp: "2026-04-09T16:45:00Z" },
	),
];
