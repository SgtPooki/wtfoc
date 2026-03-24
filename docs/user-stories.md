# User Stories

This catalog is the source of truth for `wtfoc` user stories, demo coverage, and supporting documentation.

Use this file to track:
- which stories are only ideas vs validated demos
- which examples and docs support each story
- which GitHub issues or specs are driving the work

Keep this page compact and structured. Prefer updating the table and the matching story section instead of adding long prose.

## Status Model

Use one of these values in the catalog:

| Status | Meaning |
|--------|---------|
| `proposed` | Story exists, but no committed implementation or demo plan yet |
| `planned` | Story has an issue/spec and a defined path forward |
| `in-progress` | Active work is underway |
| `needs-example` | Core idea is documented, but example/demo coverage is missing |
| `validated` | Story has a working example, docs, or a reproducible demo path |
| `archived` | Story is no longer a current priority |

## Catalog

Use stable IDs. Do not renumber existing stories.

| ID | Story | User | Status | Priority | Example | Docs | Issue |
|----|-------|------|--------|----------|---------|------|-------|
| `US-001` | Trace bug lineage across issues, PRs, comments, and repos | Engineer investigating bugs | `validated` | `high` | `docs/demos/upload-flow-trace/run.sh` | `docs/demos/upload-flow-trace.md` | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| `US-002` | Use `wtfoc` as a decentralized evidence layer in a RAG pipeline | AI engineer building RAG systems | `planned` | `high` | `-` | `-` | [#55](https://github.com/SgtPooki/wtfoc/issues/55) |
| `US-003` | Cluster repeated feature requests and unmet complaints across repos | Product or engineering lead prioritizing work | `planned` | `high` | `-` | `-` | [#57](https://github.com/SgtPooki/wtfoc/issues/57), [#59](https://github.com/SgtPooki/wtfoc/issues/59) |
| `US-004` | Detect stale documentation and undocumented implemented features | Maintainer or DX owner improving docs quality | `planned` | `medium` | `-` | `-` | [#58](https://github.com/SgtPooki/wtfoc/issues/58) |
| `US-005` | Build a unified knowledge graph across GitHub, docs sites, and chat | Team lead or DX engineer onboarding to a project | `validated` | `high` | `-` | `-` | `-` |
| `US-006` | Validate a knowledge graph locally then promote to decentralized storage | Builder evaluating wtfoc before committing to FOC | `planned` | `high` | `-` | `-` | [#60](https://github.com/SgtPooki/wtfoc/issues/60) |
| `US-007` | Score and classify ingested chunks by signal type (pain, praise, feature request, etc.) | Product lead or engineer filtering knowledge by intent | `planned` | `high` | `-` | `-` | [#61](https://github.com/SgtPooki/wtfoc/issues/61) |
| `US-008` | Ingest community discussions from Reddit, HN, and other public forums | Team tracking external signal about their project | `planned` | `medium` | `-` | `-` | [#65](https://github.com/SgtPooki/wtfoc/issues/65) |
| `US-009` | Visualize the knowledge graph as an interactive web UI | Anyone demoing or exploring cross-source connections | `planned` | `high` | `-` | `-` | [#67](https://github.com/SgtPooki/wtfoc/issues/67) |
| `US-010` | Review and validate extracted edges before promoting to FOC | Builder curating knowledge graph quality before immutable storage | `planned` | `medium` | `-` | `-` | [#69](https://github.com/SgtPooki/wtfoc/issues/69) |
| `US-011` | Get notified when high-relevance content is ingested | Team wanting proactive alerts from their knowledge graph | `planned` | `medium` | `-` | `-` | [#70](https://github.com/SgtPooki/wtfoc/issues/70) |

## How To Add A Story

1. Add one row to the catalog table.
2. Copy the story template into the `Story Details` section.
3. Link the relevant issue, spec, demo doc, and example paths.
4. Keep the README limited to flagship stories and links back here.

If a story is only an idea, that is fine. Mark it `proposed` and leave missing links as `-`.

## Editing Rules

- Keep the catalog table sorted by story ID.
- Keep story titles short and stable.
- Use repo-relative paths for `Example` and `Docs` entries when those assets exist.
- Use `-` for missing links instead of adding placeholder prose.
- Do not add large design discussions here. Link to an issue or spec instead.
- If a story grows beyond this page, create a dedicated doc under `docs/demos/` and link it.

## Story Details

### `US-001` Trace bug lineage across issues, PRs, comments, and repos

| Field | Value |
|-------|-------|
| Story | Trace a bug across fragmented GitHub artifacts and reconstruct the likely issue -> fix -> review chain |
| User | Engineer investigating bugs across one or more codebases |
| Pain | Relevant evidence is split across issues, PRs, PR comments, reviews, and neighboring repos; users must manually reconstruct the story |
| Why `wtfoc` | `wtfoc` can combine semantic recall with explicit edges and evidence-backed trace across source types |
| Inputs | Natural-language bug query plus ingested GitHub artifacts |
| Expected output | A lineage-first trace showing the primary artifact, likely fix, unresolved concerns, related context, and recommended next reads |
| Example/demo | `docs/demos/upload-flow-trace/run.sh` |
| Docs | `docs/demos/upload-flow-trace.md` |
| Issue/spec | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| Status | `validated` |
| Open gaps | Trace output is grouped by source type; could benefit from timeline-ordered view. Upload flow demo validated across 5 source types, ~16K chunks, 4 repos + 2 doc sites. |

### `US-002` Use `wtfoc` as a decentralized evidence layer in a RAG pipeline

| Field | Value |
|-------|-------|
| Story | Add decentralized, verifiable evidence storage and traceable retrieval to an existing RAG pipeline |
| User | AI engineer or platform engineer building retrieval-backed LLM systems |
| Pain | Typical RAG stacks store chunks and embeddings but lose provenance, portability, and explicit links between artifacts |
| Why `wtfoc` | `wtfoc` provides ingest, evidence persistence, explicit edges, backend-neutral identity, and FOC-backed decentralized storage as a default path |
| Inputs | Source documents, repos, or issue data plus a retrieval application that needs grounded evidence |
| Expected output | A documented integration path showing how `wtfoc` fits into a RAG stack without replacing the rest of the application |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#55](https://github.com/SgtPooki/wtfoc/issues/55) |
| Status | `planned` |
| Open gaps | Need clearer positioning docs, an architecture diagram, and at least one validated example showing local and/or FOC-backed storage behavior |

### `US-003` Cluster repeated feature requests and unmet complaints across repos

| Field | Value |
|-------|-------|
| Story | Detect common requests or complaints across issues, comments, discussions, and repos, then map likely implementation surfaces |
| User | Product lead, maintainer, or engineering lead deciding what gaps matter most |
| Pain | Repeated demand is spread across many artifacts and phrased differently, making it hard to see common threads or tell whether a request is still unmet |
| Why `wtfoc` | `wtfoc` can combine semantic clustering, explicit evidence links, and cross-repo trace to connect user feedback with implementation reality |
| Inputs | Issues, comments, discussions, and related code/doc artifacts across one or more repos |
| Expected output | A cluster of repeated requests with supporting evidence, a likely implemented vs unmet assessment, and likely repos/files/subsystems that would need to change |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#57](https://github.com/SgtPooki/wtfoc/issues/57) |
| Status | `planned` |
| Open gaps | Need a clustering/output model, a way to assess whether requests appear implemented, and heuristics for mapping feedback clusters to code surfaces |

### `US-004` Detect stale documentation and undocumented implemented features

| Field | Value |
|-------|-------|
| Story | Find docs that are likely out of date and features that appear implemented but not documented |
| User | Maintainer, DX owner, or agent preparing documentation updates |
| Pain | Docs drift from code over time, and implemented behavior often ships without corresponding documentation coverage |
| Why `wtfoc` | `wtfoc` can connect docs, code, tests, issues, and PRs to surface likely contradictions and missing documentation based on evidence |
| Inputs | Docs files, code, tests, PRs, issues, and changelog-like artifacts across one or more repos |
| Expected output | A prioritized list of likely stale docs and undocumented features, each with supporting evidence and likely files/docs to update |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#58](https://github.com/SgtPooki/wtfoc/issues/58) |
| Status | `planned` |
| Open gaps | Need heuristics for code-to-doc and doc-to-code comparison, evidence thresholds for drift, and a useful output format for prioritizing docs work |

### `US-005` Build a unified knowledge graph across GitHub, docs sites, and chat

| Field | Value |
|-------|-------|
| Story | Ingest multiple source types (GitHub repos/issues/PRs, documentation websites, Slack/Discord) into a single collection and query across all of them |
| User | Team lead, DX engineer, or anyone onboarding to a multi-repo project with scattered knowledge |
| Pain | Project knowledge lives in GitHub issues, docs sites, chat channels, and code — there's no single place to search across all of it |
| Why `wtfoc` | `wtfoc` has pluggable source adapters that normalize all sources into chunks with edges, enabling cross-source semantic search and trace |
| Inputs | GitHub repos, documentation site URLs, Slack/Discord exports or API tokens |
| Expected output | A single collection where `query` and `trace` return results spanning all ingested sources with source attribution |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | `-` |
| Status | `validated` |
| Open gaps | Validated with GitHub adapter + website adapter (docs.filecoin.cloud, 2,959 chunks). Slack adapter blocked on workspace approval (#10). Discord adapter built but deprioritized. Need a polished onboarding script showing the full multi-source flow. |

### `US-006` Validate a knowledge graph locally then promote to decentralized storage

| Field | Value |
|-------|-------|
| Story | Build and validate a knowledge graph using fast local storage, then promote the entire collection to FOC when ready |
| User | Builder evaluating wtfoc, or team that wants to iterate before committing to decentralized storage |
| Pain | Re-ingesting everything from scratch just to switch storage backends wastes time and compute; users want a try-before-you-commit workflow |
| Why `wtfoc` | wtfoc already has pluggable storage backends (local, FOC) and content-addressed segments — promotion is a natural migration path |
| Inputs | An existing local collection with segments and manifest |
| Expected output | `wtfoc promote <collection> --storage foc` bundles segments into CAR, uploads to FOC, updates manifest with new CIDs |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#60](https://github.com/SgtPooki/wtfoc/issues/60) |
| Status | `planned` |
| Open gaps | Need to decide on idempotency behavior, whether to support reverse direction (FOC → local), and cleanup of local copies after promotion |

### `US-007` Score and classify ingested chunks by signal type

| Field | Value |
|-------|-------|
| Story | Classify and score ingested chunks across multiple signal types (pain, praise, feature request, workaround, demand, question) so query and trace can filter by intent |
| User | Product lead or engineer filtering knowledge by intent |
| Pain | Query results ranked by similarity alone can't distinguish frustration from praise — both match semantically but mean very different things |
| Why `wtfoc` | Multi-signal scoring adds a second ranking dimension that makes noisy sources useful and enables intent-aware queries |
| Inputs | Ingested chunks from any source adapter |
| Expected output | Each chunk has `signalScores: Record<string, number>` with per-type scores; query/trace support signal type filters |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#61](https://github.com/SgtPooki/wtfoc/issues/61) |
| Status | `planned` |
| Open gaps | Ranking formula, explainability (matched patterns), extended taxonomy (bug_report, incident, resolution) deferred |

### `US-008` Ingest community discussions from Reddit, HN, and other public forums

| Field | Value |
|-------|-------|
| Story | Ingest public community discussions (HN, Reddit, Bluesky, etc.) as evidence-backed source material that can reference internal artifacts |
| User | Team tracking external signal about their project |
| Pain | Community forums contain bug reports, feature requests, and workarounds that reference internal artifacts but are invisible to the knowledge graph |
| Why `wtfoc` | Pluggable source adapters normalize community content into chunks with edges, enabling cross-source trace between internal and external knowledge |
| Inputs | Community platform keywords/feeds (HN search, subreddit, etc.) |
| Expected output | Community chunks appear in query/trace with edges linking to GitHub issues, docs, and other ingested sources |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#65](https://github.com/SgtPooki/wtfoc/issues/65) |
| Status | `planned` |
| Open gaps | HN adapter is P0; Reddit, Bluesky, Dev.to, Lobsters deferred to follow-up issues |

### `US-009` Visualize the knowledge graph as an interactive web UI

| Field | Value |
|-------|-------|
| Story | Launch a local web UI (`wtfoc serve`) that renders the knowledge graph as an interactive node-edge diagram with search, trace, and FOC verification links |
| User | Anyone demoing or exploring cross-source connections |
| Pain | CLI output is powerful but hard to demo; visual graphs are dramatically more compelling for presentations and onboarding |
| Why `wtfoc` | A visual graph makes cross-source connections and FOC provenance tangible — each node links to its IPFS gateway URL |
| Inputs | Any local collection produced by `wtfoc ingest` |
| Expected output | Interactive graph with chunk nodes colored by source type, edge evidence on hover, search/trace modes, and CID verification badges |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#67](https://github.com/SgtPooki/wtfoc/issues/67) |
| Status | `planned` |
| Open gaps | Tech choice for graph rendering (D3.js vs vis.js), scale testing with large collections |

### `US-010` Review and validate extracted edges before promoting to FOC

| Field | Value |
|-------|-------|
| Story | Review extracted edges in a triage UI — approve, reject, or override — before promoting a collection to immutable FOC storage |
| User | Builder curating knowledge graph quality before immutable storage |
| Pain | Regex edge extraction produces false positives; once promoted to FOC, segments are immutable and can't be corrected |
| Why `wtfoc` | Human-in-the-loop quality gate preserves provenance (original extraction kept) while allowing correction before immutable commit |
| Inputs | Local collection with extracted edges, served via `wtfoc serve` |
| Expected output | Triage sidecar file with approve/reject/override decisions; `wtfoc promote` respects decisions |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#69](https://github.com/SgtPooki/wtfoc/issues/69) |
| Status | `planned` |
| Open gaps | Blocked on #67 (`wtfoc serve`); edge identity stability across re-ingests |

### `US-011` Get notified when high-relevance content is ingested

| Field | Value |
|-------|-------|
| Story | Receive proactive notifications (Discord, console) when ingestion discovers high-relevance content like cross-source references or edge clusters |
| User | Team wanting proactive alerts from their knowledge graph |
| Pain | Today wtfoc is query-only — you have to ask to learn anything; important new context can go unnoticed |
| Why `wtfoc` | Notification callbacks during ingest make wtfoc proactive, especially valuable with noisy community sources |
| Inputs | Ingest pipeline events (cross-source references, edge clusters) |
| Expected output | Discord/console alerts with chunk IDs, source URLs, and edge evidence for traceability |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#70](https://github.com/SgtPooki/wtfoc/issues/70) |
| Status | `planned` |
| Open gaps | Signal-score-based triggers blocked on #61; trigger rule aggregation scope needs spec |

## Story Template

Copy this block when adding a new story:

```md
### `US-XXX` Short story title

| Field | Value |
|-------|-------|
| Story | One-sentence user story |
| User | Primary persona |
| Pain | What is hard today |
| Why `wtfoc` | Why `wtfoc` is relevant |
| Inputs | What the user starts with |
| Expected output | What success looks like |
| Example/demo | `-` or `examples/...` |
| Docs | `-` or `docs/demos/...` |
| Issue/spec | `-` or issue/spec link |
| Status | `proposed` |
| Open gaps | Short list in one sentence |
```

## Next Locations

As story coverage grows, use these locations:

- `docs/demos/` for narrative walkthroughs and demo scripts
- `examples/` for runnable integrations or sample setups
- `.github/ISSUE_TEMPLATE/` for optional structured story intake
