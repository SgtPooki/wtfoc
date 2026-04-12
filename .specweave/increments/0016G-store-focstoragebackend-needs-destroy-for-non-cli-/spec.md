# fix(store): FocStorageBackend needs destroy() for non-CLI cleanup

**Increment**: 0016G-store-focstoragebackend-needs-destroy-for-non-cli-
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #149

## Description

## Problem

`FocStorageBackend` uses `filecoin-pin.initializeSynapse()` which creates a viem HTTP transport with persistent connections. These connections keep the Node.js event loop alive indefinitely after uploads complete.

Currently we work around this with `process.exit(0)` in CLI commands (promote, ingest, reindex), but this is wrong for library usage — web servers, MCP servers, or any long-running process that uses `FocStorageBackend` will leak connections.

## Root Cause

`@filoz/synapse-sdk` does not expose a `destroy()`, `close()`, or `disconnect()` method on its `Synapse` instance. The underlying viem client keeps HTTP connections open.

## Proposed Fix

1. Track the viem client created by `initializeSynapse()` inside `FocStorageBackend`
2. Add a `destroy()` method that calls `client.destroy()` on the viem transport
3. Remove `process.exit(0)` from CLI commands and call `focStore.storage.destroy?.()` instead
4. Consider opening an upstream issue on `@filoz/synapse-sdk` for proper cleanup support

## Context

Discovered while fixing #139. The `process.exit(0)` workaround was added in PR #147.

## User Stories

- **US-001**: As a user, I want store focstoragebackend needs destroy for non cli  so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #149 on 2026-04-12.
