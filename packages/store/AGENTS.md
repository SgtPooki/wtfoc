# AGENTS.md — `packages/store`

Local rules for `@wtfoc/store`.

## Focus

This package owns storage backends, manifest persistence, validation, and artifact bundling.

## Change Rules

- Keep storage results backend-neutral. `StorageResult.id` is required; CIDs remain optional metadata.
- Preserve the single-writer manifest update model. Concurrent writes fail on `prevHeadId` mismatch.
- Upload and verify artifacts before publishing a new head pointer.
- Keep FOC-specific behavior behind store implementations, not in `@wtfoc/common`.
- Maintain mixed-history compatibility when evolving manifests or segment summaries.

## Testing Guidance

- Prefer local and in-memory tests. Do not add network-dependent unit tests.
- Test schema acceptance and rejection paths when changing manifest validation.
- Test conflict behavior and retrieval behavior when changing manifest or backend code.

## Verification

Run:

```bash
pnpm --filter @wtfoc/store test
pnpm --filter @wtfoc/store build
```
