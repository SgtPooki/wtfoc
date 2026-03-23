# Data Model: CAR Bundle Uploads

## Entity Changes

### BatchRecord (NEW)

A manifest-level record linking one FOC upload to the segments it contains.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pieceCid` | `string` | Yes | FOC PieceCID for the entire CAR bundle |
| `carRootCid` | `string` | Yes | IPFS root CID of the directory CAR |
| `segmentIds` | `string[]` | Yes | Segment IDs contained in this CAR (subset of `segments[].id`) |
| `createdAt` | `string` | Yes | ISO 8601 timestamp of the upload |

**Invariants**:
- Every FOC-uploaded segment belongs to exactly one `BatchRecord`
- `segmentIds` is a subset of the manifest's `segments[].id` values
- Local-mode segments belong to no batch record
- Append-only: batch records are never modified or removed

### HeadManifest (MODIFIED)

| Field | Change | Description |
|-------|--------|-------------|
| `batches` | ADD (optional) | `BatchRecord[]` — absent for local-only or pre-bundling manifests |

No `schemaVersion` bump. Optional field is safely ignored by existing readers.

### SegmentSummary (UNCHANGED)

| Field | Change | Notes |
|-------|--------|-------|
| `id` | No change | Remains the directly retrievable per-segment IPFS CID (or local ID) |
| `ipfsCid` | No change | Optional, may duplicate `id` for FOC segments |
| `pieceCid` | Semantically unused for bundled ingests | Still readable for pre-bundling manifests. New bundled ingests do not populate this field — the `BatchRecord` holds the PieceCID. |

## Relationships

```
HeadManifest
├── segments: SegmentSummary[]
│   └── id ← retrievable per-segment CID
└── batches?: BatchRecord[]
    ├── pieceCid ← on-chain verification
    ├── carRootCid ← CAR root for the bundle
    └── segmentIds[] ──references──▶ segments[].id
```

## Validation Rules

- `batches` is optional on `HeadManifest` (may be absent or empty array)
- Each `BatchRecord.segmentIds` must be non-empty
- Each `BatchRecord.pieceCid` must be a non-empty string
- Each `BatchRecord.carRootCid` must be a non-empty string
- Each `BatchRecord.createdAt` must be a valid ISO 8601 string
- No segment ID should appear in more than one batch record
- Schema validation must accept manifests with or without `batches`
