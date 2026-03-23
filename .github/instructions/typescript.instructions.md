---
applyTo: "**/*.ts,**/*.tsx"
---

Use TypeScript strict-mode patterns already present in this repo.

- Do not introduce `any`.
- Do not use `as unknown as`.
- Do not use non-null assertions.
- Use named exports only.
- Prefer explicit types and narrowing over broad casts.
- Use typed errors from `@wtfoc/common` instead of raw `Error` objects when behavior crosses package boundaries.
- Long-running async work should accept `AbortSignal`.
- Prefer focused behavioral tests over implementation-coupled tests.
- Keep comments sparse; the default should be self-documenting code.
