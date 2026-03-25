# wtfoc Demos

Each demo has a human-readable **README.md** (the narrative) and an executable **run.sh** (the automation). Run the scripts from the repo root.

## Demo Catalog

| Demo | Time | What it shows | Command |
|------|------|--------------|---------|
| [Quick Start](quick-start/) | ~2 min | 3 commands, no API key, local embeddings | `./docs/demos/quick-start/run.sh` |
| [Upload Flow Trace](upload-flow-trace/) | ~15 min | Cross-repo feature trace across 5 source types | `./docs/demos/upload-flow-trace/run.sh` |
| [Gap Analysis](gap-analysis/) | ~5 min | System finds what's missing from your collection | `./docs/demos/gap-analysis/run.sh` |
| [Theme Discovery](theme-discovery/) | ~5 min | Semantic clustering — no LLM, pure math | `./docs/demos/theme-discovery/run.sh` |
| [Incremental Ingest](incremental-ingest/) | ~10 min | Collections grow over time, dedup included | `./docs/demos/incremental-ingest/run.sh` |
| [Drift Analysis](drift-analysis/) | ~10 min | Find stale docs and undocumented features | `./docs/demos/drift-analysis/run.sh` |
| [Local to FOC](local-to-foc/) | ~5 min | Build locally, promote to Filecoin, share CID | `./docs/demos/local-to-foc/run.sh` |
| [Full Stack](full-stack/) | ~10 min | MCP + Web UI + Claude Desktop integration | (see README) |

Times assume first-run ingest. With `--skip-ingest` on a pre-built collection, traces run in seconds.

## Recommended Demo Arc

For a recording or live presentation, run them in this order:

1. **Quick Start** — Establish credibility: zero setup cost, no API key
2. **Upload Flow Trace** — The hero story: cross-repo architecture tracing with real results
3. **Gap Analysis** — The "aha" moment: the system tells you what to ingest next
4. **Theme Discovery** — Instant orientation: what is the conversation actually about?
5. **Incremental Ingest** — Answer the "one-shot or incremental?" question
6. **Drift Analysis** — The detective: docs say X, GitHub says Y — who's right?
7. **Local to FOC** — The trust arc: same collection, now on Filecoin with a shareable CID
8. **Full Stack** — The finale: Claude uses wtfoc as a tool, web UI shows the graph

## Shared Flags

Most `run.sh` scripts support these flags (exceptions: `incremental-ingest` does not support `--skip-ingest` since the multi-round flow is the point):

```bash
--skip-ingest                    # Skip collection setup, run analysis only
--embedder-url lmstudio          # Use LM Studio as embedder
--embedder-url <url>             # Use any OpenAI-compatible embedder
--embedder-model <model>         # Specify embedder model
```

The gap-analysis and theme-discovery scripts also support:

```bash
--collection <name>              # Run against an existing collection
```

## Pre-Baking for Presentations

Run the upload-flow-trace demo the night before — it ingests ~16K chunks and takes 10-15 minutes. Then all other demos can reuse that collection:

```bash
# Night before
./docs/demos/upload-flow-trace/run.sh

# During presentation
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
./wtfoc serve -c foc-upload-flow   # web UI for full-stack demo
```
