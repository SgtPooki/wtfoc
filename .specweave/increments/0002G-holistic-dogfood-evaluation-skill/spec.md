# feat: holistic dogfood evaluation skill

**Increment**: 0002G-holistic-dogfood-evaluation-skill
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #206

## Description

## Context

The edge-quality eval harness (#203, PR #204) provides data-driven quality measurement for the LLM edge extraction pipeline. However, edge extraction is just one slice of the wtfoc pipeline. We need a holistic evaluation framework that exercises the full ingest-to-search pipeline.

## Goal

Create a `/dogfood` skill (or CLI command `wtfoc dogfood`) that runs a comprehensive quality evaluation across the entire pipeline and produces an actionable report.

## Evaluation stages

### 1. Ingest quality
- Does each adapter produce well-formed chunks with correct metadata?
- Are chunks appropriately sized?
- Are `documentId` / `documentVersionId` / `contentFingerprint` populated?

### 2. Edge extraction quality (already built in #204)
- LLM extraction precision/recall/F1 against gold set
- Acceptance gate behavior (acceptance/rejection/downgrade rates)
- Per-extractor contribution (regex vs heuristic vs LLM vs code vs temporal)

### 3. Edge resolution quality
- Resolution rate (currently 23% per #193)
- Normalization coverage (repo ref canonicalization, etc.)
- Cross-source edge density

### 4. Storage quality
- Segment integrity
- Derived edge layer consistency
- Document catalog accuracy

### 5. Search/retrieval quality
- Query relevance scoring
- Provenance chain completeness
- Source-type coverage in results

## Design

- Each stage produces a structured report (like `EvalReport` in the edge eval)
- A top-level aggregator combines all stage reports into a unified dogfood report
- Reports are versioned and timestamped for longitudinal comparison
- The eval harness from #204 becomes a module within this framework

## Running

```bash
# Full dogfood evaluation
wtfoc dogfood --collection <name> --extractor-url lmstudio --extractor-model <model>

# Individual stages
wtfoc dogfood --stage edges --collection <name>
wtfoc dogfood --stage ingest --collection <name>
wtfoc dogfood --stage search --collection <name>
```

## Related

- #203 — Edge quality eval (v1, done in PR #204)
- #193 — 77% edges unresolved
- #3 — Edge extraction beyond regex
- #161 — Source-type weighting

## User Stories

- **US-001**: As a user, I want holistic dogfood evaluation skill so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #206 on 2026-04-12.
