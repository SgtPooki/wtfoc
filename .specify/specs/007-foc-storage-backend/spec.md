# Feature Specification: FOC Storage Backend

**Feature Branch**: `007-foc-storage-backend`
**Created**: 2026-03-23
**Status**: Implemented (retroactive spec)
**Package**: `@wtfoc/store`

## Overview

`FocStorageBackend` implements the `StorageBackend` interface using FOC (Filecoin Onchain Cloud) for immutable, content-addressed, verifiable storage. Uses `filecoin-pin` for CAR creation (dual CIDs) and `@filoz/synapse-sdk` for upload/download.

## What Was Built

### FocStorageBackend (`store/backends/foc.ts`)

**Upload flow:**
1. Validate data size ≥ 127 bytes (SP minimum piece size)
2. Lazy-initialize synapse via `filecoin-pin.initializeSynapse()`
3. Create bare CAR via `filecoin-pin.createCarFromFile(file, { bare: true })`
4. Upload CAR via `filecoin-pin.executeUpload()` with silent pino logger
5. Return `StorageResult` with `id` = IPFS CID (primary), `pieceCid`, `ipfsCid`

**Download flow:**
1. Try public IPFS gateways (dweb.link, inbrowser.link) — returns unwrapped content
2. Fall back to synapse-sdk `download({ pieceCid: id })` — returns CAR container
3. Map errors to typed wtfoc errors (StorageNotFoundError, StorageUnreachableError)

**Verify flow:**
- Download + check size. Returns `{ exists, size }`.

### Key Design Decisions

1. **`id` = IPFS CID, not PieceCID.** IPFS CIDs return unwrapped file content via gateways. PieceCIDs return the CAR container which needs parsing. Using IPFS CID as primary id means `download(id)` returns usable JSON.

2. **`bare: true` for CAR creation.** Without bare, filecoin-pin wraps the file in a UnixFS directory. The root CID points to the directory, not the file. With bare, the root CID IS the file content — `gateway/ipfs/<cid>` returns JSON directly.

3. **Both CIDs stored.** `StorageResult` includes both `ipfsCid` (for retrieval) and `pieceCid` (for FOC verification). The manifest SegmentSummary stores both.

4. **No hardcoded SP endpoints.** Download uses public IPFS gateways for content retrieval. SP URLs are not hardcoded — they're discovered by synapse-sdk when needed.

5. **Lazy initialization.** Heavy deps (`@filoz/synapse-sdk`, `filecoin-pin`, `viem`) are dynamically imported inside methods, not at module load time. Local-only users never load them.

6. **Minimum piece size validation.** SPs reject pieces below 127 bytes. Backend throws a descriptive error guiding users to bundle into larger blobs.

### Verified on Calibration Testnet

```
Upload: 69KB segment → 2 copies stored
PieceCID: bafkzcibevlnagdc3y7dhayqxerlbgdexigawscqzahzsnp2sj3h5ydihvc6cx4qzha
IPFS CID: bafkreifpky65hypy5fgvndmjre6dhihb6qe34zhyvklr6tcltdl56gc7y4

Download via gateway:
https://bafkreifpky65hypy5fgvndmjre6dhihb6qe34zhyvklr6tcltdl56gc7y4.ipfs.dweb.link/
→ Returns raw segment JSON (schema v1, 3 chunks, embedding model metadata)

Full round-trip: ingest → FOC upload → IPFS gateway download → trace → results
```

## Schema Implications

### What's stored on FOC (immutable, can't change later)

| Field | In Segment | Purpose | Future concern |
|-------|-----------|---------|---------------|
| `schemaVersion` | ✅ | Format compatibility | Migration path via version bumps |
| `embeddingModel` | ✅ | Audit trail | Correct — needed for model provenance |
| `embeddingDimensions` | ✅ | Compatibility check | Correct — needed for query validation |
| `chunks[].content` | ✅ | Display + re-embedding | Correct — enables CID-mounted reuse |
| `chunks[].embedding` | ✅ | Stored vectors | Correct — enables low-compute consumers |
| `chunks[].terms` | ✅ | BM25 sparse search | May want to add later — ok for v1 |
| `edges[]` | ✅ | Explicit connections | Unidirectional in storage, bidirectional at query time |
| `chunks[].metadata` | ✅ | Source provenance | Extensible — `Record<string, string>` |

### What's NOT stored (gaps for future)

- No entity mentions per chunk (would help future entity linking)
- No chunk-level summary (would help hierarchical retrieval)
- No edge weight/importance (only confidence)
- No temporal validity on edges
- Edges are unidirectional in storage (bidirectional index built at query time — this is correct, no schema change needed)

### Migration path

All stored data includes `schemaVersion: 1`. When we need v2:
1. Define new schema with additional fields
2. Update `CURRENT_SCHEMA_VERSION` to 2
3. Update `MAX_SUPPORTED_SCHEMA_VERSION` to 2
4. Readers handle both v1 and v2
5. Old v1 segments remain valid forever (immutable)
6. Re-indexing creates new v2 segments without deleting v1

## Dependencies

- `filecoin-pin` — CAR creation, synapse initialization, upload execution
- `@filoz/synapse-sdk` — direct download by PieceCID (fallback)
- `@filoz/synapse-core/chains` — calibration/mainnet chain configs
- `viem` — wallet/account management
- `pino` — logger (required by filecoin-pin)

## Out of Scope (for v1)

- CAR bundling multiple segments into one upload (#41)
- Manifest storage on FOC (manifests are local-only)
- Consumer bootstrap from CID (#43)
- Max piece size handling
- SP-direct IPFS endpoint download (uses public gateways instead)
