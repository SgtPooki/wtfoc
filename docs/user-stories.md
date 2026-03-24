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
| `US-001` | Trace bug lineage across issues, PRs, comments, and repos | Engineer investigating bugs | `planned` | `high` | `-` | `-` | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| `US-002` | Use `wtfoc` as a decentralized evidence layer in a RAG pipeline | AI engineer building RAG systems | `planned` | `high` | `-` | `-` | [#55](https://github.com/SgtPooki/wtfoc/issues/55) |

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
| Example/demo | `-` |
| Docs | `-` |
| Issue/spec | [#54](https://github.com/SgtPooki/wtfoc/issues/54) |
| Status | `planned` |
| Open gaps | Trace output is still grouped primarily by source type; timestamps and lineage heuristics need to be surfaced more clearly |

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
