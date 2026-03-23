---
applyTo: "packages/cli/**/*"
---

`packages/cli` is the public command interface.

- Preserve stdout for data and stderr for logs.
- Treat flags, command names, help text, and exit codes as user-facing API.
- Maintain behavior across human output, `--json`, and `--quiet`.
- Prefer config-driven branching over `instanceof` checks against concrete backends.
