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
| `US-001` | Trace bug lineage across issues, PRs, comments, and repos | Engineer investigating bugs | `validated` | `high` | `docs/demos/upload-flow-trace.sh` | `docs/demos/upload-flow-trace.md` | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| `US-002` | Use `wtfoc` as a decentralized evidence layer in a RAG pipeline | AI engineer building RAG systems | `planned` | `high` | `-` | `-` | [#55](https://github.com/SgtPooki/wtfoc/issues/55) |
| `US-003` | Cluster repeated feature requests and unmet complaints across repos | Product or engineering lead prioritizing work | `planned` | `high` | `-` | `-` | [#57](https://github.com/SgtPooki/wtfoc/issues/57), [#59](https://github.com/SgtPooki/wtfoc/issues/59) |
| `US-004` | Detect stale documentation and undocumented implemented features | Maintainer or DX owner improving docs quality | `planned` | `medium` | `-` | `-` | [#58](https://github.com/SgtPooki/wtfoc/issues/58) |
| `US-005` | Build a unified knowledge graph across GitHub, docs sites, and chat | Team lead or DX engineer onboarding to a project | `validated` | `high` | `-` | `-` | `-` |
| `US-006` | Validate a knowledge graph locally then promote to decentralized storage | Builder evaluating wtfoc before committing to FOC | `planned` | `high` | `-` | `-` | [#60](https://github.com/SgtPooki/wtfoc/issues/60) |

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
| Example/demo | `docs/demos/upload-flow-trace.sh` |
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
