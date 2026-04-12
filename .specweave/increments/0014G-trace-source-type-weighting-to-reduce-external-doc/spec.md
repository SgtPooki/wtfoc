# feat(trace): source-type weighting to reduce external doc dominance in results

**Increment**: 0014G-trace-source-type-weighting-to-reduce-external-doc
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #161

## Description

## Summary

When a collection has a large proportion of one source type (e.g. 76% doc-pages from external docs like LangChain, GraphRAG), semantic search results can be dominated by that type, crowding out more relevant wtfoc-specific code, markdown, and GitHub content.

## Evidence

Testing against `wtfoc-source-v2` (10,178 chunks, 8,766 edges):

- Query "how does the chunking algorithm work" → only 2/15 hops via edges, 13 semantic results mostly from external doc-pages about chunking, not wtfoc's own `chunker.ts`
- Query "embedding models" → finds external embedding docs before wtfoc's actual OpenAIEmbedder/TransformersEmbedder code
- Queries about issues/roadmap/MCP → 14/15 edge hops, excellent results (edges bypass the doc-page dominance)

## Source type distribution in wtfoc-source-v2

| Source type | Chunks | % |
|-------------|--------|---|
| doc-page | 7,748 | 76% |
| code | 1,350 | 13% |
| markdown | 571 | 6% |
| github-pr-comment | 301 | 3% |
| github-issue | 134 | 1% |
| github-pr | 55 | <1% |

## Potential solutions

1. **Source-type boost/penalty in trace** — apply a configurable weight multiplier per source type so first-party content (code, markdown, issues) ranks higher than third-party (doc-page)
2. **Collection-level source weighting** — let `.wtfoc.json` define per-source-type weights
3. **Diversity enforcement in semantic fallback** — the existing `maxPerSource` already helps, but the initial seed search doesn't account for source type distribution
4. **Query-time filter** — `wtfoc trace --source-types code,markdown,github-issue` to exclude doc-pages entirely
5. **Separate collections** — keep external docs in a separate collection, merge at query time

## Related

- The semantic fallback in `trace.ts` already fills underrepresented source types, but the initial vector search seeds are biased toward the majority type

## User Stories

- **US-001**: As a user, I want trace source type weighting to reduce external doc so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #161 on 2026-04-12.
