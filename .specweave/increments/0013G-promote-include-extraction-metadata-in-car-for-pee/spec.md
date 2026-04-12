# feat(promote): include extraction metadata in CAR for peer improvement

**Increment**: 0013G-promote-include-extraction-metadata-in-car-for-pee
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #163

## Description

## Summary

When promoting a collection to FOC, only segments and the manifest are bundled into the CAR file. The extraction metadata files (`extraction-status.json`, `edges-overlay.json`) are not included, which means peers who fetch the collection cannot:

1. **Know what was already extracted** — they can't skip already-processed contexts
2. **Know which model was used** — they can't decide "these were extracted with haiku, I'll re-run with opus"
3. **Incrementally improve** — they must re-extract everything from scratch or accept the existing edges as-is

## Current state

| Artifact | In CAR? | Peers get it? |
|----------|---------|---------------|
| Segment data (with materialized edges) | Yes | Yes |
| Manifest (collection head) | Yes | Yes |
| `edges-overlay.json` | No | No |
| `extraction-status.json` | No | No |

After `materialize-edges`, the LLM edges are baked into segment data, so peers do get the edges themselves. But they lose the provenance and incremental state.

## Proposal

### Option A: Bundle extraction-status.json in the CAR

During promote, include the extraction-status.json as a sidecar artifact alongside the manifest. This gives peers:
- Context hashes (to detect what changed)
- Extractor model name (to decide if re-extraction is worthwhile)
- Per-context completion status

The overlay file would typically be empty after materialization, so it doesn't need bundling.

### Option B: Store extraction metadata in the manifest

Add an `extractionMetadata` field to the CollectionHead:
```typescript
extractionMetadata?: {
  extractorModel: string;
  contextCount: number;
  completedCount: number;
  lastExtractedAt: string;
}
```

Lighter weight, but loses per-context granularity.

### Option C: Both

Bundle full status as sidecar, summary in manifest.

## Why this matters

wtfoc's value proposition is a **shareable, improvable knowledge graph**. If a peer fetches a collection and wants to:
- Re-extract with a better model
- Extract edges for new contexts added by a different peer
- Audit which model produced which edges

...they need the extraction metadata to do this efficiently rather than starting from scratch.

## Related

- #154 — overlay edge pipeline
- #162 — PR implementing materialize-edges and promote warning
- The manifest chain pattern (SPEC.md) already supports extensibility via optional fields

## User Stories

- **US-001**: As a user, I want promote include extraction metadata in car for pee so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #163 on 2026-04-12.
