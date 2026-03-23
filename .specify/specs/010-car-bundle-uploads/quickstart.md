# Quickstart: CAR Bundle Uploads

## What this feature does

Changes the FOC upload path so that each `wtfoc ingest` bundles all segments into a single CAR file (UnixFS directory) before uploading. One ingest = one CAR = one PieceCID on-chain.

## Key files to understand

1. **`packages/common/src/schemas/manifest.ts`** — `HeadManifest` and `SegmentSummary` types. This feature adds `BatchRecord` and an optional `batches` array.
2. **`packages/store/src/backends/foc.ts`** — Current FOC upload (single bare CAR per segment). Will be modified to handle pre-built CAR bytes.
3. **`packages/cli/src/cli.ts`** (lines 248-279) — Ingest command. Currently calls `store.storage.upload(segmentBytes)` directly. Will call the new bundler instead for FOC storage.
4. **`packages/store/src/schema.ts`** — Manifest validation. Must accept optional `batches` array.

## New module

**`packages/store/src/bundler.ts`** — Orchestration layer:
- Takes serialized segments
- Computes per-segment CIDs via `filecoin-pin.createCarFromFile(file, { bare: true })`
- Builds directory CAR via `filecoin-pin.createCarFromFiles(files)`
- Calls `storage.upload(carBytes, { prebuiltCar: "true" })` once
- Returns `BatchRecord` + per-segment CID map

## How it fits together

```
CLI ingest command
  ├── Build segment(s) from source      (unchanged)
  ├── IF local storage:
  │     └── upload each segment directly (unchanged)
  └── IF FOC storage:
        └── bundleAndUpload(segments, storage)   ← NEW
              ├── compute per-segment CIDs
              ├── build directory CAR
              ├── upload CAR bytes once
              ├── verify PieceCID in result
              └── return BatchRecord
  └── Update manifest head
        ├── append segment summaries     (unchanged)
        └── append batch record          ← NEW
```

## Testing approach

- Unit tests: mock `StorageBackend`, verify bundler calls `upload()` once with CAR bytes, returns correct `BatchRecord`
- Integration tests: use `LocalStorageBackend` to verify round-trip (bundler should skip for local)
- No network calls in tests
