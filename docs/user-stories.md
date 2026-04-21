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
| `US-001` | Trace bug lineage across issues, PRs, comments, and repos | Engineer investigating bugs | `validated` | `high` | `docs/demos/upload-flow-trace/run.sh` | `docs/demos/upload-flow-trace/README.md` | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| `US-002` | Use `wtfoc` as a decentralized evidence layer in a RAG pipeline | AI engineer building RAG systems | `planned` | `high` | `-` | `-` | [#55](https://github.com/SgtPooki/wtfoc/issues/55) |
| `US-003` | Cluster repeated feature requests and unmet complaints across repos | Product or engineering lead prioritizing work | `validated` | `high` | `docs/demos/theme-discovery/run.sh` | `docs/demos/theme-discovery/README.md` | [#57](https://github.com/SgtPooki/wtfoc/issues/57), [#59](https://github.com/SgtPooki/wtfoc/issues/59) |
| `US-004` | Detect stale documentation and undocumented implemented features | Maintainer or DX owner improving docs quality | `validated` | `medium` | `docs/demos/drift-analysis/run.sh` | `docs/demos/drift-analysis/README.md` | [#58](https://github.com/SgtPooki/wtfoc/issues/58) |
| `US-005` | Build a unified knowledge graph across GitHub, docs sites, and chat | Team lead or DX engineer onboarding to a project | `validated` | `high` | `docs/demos/upload-flow-trace/run.sh` | `docs/demos/upload-flow-trace/README.md` | `-` |
| `US-006` | Validate a knowledge graph locally then promote to decentralized storage | Builder evaluating wtfoc before committing to FOC | `validated` | `high` | `docs/demos/local-to-foc/run.sh` | `docs/demos/local-to-foc/README.md` | [#60](https://github.com/SgtPooki/wtfoc/issues/60) |
| `US-007` | Score and classify ingested chunks by signal type (pain, praise, feature request, etc.) | Product lead or engineer filtering knowledge by intent | `planned` | `high` | `-` | `-` | [#61](https://github.com/SgtPooki/wtfoc/issues/61) |
| `US-008` | Ingest community discussions from Reddit, HN, and other public forums | Team tracking external signal about their project | `planned` | `medium` | `-` | `-` | [#65](https://github.com/SgtPooki/wtfoc/issues/65) |
| `US-009` | Visualize the knowledge graph as an interactive web UI | Anyone demoing or exploring cross-source connections | `needs-example` | `high` | `-` | `docs/demos/full-stack/README.md` | [#67](https://github.com/SgtPooki/wtfoc/issues/67) |
| `US-010` | Review and validate extracted edges before promoting to FOC | Builder curating knowledge graph quality before immutable storage | `planned` | `medium` | `-` | `-` | [#69](https://github.com/SgtPooki/wtfoc/issues/69) |
| `US-011` | Get notified when high-relevance content is ingested | Team wanting proactive alerts from their knowledge graph | `planned` | `medium` | `-` | `-` | [#70](https://github.com/SgtPooki/wtfoc/issues/70) |
| `US-012` | Find unresolved TODOs in source code | Tech lead auditing codebase health | `idea` | `-` | `-` | `-` | `-` |
| `US-013` | Incrementally ingest and monitor sources over time | Team maintaining a living knowledge graph | `validated` | `high` | `docs/demos/incremental-ingest/run.sh` | `docs/demos/incremental-ingest/README.md` | [#118](https://github.com/SgtPooki/wtfoc/issues/118) |
| `US-014` | Surface unanswered community questions that don't match existing knowledge | DX or product lead identifying coverage gaps | `proposed` | `high` | `-` | `-` | `-` |
| `US-015` | Cross-organization work insight — trace work evolution from Slack conversations through issues, PRs, code, and docs | Engineering lead / product / researcher asking "what's been happening across our projects over the last N weeks" | `in-progress` | `high` | `-` | `docs/demos/cross-org-insight/README.md` (TBD) | `-` |
| `US-016` | Fine-grained access control on multi-source collections — grant read access per source or per source-type without sharing the whole collection | Team owner sharing a 50+ source collection with collaborators who should only see a subset | `proposed` | `high` | `-` | `-` | [#290](https://github.com/SgtPooki/wtfoc/issues/290) |

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
| Docs | `docs/demos/upload-flow-trace/README.md` |
| Issue/spec | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| Status | `validated` |
| Open gaps | Trace output is grouped by source type; could benefit from timeline-ordered view. Upload flow demo validated across 5 source types, ~16K chunks, 4 repos + 2 doc sites. |

#### June 7 2026 demo acceptance (lightweight opener)

This story serves as the lightweight demo opener for the June 7 2026 conference. Corpus is wtfoc ingested against itself (`wtfoc-dogfood-2026-04-*` series) — self-referential proof of capability on a single repo + its issues + PRs + docs.

**Empirical baseline** (`wtfoc-dogfood-2026-04-v3-ast`, 2026-04-16):
- 21 / 30 gold queries pass (70% overall)
- direct-lookup 6/8 (75%), cross-source 5/7 (71%), coverage 5/8 (62%), synthesis 5/7 (71%)
- 9 failures all cluster on out-of-scope Filecoin ecosystem queries that belong to the flagship corpus (US-015), not retrieval bugs

**Demo-safe query set** (each already passes on the current corpus, each produces multi-hop lineage and cross-source citations):

| Gold ID | Query | Why demo-safe |
|---------|-------|---------------|
| `cs-1` | What issues discuss edge resolution and how is it implemented? | chainCoverageRate 1.0, crossSourceChainRate 1.0, 10 multi-hop chains |
| `cs-2` | What PRs changed the search or trace functionality and what code did they touch? | chainCoverageRate 0.87, strong code↔PR links |
| `cs-4` | What PRs fix bugs in the chunking code and which files did they touch? | chainCoverageRate 0.73, avgChainDiversity 3.0 |
| `syn-4` | What is the release process and how are versions tagged? | chainCoverageRate 0.93, 9 multi-hop chains |
| `dl-1` | How does the ingest pipeline process source files? | Direct-lookup with cross-source validation, 11 multi-hop chains |

**Pass criteria for the live demo:**
- Dogfood run of the day shows ≥ 70% pass rate on the full 30-query gold set
- All 5 demo-safe queries above must pass in the same run
- Each live-demo query must render (a) a primary artifact, (b) at least one multi-hop lineage chain, (c) cross-source citations across ≥ 2 source types
- No hallucinated file paths in citations — checked via local `store.storage.verify` against segment chunk source paths
- Trust report (US from #43) passes on the demo corpus

**Fail modes to rehearse:**
- Dogfood pass rate drops below 70% on demo-day collection — fall back to showing the prior day's report + live trace on a single pre-run query
- Slack adapter needed? Not for this story — slack-less. Flagship story (US-015) owns slack integration.

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
| Example/demo | `docs/demos/theme-discovery/run.sh` |
| Docs | `docs/demos/theme-discovery/README.md` |
| Issue/spec | [#57](https://github.com/SgtPooki/wtfoc/issues/57) |
| Status | `validated` |
| Open gaps | `themes` command covers clustering; need signal-type classification to distinguish requests from complaints. Need a clustering/output model, a way to assess whether requests appear implemented, and heuristics for mapping feedback clusters to code surfaces |

### `US-004` Detect stale documentation and undocumented implemented features

| Field | Value |
|-------|-------|
| Story | Find docs that are likely out of date and features that appear implemented but not documented |
| User | Maintainer, DX owner, or agent preparing documentation updates |
| Pain | Docs drift from code over time, and implemented behavior often ships without corresponding documentation coverage |
| Why `wtfoc` | `wtfoc` can connect docs, code, tests, issues, and PRs to surface likely contradictions and missing documentation based on evidence |
| Inputs | Docs files, code, tests, PRs, issues, and changelog-like artifacts across one or more repos |
| Expected output | A prioritized list of likely stale docs and undocumented features, each with supporting evidence and likely files/docs to update |
| Example/demo | `docs/demos/drift-analysis/run.sh` |
| Docs | `docs/demos/drift-analysis/README.md` |
| Issue/spec | [#58](https://github.com/SgtPooki/wtfoc/issues/58) |
| Status | `validated` |
| Open gaps | `/drift-check` skill works and has been validated on real collections (found undocumented `presignForCommit()` step, unclear upload behavior, missing contract upgrade docs). Needs a dedicated web UI panel and more sophisticated diff heuristics |

### `US-005` Build a unified knowledge graph across GitHub, docs sites, and chat

| Field | Value |
|-------|-------|
| Story | Ingest multiple source types (GitHub repos/issues/PRs, documentation websites, Slack/Discord) into a single collection and query across all of them |
| User | Team lead, DX engineer, or anyone onboarding to a multi-repo project with scattered knowledge |
| Pain | Project knowledge lives in GitHub issues, docs sites, chat channels, and code — there's no single place to search across all of it |
| Why `wtfoc` | `wtfoc` has pluggable source adapters that normalize all sources into chunks with edges, enabling cross-source semantic search and trace |
| Inputs | GitHub repos, documentation site URLs, Slack/Discord exports or API tokens |
| Expected output | A single collection where `query` and `trace` return results spanning all ingested sources with source attribution |
| Example/demo | `docs/demos/upload-flow-trace/run.sh` |
| Docs | `docs/demos/upload-flow-trace/README.md` |
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
| Example/demo | `docs/demos/local-to-foc/run.sh` |
| Docs | `docs/demos/local-to-foc/README.md` |
| Issue/spec | [#60](https://github.com/SgtPooki/wtfoc/issues/60) |
| Status | `validated` |
| Open gaps | Promote command works but sharing flow needs verification: promote outputs carRootCid (directory of segments) while web UI CID input expects manifest CID. Need to decide on idempotency behavior, whether to support reverse direction (FOC → local), and cleanup of local copies after promotion |

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
| Story | Use a local or hosted web UI to explore collections as an interactive graph with search, trace, and FOC-aware verification, with a path toward wallet-connected write flows |
| User | Anyone demoing, exploring, or deploying `wtfoc` as a usable application rather than a CLI-only tool |
| Pain | CLI output is powerful but hard to demo, hard to host, and not a good foundation for wallet UX, connector auth, or future encrypted collection management |
| Why `wtfoc` | A web application makes cross-source connections and FOC provenance tangible while creating a real product surface for hosted use cases |
| Inputs | Any local collection produced by `wtfoc ingest`, with a path to hosted collections and FOC-backed publish flows |
| Expected output | Interactive graph with chunk nodes colored by source type, edge evidence on hover, search/trace modes, CID verification badges, and a clean split between local `wtfoc serve` and deployable web app runtime |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#67](https://github.com/SgtPooki/wtfoc/issues/67) |
| Status | `planned` |
| Open gaps | Need to define the split between local `wtfoc serve` and deployable web app, shared API boundaries, hosted auth/wallet concerns, and scale testing with large collections |

### `US-010` Review and validate extracted edges before promoting to FOC

| Field | Value |
|-------|-------|
| Story | Review extracted edges in a triage UI — approve, reject, or override — before promoting a collection to immutable FOC storage |
| User | Builder curating knowledge graph quality before immutable storage |
| Pain | Regex edge extraction produces false positives; once promoted to FOC, segments are immutable and can't be corrected |
| Why `wtfoc` | Human-in-the-loop quality gate preserves provenance (original extraction kept) while allowing correction before immutable commit |
| Inputs | Local collection with extracted edges, served via the shared local app/runtime layer |
| Expected output | Triage sidecar file with approve/reject/override decisions; `wtfoc promote` respects decisions |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#69](https://github.com/SgtPooki/wtfoc/issues/69) |
| Status | `planned` |
| Open gaps | Blocked on the shared UI/app runtime from #67; edge identity stability across re-ingests |

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

### `US-012` Find unresolved TODOs in source code

| Field | Value |
|-------|-------|
| Story | Trace TODO/FIXME/HACK comments in ingested source code against GitHub issues and Slack discussions to identify which TODOs are tracked (linked to an issue) and which are orphaned tech debt |
| User | Tech lead auditing codebase health, or engineer prioritizing tech debt |
| Pain | TODO comments accumulate silently — some reference issues that are already closed, some have no corresponding issue at all, and nobody knows which are stale vs active |
| Why `wtfoc` | The edge system already extracts `#N` refs from code comments. The value-add is surfacing TODOs that have *no* edge — they're tech debt nobody's tracking. Cross-referencing against Slack discussions can reveal TODOs that were discussed but never filed as issues |
| Inputs | Ingested repo (code chunks with TODO/FIXME/HACK), plus GitHub issues and optionally Slack |
| Expected output | Report grouping TODOs into: tracked (edge to open issue), resolved (edge to closed issue), orphaned (no edge), and discussed (semantic match in Slack but no issue) |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | `-` |
| Status | `idea` |
| Open gaps | Need to extract TODO comments as a distinct chunk type or metadata tag during repo ingest; closed-issue detection requires GitHub API enrichment; could be a `/todo-audit` skill or drift-check variant |

### `US-013` Incrementally ingest and monitor sources over time

| Field | Value |
|-------|-------|
| Story | Add sources incrementally to a collection, track what's been ingested and when, monitor for new content, and avoid re-fetching history that's already captured |
| User | Team maintaining a living knowledge graph that stays current with ongoing work |
| Pain | Today every ingest run either re-fetches everything or requires manually tracking `--since` dates. There's no record of what sources were ingested, when, or with what parameters. Re-ingesting a repo means re-fetching all issues even if you only need the last week. Large collections become expensive to keep fresh |
| Why `wtfoc` | The manifest chain already tracks segments and their sources. Extending this to track ingest cursors (last fetched timestamp, source config, `--since` watermark) per source would make incremental updates automatic and idempotent |
| Inputs | A collection with previously ingested sources, plus new content arriving in those sources over time |
| Expected output | `wtfoc sync -c my-collection` fetches only new content since the last successful ingest for each source. `wtfoc sources -c my-collection` shows per-source status: last ingested timestamp, cursor position, whether backfill is complete, chunk count. Source ingest config (type, args, `--since`) is persisted in the manifest or a sidecar config so re-running is zero-config |
| Example/demo | `docs/demos/incremental-ingest/run.sh` |
| Docs | `docs/demos/incremental-ingest/README.md` |
| Issue/spec | [#118](https://github.com/SgtPooki/wtfoc/issues/118) |
| Status | `validated` |
| Open gaps | Manual incremental ingest works today (append + content-hash dedup + `--since`). Need a source registry schema (type, config, last cursor, backfill status) persisted per collection. Need to decide: store in manifest vs `.wtfoc.json` project config (#39). Need to define cursor semantics per adapter (GitHub uses `since` ISO date, Slack uses message timestamp, HN uses Algolia page offset). Need a `wtfoc sync` or `wtfoc update` command that reads the registry and runs incremental ingests |

### `US-014` Surface unanswered community questions that don't match existing knowledge

| Field | Value |
|-------|-------|
| Story | Find common questions asked in Slack, Reddit, HN, and Discord that don't have matching answers in the ingested knowledge graph, so teams can identify documentation gaps, missing features, or poorly connected content |
| User | DX lead, product owner, or support engineer identifying what users are asking that the project doesn't address |
| Pain | Community channels are full of questions, but there's no way to know which questions are answered by existing docs/code and which represent real gaps. Manually reading every channel is not scalable. Even with wtfoc's trace, you have to ask the right question — you don't know what questions *others* are asking |
| Why `wtfoc` | wtfoc already ingests community sources and scores chunks by signal type (question signal via #61). By collecting question-scored chunks and running them as queries against the rest of the collection, wtfoc can identify which questions have strong matches (answered) and which have weak or no matches (gaps) |
| Inputs | A collection with community sources (Slack, HN, Discord) plus internal sources (GitHub, docs, code) already ingested |
| Expected output | A ranked list of unanswered questions: community chunks with high `question` signal score but low trace/query match confidence against internal sources. Each entry shows the question text, source, and the best (but weak) matches found. Optionally grouped by topic cluster. Could be a CLI command (`wtfoc gaps -c my-collection`), a skill (`/find-gaps`), or a web UI panel |
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | `-` |
| Status | `proposed` |
| Open gaps | Need to define "unanswered" threshold (e.g., best trace match < 0.4 confidence). Need to decide whether to use the `question` signal score from #61 or a simpler heuristic (chunks containing "?"). Need dedup/clustering so 20 people asking the same question shows as one gap, not 20. Related to US-003 (clustering) and US-004 (stale docs) |

### `US-015` Cross-organization work insight across code / issues / PRs / docs / chat

| Field | Value |
|-------|-------|
| Story | A team lead or researcher asks "what has been happening across our projects over the last N weeks" and gets a time-ordered, cross-source trace showing how work evolved from Slack conversations to issues, PRs, code changes, and documentation updates |
| User | Engineering lead, product lead, or embedded researcher tracking an organization's work across many repos and communication channels |
| Pain | Work is fragmented across 50+ sources — Slack threads, GitHub issues/PRs/reviews, docs sites, Notion (future). Humans and AI agents can't efficiently answer "what customer complaint drove this PR", "what design discussions led to this doc update", or "what shipped in the last 2 weeks on topic X" |
| Why `wtfoc` | `wtfoc` normalizes every source type into chunks + edges, so time-ordered trace across Slack → issue → PR → code → doc is a first-class query, not a manual spelunk |
| Inputs | A collection spanning 2+ repos, GitHub issues/PRs with comments + reviews, doc sites, Slack channels (with workspace admin approval), and a natural-language work-evolution question |
| Expected output | A time-ordered lineage trace that crosses source types: conversations → issues → PRs → code/docs. Each hop shows timestamp, source type, and evidence. Works for "last N days" time windows |
| Example/demo | TBD — `docs/demos/cross-org-insight/` once corpus + gold queries land |
| Docs | TBD |
| Issue/spec | Parent tracked under #264 (conference MVP plan) as flagship demo; see also #274 chronological trace projection, #280 TimestampKind (both shipped). Slack blocked on #10. |
| Status | `in-progress` |
| Open gaps | Slack adapter blocked on workspace admin approval (#10). Latest filoz-ecosystem corpus (v11, 18725 chunks, 41 segments) has code + issues + PRs + pr-comments + markdown but NO slack-message and NO doc-page — earlier foc-ecosystem-v2 had both. Need to produce a v12 with slack + doc-sites re-added. Flagship-specific gold queries need writing (current gold set is wtfoc-self biased, underspecifies cross-org/time-window queries). |

#### June 7 2026 demo acceptance (flagship)

Corpus: `filoz-ecosystem-2026-04-v12` (to be built). Source types target: `code`, `github-issue`, `github-pr`, `github-pr-comment`, `markdown`, `doc-page`, `slack-message`.

**Proposed demo questions** (subject to iteration once corpus + gold queries are built):

1. *"What customer complaints from last month shaped PR #N?"* — slack-message → github-issue → github-pr chain, time-ordered
2. *"Which design discussions were resolved in doc site updates?"* — github-pr-comment → doc-page
3. *"What work happened on topic X in the last 2 weeks?"* — time-window cross-source query
4. *"How did the approach to problem Y evolve from first mention to shipped code?"* — lineage over time spanning ≥ 3 source types
5. *"Which open issues reference completed PRs?"* — resolution-state mismatch

**Acceptance for the live demo:**
- v12 corpus built with all 7 source types, dogfood pass rate ≥ 70% on flagship-specific gold queries
- At least 4/5 demo questions pass with multi-hop cross-source lineage including ≥ 1 `slack-message` hop
- Time-window queries surface `hopsWithTimestamp > 0` on ≥ 3/5 questions (requires #274 chronological projection already landed)
- Trust report (US from #43) passes on v12

**Blockers:**
- Slack adapter ingest unblocking (#10)
- Doc-site re-ingest on v12
- Flagship gold queries need to be added to `packages/search/src/eval/gold-standard-queries.ts`

### `US-016` Fine-grained access control on multi-source collections

| Field | Value |
|-------|-------|
| Story | A collection owner ingests 50+ sources into one collection and grants collaborators read access to only the subset they should see, without sharing the whole collection |
| User | Team owner or platform operator managing a shared knowledge graph that mixes public and sensitive sources |
| Pain | Today a `wtfoc` collection is all-or-nothing. Ingesting Slack alongside public GitHub means either sharing everything or splitting into multiple collections, which loses cross-source trace value |
| Why `wtfoc` | Content-addressed segments make per-source encryption natural — segments can stay public CIDs while payloads are ciphertext, and manifests can carry wrap-key grants per-reader |
| Inputs | A collection with multiple sources, an owner wallet, a grantee wallet/identity, a policy statement ("grantee can read sources X and Y but not Z") |
| Expected output | Grantee can query and trace over the subset; restricted content appears as redacted-count placeholders; revocation works via key rotation |
| Example/demo | `-` |
| Docs | `-` (see epic #290) |
| Issue/spec | [#290](https://github.com/SgtPooki/wtfoc/issues/290) — epic; children #291-#300 |
| Status | `proposed` |
| Open gaps | Full epic — threat model, per-source key model, edge-gate enforcement, grant/revoke flow, redaction UX, index partitioning, owner UX, FOC promotion with ciphertext. Not on June 7 demo critical path but likely surfaced by audience Q&A for the flagship story, so scoping via child issues before demo day is useful |

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
