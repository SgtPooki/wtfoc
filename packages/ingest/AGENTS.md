# AGENTS.md — `packages/ingest`

Local rules for `@wtfoc/ingest`.

## Focus

This package owns source adapters, chunking, edge extraction, and segment construction.

## Change Rules

- Preserve ingest order: chunks, embeddings, edge extraction, segment bundle, upload, verify, head update.
- Keep edges explicit and evidence-backed. Do not replace them with opaque summaries.
- Source adapters should normalize source data, not implement storage policy.
- Avoid coupling ingest code to concrete store implementations beyond defined seams.

## Testing Guidance

- Use synthetic fixtures only.
- Test behavior at chunk, edge, and segment boundaries.
- Add coverage for evidence extraction whenever edge logic changes.

## Verification

Run:

```bash
pnpm --filter @wtfoc/ingest test
pnpm --filter @wtfoc/ingest build
```
