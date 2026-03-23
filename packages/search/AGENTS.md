# AGENTS.md — `packages/search`

Local rules for `@wtfoc/search`.

## Focus

This package owns embedders, vector indexing, semantic query, and trace behavior.

## Change Rules

- Keep trace and search distinct. Trace follows explicit edges; search finds semantic neighbors.
- Fallback from trace to search only when explicit edges are absent.
- Keep embedder and vector index implementations swappable through `@wtfoc/common` interfaces.
- Record embedding model and dimensions where persisted artifacts depend on them.

## Testing Guidance

- Use deterministic fixtures for query and trace tests.
- Avoid live network calls or provider dependencies in unit tests.
- When changing fallback behavior, add tests for both edge-present and no-edge paths.

## Verification

Run:

```bash
pnpm --filter @wtfoc/search test
pnpm --filter @wtfoc/search build
```
