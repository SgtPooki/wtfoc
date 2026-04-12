# quality: 77% of edges unresolved — edge resolution and normalization need improvement

**Increment**: 0006G-77-of-edges-unresolved-edge-resolution-and-normali
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #193

## Description

## Problem

After building the wtfoc-source-v3 collection (repo + GitHub sources, 2,504 chunks, 2,279 LLM-extracted edges + heuristic edges), the edge resolution stats are poor:

```
Total edges:      4,108
Resolved edges:     936 (23%)
Unresolved edges: 3,169 (77%)
Bare refs:            3
```

## Analysis

### 1. Same repo in multiple formats (normalization gap)
The \`unresolvedByRepo\` breakdown shows the same repo in inconsistent formats:
```json
"SgtPooki/wtfoc": 38,
"github.com/SgtPooki/wtfoc": 10,
"https://github.com/SgtPooki/wtfoc": 1
```
These 49 edges all point to the same repo but can't resolve because the target format doesn't match the chunk source format.

### 2. Placeholder references polluting edges
```json
"owner/repo": 41
```
These come from example text and should never become edges.

### 3. Edges pointing to non-ingested repos
```json
"FilOzone/pdp": 10,
"FilOzone/synapse-sdk": 4,
"FILCAT/pdp": 6
```
These are legitimate cross-repo references but can't resolve without those repos being ingested. This is expected behavior, but could be surfaced better.

### 4. Bulk of unresolved edges (3,169 - 112 repo refs = ~3,057)
The majority of unresolved edges are likely within-collection references (file paths, function names, concepts) that the LLM extractor produced but that don't match any chunk ID or source field. This suggests the LLM prompt may need better guidance on producing resolvable target IDs.

## Impact

Low edge resolution means trace quality degrades — the traversal engine can only follow ~23% of edges, limiting the connection discovery that makes wtfoc valuable.

## Suggested improvements

1. **Normalize repo refs before resolution**: Canonicalize \`github.com/X/Y\`, \`https://github.com/X/Y\` → \`X/Y\`
2. **Filter placeholder edges**: Skip edges targeting \`owner/repo\`, \`example/*\`, etc.
3. **Improve LLM prompt for resolvable targets**: Guide the LLM to use chunk IDs or source fields from the input chunks rather than inventing target identifiers
4. **Report resolution rate**: After extraction/materialization, show the resolution rate as a quality signal

---
Found during dogfooding: building wtfoc-source-v3 collection from the wtfoc repo itself.

## User Stories

- **US-001**: As a user, I want 77 of edges unresolved edge resolution and normali so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #193 on 2026-04-12.
