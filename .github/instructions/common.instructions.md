---
applyTo: "packages/common/**/*"
---

`packages/common` is contracts only.

- No filesystem, network, CLI, SDK, or storage backend logic.
- Treat all exported interfaces, schemas, and errors as public API.
- Backend-neutrality matters here. Do not leak FOC-only assumptions into shared contracts.
- Schema changes must preserve explicit versioning rules and usually require corresponding updates to `SPEC.md`.
