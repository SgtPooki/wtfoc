# Implementation Plan: Store Backend

**Branch**: `001-store-backend` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)

## Summary

Implement `@wtfoc/store` — pluggable blob storage + manifest management with backend-neutral identity. Two storage backends (local filesystem, FOC via synapse-sdk), one manifest store (local filesystem), and a factory for composing them.

## Technical Context

**Language/Version**: TypeScript 5.9, ESM only
**Primary Dependencies**: `@wtfoc/common` (interfaces), `@filoz/synapse-sdk`, `filecoin-pin`, `viem`
**Storage**: Local filesystem (default), FOC calibration testnet (opt-in)
**Testing**: vitest (runs .ts directly, no build step)
**Target Platform**: Node >=24
**Project Type**: Library (`@wtfoc/store`)

## Constitution Check

- [x] Every seam is an interface (StorageBackend, ManifestStore)
- [x] Backend-neutral identity (StorageResult.id always present, CIDs optional)
- [x] AbortSignal on all async methods
- [x] schemaVersion on all persisted data
- [x] Single writer enforcement via prevHeadId
- [x] Behavioral tests only
- [x] No I/O in @wtfoc/common

## Project Structure

```text
packages/store/
├── src/
│   ├── index.ts              # Public API exports
│   ├── factory.ts             # createStore() factory
│   ├── backends/
│   │   ├── local.ts           # LocalStorageBackend (DONE)
│   │   ├── local.test.ts      # Tests (DONE)
│   │   └── foc.ts             # FocStorageBackend (TODO)
│   ├── manifest/
│   │   ├── local.ts           # LocalManifestStore (DONE)
│   │   ├── local.test.ts      # Tests (DONE)
│   │   └── schema.ts          # Schema validation helpers (TODO)
│   ├── factory.test.ts        # Factory tests (DONE)
│   └── schema.test.ts         # Schema validation tests (TODO)
└── package.json
```

## What's Already Done

- `LocalStorageBackend` — content-hash put/get/verify + AbortSignal (8 tests)
- `LocalManifestStore` — JSON files + headId conflict detection (10 tests)
- `createStore()` factory — local, foc placeholder, custom backends (5 tests)
- All 23 tests passing via vitest

## What Remains

1. **Schema validation helpers** — `validateManifest()`, `validateSegment()` that check schemaVersion and reject unknowns
2. **FocStorageBackend** — synapse-sdk + filecoin-pin integration (with mock tests + opt-in integration tests)
3. **Segment serialization** — `serializeSegment()` / `deserializeSegment()` with schema validation
4. **FOC-specific error mapping** — map synapse-sdk errors to wtfoc typed errors
