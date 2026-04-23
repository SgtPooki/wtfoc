# Ask a real question, get an evidence chain

**Time:** ~10-30s depending on embedder + collection size.
**Prerequisites:** `wtfoc` CLI built, `filoz-ecosystem-2026-04-v12` collection
present locally (or pass `--collection <name>` to target your own).
**State:** Local only. No network required once the collection is on disk.

## The narrative

RAG systems answer "what is X" by finding a chunk. wtfoc answers "how did
X come to be" by walking evidence across sources. This demo asks one
real question — *what PRs fix bugs in the chunking code and which files
did they touch?* — and shows three framings of the same trace:

1. **Evidence view** — raw hops grouped by source type. Who said what, where.
2. **Lineage view** — reconstructed chains: discussion → decision → change.
3. **Timeline view** — same hops in chronological order. When the story happened.

Slack, GitHub issues, PRs, PR comments, and source code all show up in
the walk. Not because we jammed them in; because the edges between them
actually exist in the corpus.

## Run it

```bash
./docs/demos/cross-source-question/run.sh
```

Default question (measured: reaches 5 source types on flagship v12):

> What PRs fix bugs in the chunking code and which files did they touch?

Alternate questions with similar cross-source reach:

```bash
./docs/demos/cross-source-question/run.sh --alt dl-8
# "What recent pull requests changed PDP, proof set, or proof verification behavior?"
```

Any concrete question:

```bash
./docs/demos/cross-source-question/run.sh --question "your question here"
```

Against your own collection:

```bash
./docs/demos/cross-source-question/run.sh --collection <name> --question "..."
```

## What success looks like

Three trace outputs in sequence. The evidence view should show hops
under at least 3 distinct source types (for the default question,
typically 5: `slack-message`, `github-issue`, `github-pr`,
`github-pr-comment`, `code`). The lineage view should show at least
one multi-hop chain. The timeline view should surface timestamps in
ascending order.

If the evidence view collapses to one source type, the question is
probably too abstract — see `docs/querying-guide.md` § 4 on
abstract-cross-source limitations. Rephrase to name the topic
concretely (a module, a behavior, an artifact name).

## Why this (and not port-1/port-2/port-3)

The portable fixture in the gold-standard evals (`port-1/2/3`) asks
things like *"find a bug report, the PR that closed it, and the code
that changed"* — fully abstract, no corpus-specific names. Those
deliberately test whether retrieval *generically* surfaces cross-source
evidence; they currently don't reliably bridge to `code` on real
corpora (known limitation — multi-step retrieval is the principled
fix, tracked for post-demo). For a live demo we use **concrete**
questions that already trace cleanly, and we are honest about the
difference.

## Timing

On `filoz-ecosystem-2026-04-v12` (13.4K chunks, 37 segments) with a
local embedder, each of the three trace calls runs in seconds. The
whole script completes in ~10-30s.

## See also

- `docs/querying-guide.md` — phrasing rules, diversity-enforce, trace vs query.
- `docs/demos/verify-cid/` — complementary demo: the audience can verify
  the collection this demo is tracing against is the exact one we published.
- `docs/demos/upload-flow-trace/` — longer narrative that shows a full
  feature trace across 5 source types on a purpose-built collection.
