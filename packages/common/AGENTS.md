# AGENTS.md — `packages/common`

Local rules for `@wtfoc/common`.

## Purpose

`@wtfoc/common` defines shared contracts only.

- Allowed: interfaces, schemas, pure type helpers, version constants, typed error classes
- Not allowed: network access, filesystem access, SDK wrappers, storage backends, CLI logic, business workflows

## Change Rules

- Treat every exported type here as public API.
- If you change an interface signature, schema shape, or error contract, update [`SPEC.md`](../../SPEC.md) and the relevant spec.
- Preserve backend-neutral contracts. Do not leak FOC-specific assumptions into shared types.
- Readers reject unknown schema versions. Writers use the latest schema version.

## Code Guidance

- Prefer explicit schema names over generic helpers that hide the wire format.
- Error classes must have stable `code` values and enough context for downstream handling.
- Avoid convenience exports that blur package boundaries.

## Verification

Run:

```bash
pnpm --filter @wtfoc/common test
pnpm --filter @wtfoc/common build
```
