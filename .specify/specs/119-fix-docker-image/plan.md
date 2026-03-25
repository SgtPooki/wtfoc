# Implementation Plan: Fix Docker Image for Hosted MCP Web Server

**Branch**: `119-fix-docker-image` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/119-fix-docker-image/spec.md`

## Summary

The production Docker image is missing two workspace packages (`packages/config` and `packages/ingest`) that `@wtfoc/mcp-server` depends on. Adding COPY stanzas for these packages in the production stage of the Dockerfile fixes the CrashLoopBackOff.

## Technical Context

**Language/Version**: TypeScript (ESM), Node 24
**Primary Dependencies**: pnpm workspaces, multi-stage Docker build
**Storage**: N/A (Dockerfile change only)
**Testing**: Docker build + container startup verification
**Target Platform**: Linux container (node:24-slim)
**Project Type**: Monorepo infrastructure fix
**Performance Goals**: Container starts within 30 seconds, image size increase < 10 MB
**Constraints**: Must not re-introduce pruned heavy deps (crawlee, sharp, discord.js)
**Scale/Scope**: 2 COPY blocks added to Dockerfile (~6 lines)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit | PASS | No new seams or lock-in introduced |
| II. Standalone Packages | PASS | Follows existing package isolation pattern |
| III. Backend-Neutral Identity | N/A | No identity changes |
| IV. Immutable Data | N/A | No data model changes |
| V. Edges Are First-Class | N/A | No edge changes |
| VI. Test-First | PASS | Verified by Docker build + startup test |
| VII. Bundle Uploads | N/A | No upload changes |
| VIII. Ship-First | PASS | Minimal fix, maximum impact |
| Atomic Commits | PASS | Single logical change |
| Conventional Commits | PASS | `fix(docker): include config and ingest packages in production image` |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/119-fix-docker-image/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
Dockerfile               # Only file modified
```

**Structure Decision**: This is a single-file infrastructure fix. No new source files are created.

## Implementation

### Change 1: Add missing COPY stanzas to Dockerfile production stage

Add COPY blocks for `packages/config` and `packages/ingest` in the production stage, following the exact same pattern used for other workspace packages (common, store, search, mcp-server).

Insert after the mcp-server COPY block (line 73) and before the apps/web COPY block (line 74):

```dockerfile
COPY --from=build /app/packages/config/package.json packages/config/
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/config/node_modules packages/config/node_modules
COPY --from=build /app/packages/ingest/package.json packages/ingest/
COPY --from=build /app/packages/ingest/dist packages/ingest/dist
COPY --from=build /app/packages/ingest/node_modules packages/ingest/node_modules
```

### Verification

1. `docker build -t wtfoc-test .` — image builds successfully
2. `docker run --rm wtfoc-test` — container starts, web server logs ready state, no module-not-found errors
3. Image size delta is < 10 MB
