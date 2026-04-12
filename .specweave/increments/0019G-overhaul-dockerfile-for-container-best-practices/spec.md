# chore: overhaul Dockerfile for container best practices

**Increment**: 0019G-overhaul-dockerfile-for-container-best-practices
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #137

## Description

## Problem

The Dockerfile has accumulated fixes reactively (sharp stub, node-datachannel prebuild, curl install, pruning list) without a holistic review. Recent issues:

- `prebuild-install` silently failed because `node:24-slim` lacks `curl`
- `pnpm.onlyBuiltDependencies` wasn't listing native addons that need postinstall scripts
- Aggressive pruning removed packages needed at runtime (`node-datachannel`, `@helia/verified-fetch` deps)
- The prune step is a brittle glob list that breaks when deps change
- No multi-stage optimization — deps layer installs everything then deletes what's not needed

## Goals

- Audit every pruned package — document why it's pruned and what breaks if it's kept
- Use pnpm deploy or pnpm prune --prod instead of manual `rm -rf` globs
- Ensure all native addons with postinstall scripts are in `onlyBuiltDependencies`
- Minimize image size without breaking runtime features (embedder, verified-fetch, FOC upload)
- Add a CI smoke test that verifies verified-fetch initializes in the container
- Document required system packages (curl for prebuild-install) in the Dockerfile

## Relationship to #111

#111 plans a multi-process runtime split with separate Dockerfiles (`Dockerfile.gateway`, `Dockerfile.query`, `Dockerfile.ingest`). This cleanup should happen **before** #111:

1. **Before #111**: Fix the current single Dockerfile — establish best practices, proper multi-stage builds, reliable native addon handling, and documented pruning decisions. This becomes the template.
2. **During #111**: When splitting into per-component images, apply these same practices to each new Dockerfile. Each image only includes the deps its component actually needs (e.g., `query` needs verified-fetch + qdrant client but not ingest deps; `ingest` needs embedder + FOC upload but not verified-fetch).

Getting the single Dockerfile right first avoids duplicating the same reactive fixes across 3-4 images later.

## Context

- verified-fetch requires `@ipshipyard/node-datachannel` (native addon via prebuild-install)
- Local embedder requires `onnxruntime-node` (native addon)
- sharp is stubbed because KVM worker nodes lack x86-64-v2 CPU support
- FOC upload deps (`filecoin-pin`, `@filoz/*`, `viem`) are pruned — FOC upload only runs from CLI, not the web server

## User Stories

- **US-001**: As a user, I want overhaul dockerfile for container best practices so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #137 on 2026-04-12.
