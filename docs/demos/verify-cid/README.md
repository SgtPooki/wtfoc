# Verify a CID

**Time:** 15s warm cache, up to ~2min cold — network-bound (37 segments + 3 edge layers fetched).
**Prerequisites:** `wtfoc` CLI built, working internet, FOC gateway reachable.
**State:** None. No collection required. No API key. No ingestion.

## The narrative

The whole pitch for publishing a wtfoc collection on Filecoin is:
**you do not have to trust us — you can verify the bits yourself.**

This demo is that claim, executed. We give you a manifest CID. You run one
command. `wtfoc` fetches the manifest from FOC, walks every segment CID
and every derived-edge-layer CID it references, recomputes sha256 on each
artifact, and checks the schemas. Either all the bits match what the
manifest claims, or they don't. No middle ground.

## Run it

```bash
./docs/demos/verify-cid/run.sh
```

Verifies the published v12 CID
`bafkreif5ezwktkpifmyvwh77cocskinjn7g5tho64t2clb2uzezmrhgzci`.

To verify any other CID:

```bash
./docs/demos/verify-cid/run.sh <manifest-cid>
```

## What success looks like

```
REMOTELY VERIFIED
  manifest: bafkreif5ezwktkpifmyvwh77cocskinjn7g5tho64t2clb2uzezmrhgzci
  segments: <N> verified
  derived-edge-layers: <N> verified
  chunk counts match manifest
```

Exit code `0`.

## What failure looks like

| Verdict | Exit | Meaning |
|---------|------|---------|
| `UNVERIFIED (fetch)` | `1` | Gateway timed out, CID unreachable, or segment missing on FOC. Network problem, not data problem. Retry or try a different gateway. |
| `INCONSISTENT (content)` | `2` | A fetched artifact's sha256 did not match what the manifest said. The bits are not what they claim to be — corrupted, tampered with, or wrong CID. Do not trust this collection. |

## Timing

On the default v12 CID against the FOC calibration network, a warm
path is ~15s. A fully cold verify (all 40 artifacts re-fetched) can
take close to 2min. Override the per-artifact timeout if a gateway is
slow:

```bash
$CLI verify-collection --manifest-cid <cid> --download-timeout 60000
```

## Why this matters for the demo

The preceding demos (`quick-start`, `upload-flow-trace`, `gap-analysis`,
`theme-discovery`, `drift-analysis`) all show what wtfoc can *do*. This
one shows what it *means* to publish results: anyone who gets the CID
can independently check you didn't lie about the content. That's the
whole point of putting a collection on Filecoin instead of S3.

## See also

- `docs/evidence-layer.md` — what the evidence layer guarantees and doesn't.
- `verify-trust` subcommand — local consistency check (no network). Use
  before `promote` to confirm local bits are internally consistent.
- `docs/demos/local-to-foc/` — publish your own collection and get a CID.
