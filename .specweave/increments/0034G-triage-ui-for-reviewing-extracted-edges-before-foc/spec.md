# [feat] Triage UI for reviewing extracted edges before FOC promotion

**Increment**: 0034G-triage-ui-for-reviewing-extracted-edges-before-foc
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #69

## Description

## Summary

Add a review interface for validating extracted edges before promoting
a collection to FOC storage. Triage includes approval, rejection, and
reviewer overrides — a human-in-the-loop quality gate for the knowledge
graph. This is a UI/API layer over the existing regex EdgeExtractor,
not a change to the seam itself.

**Blocked on:** #67 (`wtfoc serve`)

## Motivation

Edge extraction is currently regex-based and can produce false positives
or miss nuanced connections. Since FOC storage is immutable — once a
segment is uploaded, it cannot be edited — there should be a way to
review and validate edges before committing to decentralized storage.

This is especially important as wtfoc adds noisier sources (community
forums, chat) where regex edge extraction is less reliable.

## Proposed design

### Integration with `wtfoc serve` (#67)

Adds a triage mode to the local server UI from #67. The triage view is
a separate page/tab presenting edges for review. All triage work happens
against a local collection served by `wtfoc serve -c <collection>`.

### Edge identity

Edges need stable, deterministic IDs so triage decisions survive across
server restarts. Edge ID = SHA-256 of `(from + to + type + evidence)`.
If a re-ingest changes an edge's content, the old triage decision no
longer matches and the edge appears as a new pending item.

### Triage workflow

1. User runs `wtfoc serve -c <collection>` (from #67)
2. Navigates to triage view
3. Sees extracted edges with filtering by status (pending/approved/rejected)
   and by edge type, with:
   - Source and target chunk content (snippets)
   - Edge type (references, closes, changes)
   - Evidence text (why the edge was extracted)
   - Source URLs for both chunks
4. For each edge, user can:
   - **Approve** — edge is confirmed correct
   - **Reject** — edge is marked as false positive, with optional reason
   - **Override** — add `reviewedType` and/or `reviewerNote` while
     preserving the original machine-extracted `type` + `evidence`
5. Triage decisions persisted to local sidecar file (survives server restarts)
6. When promoting to FOC (`wtfoc promote`), rejected edges are excluded;
   overridden edges are promoted with the reviewer's type/note

### Reviewer override semantics

Original machine-extracted `type` + `evidence` are **never overwritten**.
Reviewer decisions are stored separately:

- `status`: approved | rejected | overridden
- `reviewerNote`: optional human context
- `reviewedType`: optional type override (replaces `type` in promoted output)
- `reason`: optional rejection reason

This preserves provenance while allowing human correction.

### Promotion behavior

| Edge status | Promoted to FOC? | What gets promoted |
|-------------|-----------------|-------------------|
| `approved` | Yes | Original edge |
| `overridden` | Yes | Edge with `reviewedType` replacing `type`, `reviewerNote` added |
| `rejected` | No | Excluded |
| `pending` (unreviewed) | Yes | Original edge (unreviewed edges are included by default) |

Promotion is **not** blocked by pending edges — unreviewed edges pass
through. This keeps the workflow lightweight for hackathon use.

### Sidecar storage

Triage state stored at `<collection-dir>/.triage.json`:

```json
{
  "collectionName": "foc-demo",
  "decisions": {
    "<edge-sha256>": {
      "status": "rejected",
      "reviewedAt": "2026-03-24T...",
      "reason": "false positive — URL match is coincidental"
    },
    "<edge-sha256>": {
      "status": "overridden",
      "reviewedAt": "2026-03-24T...",
      "reviewedType": "references",
      "reviewerNote": "This is a reference, not a close"
    }
  }
}
```

### API endpoints (extending #67)

| Endpoint | Method | Body / Returns |
|----------|--------|---------------|
| `GET /api/edges?status=pending` | GET | Edge list with triage status, filterable |
| `POST /api/edges/:id/review` | POST | `{ status, reason?, reviewedType?, reviewerNote? }` |
| `GET /api/triage/summary` | GET | `{ total, approved, rejected, overridden, pending }` |

### Edge response shape

```json
{
  "id": "<sha256>",
  "from": "chunk-id-a",
  "to": "chunk-id-b",
  "type": "closes",
  "evidence": "Closes #42 in PR description",
  "triageStatus": "pending",
  "reviewedType": null,
  "reviewerNote": null
}
```

## Relationship to existing work

- **Blocked on** #67 (web visualization / `wtfoc serve`)
- Feeds into US-006 (#60) — triage before FOC promotion
- Improves quality of US-001 (#54) — validated edges = better trace
- Complements #3 (improve edge extraction) — human feedback identifies
  patterns where regex fails

## Acceptance criteria

- [ ] Triage view lists all extracted edges with evidence and status
- [ ] Filterable by status (pending/approved/rejected/overridden) and edge type
- [ ] User can approve, reject (with reason), or override (with type/note)
- [ ] Original machine-extracted type + evidence preserved on override
- [ ] Edge IDs are deterministic (SHA-256 of from+to+type+evidence)
- [ ] Triage decisions persisted to `<collection-dir>/.triage.json`
- [ ] Decisions survive server restarts
- [ ] `GET /api/edges` returns edges with triage status
- [ ] `POST /api/edges/:id/review` saves decisions
- [ ] Triage summary shows counts by status
- [ ] `wtfoc promote` excludes rejected edges, includes pending + approved + overridden
- [ ] Works with any local collection served via `wtfoc serve`

## User Stories

- **US-001**: As a user, I want triage ui for reviewing extracted edges before foc so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #69 on 2026-04-12.
