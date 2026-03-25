# wtfoc Demos

Each demo has a human-readable **README.md** (the narrative) and an executable **run.sh** (the automation). Run the scripts from the repo root.

## Demo Catalog

| Demo | Time | What it shows | Command |
|------|------|--------------|---------|
| [Quick Start](quick-start/) | ~2 min | 3 commands, no API key, local embeddings | `./docs/demos/quick-start/run.sh` |
| [Upload Flow Trace](upload-flow-trace/) | ~15 min | Cross-repo feature trace across 5 source types | `./docs/demos/upload-flow-trace/run.sh` |
| [Gap Analysis](gap-analysis/) | seconds | System finds what's missing from your collection | `./docs/demos/gap-analysis/run.sh` |
| [Theme Discovery](theme-discovery/) | seconds | Semantic clustering — no LLM, pure math | `./docs/demos/theme-discovery/run.sh` |
| [Incremental Ingest](incremental-ingest/) | ~2 min | Collections grow over time, dedup included | `./docs/demos/incremental-ingest/run.sh` |
| [Drift Analysis](drift-analysis/) | seconds | Find stale docs and undocumented features | `./docs/demos/drift-analysis/run.sh` |
| [Local to FOC](local-to-foc/) | ~3 min | Build locally, promote to Filecoin, share CID | `./docs/demos/local-to-foc/run.sh` |
| [Full Stack](full-stack/) | ~10 min | MCP + Web UI + Claude Desktop integration | (see README) |

**Prerequisite:** Most demos reuse the `wtfoc-quick-start` collection. Run the Quick Start demo first — everything else builds on it.

## Recommended Demo Arc

For a recording or live presentation, run them in this order:

1. **Quick Start** — Establish credibility: zero setup cost, no API key (creates the collection)
2. **Gap Analysis** — The "aha" moment: the system tells you what to ingest next
3. **Theme Discovery** — Instant orientation: what is the conversation actually about?
4. **Incremental Ingest** — Answer the "one-shot or incremental?" question (adds GitHub activity)
5. **Drift Analysis** — The detective: docs say X, code says Y — who's right?
6. **Upload Flow Trace** — The hero story: cross-repo architecture tracing with real results
7. **Local to FOC** — The trust arc: same collection, now on Filecoin with a shareable CID
8. **Full Stack** — The finale: Claude uses wtfoc as a tool, web UI shows the graph

Steps 2-5 run in seconds on the quick-start collection. Step 6 is the long one (~15 min) — pre-bake it the night before if demoing live.

## Shared Flags

All analysis demos (gap-analysis, theme-discovery, drift-analysis) support:

```bash
--collection <name>              # Run against a specific collection (default: wtfoc-quick-start)
--embedder-url lmstudio          # Use LM Studio as embedder
--embedder-url <url>             # Use any OpenAI-compatible embedder
--embedder-model <model>         # Specify embedder model
```

## Pre-Baking for Presentations

Run the upload-flow-trace demo the night before — it ingests ~16K chunks and takes 10-15 minutes. Then all other demos can reuse that collection for richer results:

```bash
# Night before
./docs/demos/upload-flow-trace/run.sh

# During presentation — all run in seconds
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
./docs/demos/drift-analysis/run.sh --collection foc-upload-flow
./wtfoc serve -c foc-upload-flow   # web UI for full-stack demo
```
