# AGENTS.md — `packages/cli`

Local rules for `@wtfoc/cli`.

## Focus

This package composes the other packages into the user-facing CLI.

## Change Rules

- Treat flags, subcommand names, stdout output, stderr logging, and exit codes as public API.
- Keep stdout for data and stderr for logs or diagnostics.
- Maintain support for human output, `--json`, and `--quiet` modes.
- Do not couple command behavior to concrete backend classes when a config or interface check will do.

## Testing Guidance

- Test output shape, exit behavior, and error-code mapping.
- Prefer behavior-level CLI tests over internal implementation assertions.
- Update README examples if user-visible CLI behavior changes.

## Verification

Run:

```bash
pnpm --filter @wtfoc/cli test
pnpm --filter @wtfoc/cli build
```
