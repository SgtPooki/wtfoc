# Demo: Local to FOC — Build, Promote, Share

Build a knowledge graph locally. Promote it to Filecoin. Share the CID.

## The Point

This is the trust arc: try locally with zero commitment, then promote to decentralized storage when you're ready. The same collection, same queries, same traces — but now content-addressed, verifiable, and shareable.

## Prerequisites

- `WTFOC_PRIVATE_KEY` environment variable set to a `0x`-prefixed wallet private key
- A funded wallet on the Filecoin calibration network (default) or mainnet

If you don't have a key, the script runs everything except the promote step and tells you what to do next.

## Run It

```bash
./docs/demos/local-to-foc/run.sh
```

Or with an existing collection:

```bash
./docs/demos/local-to-foc/run.sh --collection foc-upload-flow
```

## What Happens

### Phase 1: Build locally

```bash
./wtfoc init local-to-foc-demo --local
./wtfoc ingest repo SgtPooki/wtfoc -c local-to-foc-demo
./wtfoc ingest github SgtPooki/wtfoc -c local-to-foc-demo --since 90d
```

Three commands, no API key, works offline. This is the on-ramp.

### Phase 2: Verify it works

```bash
./wtfoc trace "how does ingest work" -c local-to-foc-demo
./wtfoc themes -c local-to-foc-demo --limit 5
./wtfoc status -c local-to-foc-demo
```

Confirm the collection is useful before committing to decentralized storage.

### Phase 3: Promote to Filecoin

```bash
WTFOC_PRIVATE_KEY=0x... ./wtfoc promote local-to-foc-demo
```

Output:

```
PieceCID: baga6ea4seaq...
CAR root: bafy...
Segments: 5
```

The promote command bundles all segments into a single CAR file, uploads to FOC via the Filecoin pin service, and updates the manifest with IPFS CIDs.

### Phase 4: Verify on-chain

```bash
./wtfoc verify <carRootCid>
```

Confirms the artifact exists and returns its size in bytes.

### Phase 5: Share the CID

Share the CAR root CID with anyone. They can load the collection in the web UI:

1. Open the web app (hosted or via `wtfoc serve`)
2. Paste the CID in the "Open by CID" field
3. The app resolves the manifest from IPFS, loads segments, builds the vector index
4. All queries and traces work identically to a local collection

## The Demo Line

> "I built a knowledge graph from 3 commands on my laptop. One more command promoted it to Filecoin. Now anyone with the CID can query it — no account, no API key, no server. The data is content-addressed and verifiable."

## Known Gaps

- **Manifest CID**: The promote command outputs a `carRootCid` (directory of segments). The web UI's CID input expects a manifest CID that resolves to a `CollectionHead` JSON. Verify that the sharing flow resolves correctly end-to-end.
- **Idempotency**: Re-running promote may re-upload segments that were already uploaded. Safe but wasteful.
- **Network**: Defaults to Filecoin calibration testnet. Pass `--network mainnet` for production.

## Reproduction

```bash
# Full demo (requires WTFOC_PRIVATE_KEY)
./docs/demos/local-to-foc/run.sh

# Skip ingest, just promote an existing collection
./docs/demos/local-to-foc/run.sh --collection foc-upload-flow

# Dry run (no actual upload)
./docs/demos/local-to-foc/run.sh --dry-run

# Without a key (runs everything except promote)
./docs/demos/local-to-foc/run.sh
```
