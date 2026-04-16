Read `AGENTS.md`, `SPEC.md`, and `docs/principles.md` before making non-trivial changes.

This repository is issue-first. Every non-trivial change needs a GitHub issue; commits that complete work reference it with `fixes #N` in the message body (see `AGENTS.md`).

Prefer the nearest nested `AGENTS.md` when editing package code. Package-local instructions override root-level generalities.

Run repository commands from the root unless package-local guidance says otherwise:
- `pnpm lint:fix`
- `pnpm test`
- `pnpm -r build`

Keep `@wtfoc/common` pure. Do not add I/O, SDK wrappers, or business logic there.

Prefer self-documenting code over explanatory comments. Use comments only for invariants, non-obvious tradeoffs, security constraints, or protocol details. Remove stale comments when editing nearby code.

Do not use `any`, `as unknown as`, non-null assertions, or default exports. Use typed errors with stable `code` fields. Long-running async operations accept `AbortSignal`.

Treat manifest schemas, segment schemas, public CLI behavior, CI scripts, and package scripts as high-risk surfaces. Ask before changing them unless the task explicitly requires it.
