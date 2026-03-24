# Demo: Tracing the Upload Flow Across the FOC Stack

This demo shows how `wtfoc` can map a single feature — **file upload** — across the entire Filecoin Onchain Cloud stack: SDK source code, GitHub issues, PRs, documentation sites, and SP backend code.

## The Question

> "How does an upload work end-to-end — from a user calling the SDK to a storage provider proving it has the data?"

This is the kind of question that normally takes hours of manual investigation across multiple repos, docs sites, and issue trackers. With `wtfoc`, it takes seconds.

## Setup

Run the companion script to reproduce this demo:

```bash
./scripts/demo-upload-flow.sh
```

Or manually:

```bash
# Build
pnpm build

# Create collection
./wtfoc init foc-upload-flow --local

# Ingest documentation sites
./wtfoc ingest website https://docs.filecoin.cloud/ -c foc-upload-flow
./wtfoc ingest website https://filecoin.cloud/ -c foc-upload-flow

# Ingest GitHub issues/PRs (last 90 days of activity)
./wtfoc ingest github FilOzone/synapse-sdk -c foc-upload-flow --since 90d
./wtfoc ingest github filecoin-project/filecoin-pin -c foc-upload-flow --since 90d
./wtfoc ingest github filecoin-project/curio -c foc-upload-flow --since 90d
./wtfoc ingest github FilOzone/filecoin-services -c foc-upload-flow --since 90d

# Ingest source code
./wtfoc ingest repo FilOzone/synapse-sdk -c foc-upload-flow --batch-size 200
./wtfoc ingest repo filecoin-project/filecoin-pin -c foc-upload-flow --batch-size 200
./wtfoc ingest repo filecoin-project/curio -c foc-upload-flow --batch-size 200
./wtfoc ingest repo FilOzone/filecoin-services -c foc-upload-flow --batch-size 200
```

This produces ~16,000 chunks across 5 source types.

## Trace 1: The upload flow end-to-end

```bash
./wtfoc trace "file upload flow from user to storage provider" -c foc-upload-flow
```

### Results (5 source types)

| Score | Type | Source | What it tells us |
|-------|------|--------|-----------------|
| 0.60 | code | `synapse-sdk/.../storage/manager.ts` | The `StorageManager.upload()` implementation — the entry point |
| 0.58 | code | `synapse-sdk/.../types.ts` | Upload flow decomposition: store, pull, commit phases |
| 0.55 | github-pr | synapse-sdk#690 | Recent PR adding docs for upload options (providerId, dataSetId) |
| 1.00 | github-issue | filecoin-pin#372 | DX issue: "executeUpload has confusing DX" — real user friction |
| 0.54 | doc-page | docs.filecoin.cloud/storage-context | "The Upload Pipeline" — three phases: store, pull, commit |
| 0.54 | markdown | synapse-sdk docs source | Same upload pipeline docs in source form |

### What we learn

The upload flow has three phases: **store → pull → commit**. The SDK entry point is `StorageManager.upload()` in `manager.ts`. There's an open DX issue (filecoin-pin#372) about the upload API being confusing. A recent PR (#690) is improving the documentation for upload options.

## Trace 2: SDK internals — StorageManager and PDP

```bash
./wtfoc trace "StorageManager upload createContexts PDP" -c foc-upload-flow
```

### Results (5 source types)

| Score | Type | Source | What it tells us |
|-------|------|--------|-----------------|
| 0.64 | code | `synapse-sdk/.../storage/manager.ts` | Upload options extend `CreateContextsOptions` |
| 0.58 | code | `synapse-sdk/.../types.ts` | Type decomposition: count, excludeProviderIds for createContexts |
| 0.56 | code | `synapse-sdk/.../sp/sp.ts` | SP type definition with PDP API serviceURL, recordKeeper |
| 0.55 | github-pr-comment | curio#978 | PDP dataset registration discussion — datasets aren't immediately registered |
| 0.55 | github-issue | synapse-sdk#424 | "StorageManager: defaultContexts" — docs vs API mismatch |
| 0.55 | markdown | curio docs | Guide for enabling PDP on a storage provider |
| 0.53 | doc-page | docs.filecoin.cloud/developer-guides | Sequence diagram: SDK → calculate PieceCID → POST /pdp/... |

### What we learn

The SDK creates "storage contexts" (provider + dataset pairs) before uploading. Each context talks to a PDP-enabled storage provider. The `sp.ts` file defines the SP interface including the PDP API URL. There's an open issue (#424) about `defaultContexts` where the docs don't match the API. Curio PR #978 discusses the PDP registration lifecycle.

## Trace 3: Storage provider side — what happens after upload

```bash
./wtfoc trace "what happens after upload reaches the storage provider curio PDP proof" -c foc-upload-flow
```

### Results (3 source types)

| Score | Type | Source | What it tells us |
|-------|------|--------|-----------------|
| 0.70 | doc-page | docs.filecoin.cloud/pdp-overview | "What is PDP?" — cryptographic proof of data possession |
| 0.69 | markdown | synapse-sdk docs source | Same PDP overview in source MDX |
| 0.65 | doc-page | docs.filecoin.cloud/pdp-overview | Three guarantees: Integrity, Availability, Accountability |
| 0.59 | github-pr-comment | curio#978 | PDP dataset initialization and registration lifecycle |

### What we learn

After upload, the storage provider runs **Proof of Data Possession (PDP)** — a cryptographic protocol providing integrity, availability, and accountability guarantees. Curio is the SP implementation. The PDP verification flow is discussed in curio PR #978, with details about how datasets move from "initialized" to "registered" state.

## The Full Picture

Combining all three traces, we can reconstruct the full upload lifecycle:

```
User code
  │
  ▼
StorageManager.upload()          ← synapse-sdk/storage/manager.ts
  │
  ├─ createContexts()            ← selects providers, creates datasets
  │    └─ SP type (sp.ts)        ← defines PDP API endpoint
  │
  ├─ store → pull → commit       ← three-phase upload pipeline
  │    └─ docs: storage-context  ← documented on docs.filecoin.cloud
  │
  ▼
Storage Provider (Curio)
  │
  ├─ Receives data via PDP API   ← curio PR #978 discusses registration
  ├─ Initializes PDP dataset
  └─ Runs PDP proofs             ← integrity, availability, accountability
       └─ docs: pdp-overview     ← documented on docs.filecoin.cloud
```

**Open issues found along the way:**
- filecoin-pin#372: Upload API DX is confusing
- synapse-sdk#424: defaultContexts docs don't match API
- synapse-sdk#690: PR improving upload options documentation

## Reproduction

```bash
# Run the full demo
./scripts/demo-upload-flow.sh

# Or just the traces (if collection already exists)
./scripts/demo-upload-flow.sh --skip-ingest
```
