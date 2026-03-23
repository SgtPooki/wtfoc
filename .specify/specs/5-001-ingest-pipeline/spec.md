# Feature Specification: Ingest Pipeline

**Feature Branch**: `5-001-ingest-pipeline`
**Created**: 2026-03-23
**Status**: Draft (clarify complete; awaiting `/peer-review`)
**Spec**: [`SPEC.md`](../../../SPEC.md) rules 2–3, 6–7; ingest order in Development Discipline
**Package**: `@wtfoc/ingest`

## Overview

Implement the `@wtfoc/ingest` package: **chunking**, **pluggable source adapters**, and **edge extraction** so knowledge from Slack exports and GitHub can be turned into typed `Chunk` records and evidence-backed `Edge` records defined in `@wtfoc/common`.

This spec covers ingest **up to** chunks and edges suitable for handoff to embedding and segment bundling (`@wtfoc/search` and `@wtfoc/store`). It does **not** define embedding, vector indexing, or storage upload—those stay at their respective seams.

## Clarifications

### Session 2026-03-23

- Q: Where does the ingest pipeline end relative to embedding and segment upload? → A: Ingest yields `Chunk` streams and `Edge[]`; embedding, segment assembly with vectors, storage upload, and manifest updates are **out of scope** for this package (orchestrated by `@wtfoc/cli` using `@wtfoc/search` + `@wtfoc/store`).
- Q: Which GitHub objects must the default adapter cover for MVP? → A: Issues and pull requests reachable via `gh` for a configured repo (list/read), producing chunks with stable `source` identifiers; CI logs and arbitrary API surfaces are out of scope.
- Q: What chunking defaults apply when the user does not tune options? → A: Character-based windows with a documented default maximum chunk size and overlap, applied consistently across text sources; exact numbers are implementation choices recorded in package docs and tests.
- Q: How are `SourceAdapter.extractEdges` and `EdgeExtractor.extract` combined when both run? → A: Default orchestration **concatenates** results: source-native edges first, then cross-chunk extractor edges. If multiple edges share the same `(type, sourceId, targetId)`, the pipeline **keeps one** edge: the instance with **higher `confidence`**; if confidence ties, the edge from `SourceAdapter.extractEdges` wins (deterministic tie-break).
- Q: What does “stable `Chunk.id`” mean for deduplication? → A: Matches `@wtfoc/common`: `Chunk.id` is the deterministic content id defined there (content-derived); provenance lives in `source`, `metadata`, etc. Re-ingest of the same normalized text yields the same `id` even if non-content metadata differs.
- Q: Should `@wtfoc/ingest` emit logs or metrics? → A: **No hard requirement** in this spec. The library stays side-effect-free aside from documented errors; optional debug/tracing is an implementation detail or belongs in `@wtfoc/cli` (deferred to implementation plan).
- Formal ambiguity scan (`/speckit.clarify` pass, 2026-03-23): no additional open decisions; scope boundaries, merge policy, GitHub MVP surface, chunk identity, and observability are covered by the bullets above.

## Definitions

- **Chunk** — unit of retrievable text with provenance (`Chunk` in `@wtfoc/common`); `id` is the deterministic content id (SHA-256 of content per schema docstring), not a random UUID.
- **Source adapter** — implementation of `SourceAdapter`: async iteration of `Chunk` plus `extractEdges(chunks)` for source-native edges.
- **Edge extractor** — implementation of `EdgeExtractor`: derives cross-artifact edges (e.g. issue references) from a batch of chunks, independent of a single source.
- **Built-in edge types** — `references`, `closes`, `changes` (string `type` on `Edge` for extensibility).
- **Default edge merge** — when both source-native and standalone extraction run, edges are merged per the Clarifications session (concatenate, then dedupe by triple with confidence and tie-break rules).

## User Scenarios & Testing

### User Story 1 — Ingest Slack export into chunks (Priority: P1)

An operator points the tool at a Slack JSON export and receives chunks with correct source metadata for downstream embedding.

**Why this priority**: Slack is a primary hackathon demo source.

**Independent Test**: Run ingest on a **synthetic** Slack export fixture; assert chunk count, `sourceType`, stable `id`, and no network I/O.

**Acceptance Scenarios**:

1. **Given** a valid Slack export fixture, **When** the Slack adapter runs to completion, **Then** every emitted `Chunk` has non-empty `content`, `id`, `sourceType`, `source`, and `metadata` suitable for tracing.
2. **Given** messages that exceed the configured maximum chunk size, **When** chunking runs, **Then** content is split with non-overlapping or overlapping windows per configuration and `chunkIndex` / `totalChunks` are consistent.
3. **Given** `AbortSignal` aborted before finish, **When** ingest is in progress, **Then** iteration stops and no further chunks are yielded.

---

### User Story 2 — Ingest GitHub issues and PRs via gh (Priority: P1)

An operator configures a GitHub repo and uses the GitHub adapter to produce chunks for issues and PRs available through the `gh` CLI.

**Why this priority**: GitHub is the other primary demo source and supplies rich cross-links for edges.

**Acceptance Scenarios**:

1. **Given** a repo identifier and local `gh` auth for tests (or a recorded fixture mode), **When** the GitHub adapter ingests, **Then** chunks reference stable identifiers such as `owner/repo#number` in `source`.
2. **Given** a PR with a description that references an issue, **When** edges are extracted, **Then** at least one `references` edge exists with `evidence` quoting the triggering text and `confidence` consistent with regex extraction policy.
3. **Given** no `gh` binary or auth where the test expects failure, **When** ingest runs, **Then** the error is typed with a stable `code` from `@wtfoc/common` (not a raw string throw).

---

### User Story 3 — Regex edge extraction for cross-links (Priority: P1)

A developer uses the default `EdgeExtractor` to recover `references`, `closes`, and `changes` edges from mixed-source chunks.

**Why this priority**: Edges are first-class in wtfoc; regex path is the MVP default per architecture.

**Acceptance Scenarios**:

1. **Given** chunks that mention `owner/repo#123`, **When** `EdgeExtractor.extract` runs, **Then** a `references` edge is produced with appropriate `sourceId`, `targetId`, and non-empty `evidence`.
2. **Given** a chunk containing closing keywords for an issue, **When** extracted, **Then** a `closes` edge is emitted with confidence appropriate to explicit keyword matches.
3. **Given** chunks with no link patterns, **When** extracted, **Then** the result is an empty array (no fabricated edges).

---

### User Story 4 — Chunk deduplication and stable IDs (Priority: P2)

A developer relies on `Chunk.id` as a deduplication key across overlapping ingest runs.

**Why this priority**: Prevents duplicate segments downstream and matches `@wtfoc/common` / SPEC.md identity rules.

**Acceptance Scenarios**:

1. **Given** identical normalized chunk text per the chunker, **When** the same logical document is chunked twice, **Then** emitted chunk `id` values are identical (per `Chunk` contract in `@wtfoc/common`).
2. **Given** different substantive content after chunking/normalization, **When** compared, **Then** `id` differs.

---

### User Story 5 — Register custom adapters and extractors (Priority: P2)

A developer supplies a custom `SourceAdapter` or `EdgeExtractor` without forking the package.

**Why this priority**: Credible exit at every seam.

**Acceptance Scenarios**:

1. **Given** a custom adapter implementing `SourceAdapter`, **When** registered with the ingest entry API, **Then** it is invoked the same as built-in adapters and respects `AbortSignal`.
2. **Given** a custom `EdgeExtractor` replacing the default, **When** cross-chunk extraction runs, **Then** edges from that stage come only from the custom extractor (source-native edges from `SourceAdapter.extractEdges` remain governed by the adapter).

### Edge Cases

- Empty export / zero messages → completed iteration with zero chunks; no throw.
- Malformed Slack JSON → typed parse error with stable `code`; no partial chunks.
- Extremely long single-line content → chunker still produces bounded-size chunks.
- Duplicate messages in export → dedup by stable `id` policy (documented; default dedup on `id`).
- Concurrent ingest calls on separate configs → no shared mutable global state in library code.

## Requirements

### Functional Requirements

- **FR-001**: Package MUST implement default **Slack JSON** `SourceAdapter` and default **GitHub** `SourceAdapter` using interfaces from `@wtfoc/common`.
- **FR-002**: All async ingest entry points MUST accept optional `AbortSignal` and respect cancellation.
- **FR-003**: Chunking MUST be configurable (e.g. max chunk length and overlap); defaults MUST be documented and covered by tests.
- **FR-004**: Every emitted `Chunk` MUST satisfy the `Chunk` contract: deterministic `id`, provenance fields, and `metadata` as string map per schema.
- **FR-005**: Default **regex-based** `EdgeExtractor` MUST emit edges for built-in types `references`, `closes`, and `changes` where patterns match; MUST NOT invent edges when there is no evidence.
- **FR-006**: `SourceAdapter.extractEdges` and standalone `EdgeExtractor.extract` MUST return `Edge[]` with `evidence` and `confidence` populated per `@wtfoc/common` conventions.
- **FR-007**: Unit tests MUST use **synthetic fixtures only** (no real customer data; no live Slack/GitHub in default test run).
- **FR-008**: Optional integration tests for GitHub MAY call `gh` when explicitly enabled by env flag; default CI MUST pass without them.
- **FR-009**: Errors MUST use typed error classes from `@wtfoc/common` with stable `code` values (no raw string throws).
- **FR-010**: When a pipeline runs both `SourceAdapter.extractEdges` and `EdgeExtractor.extract` on the same chunk batch, the combined `Edge[]` MUST follow the merge policy in Clarifications (concatenate order, dedupe by `(type, sourceId, targetId)`, confidence and tie-break).

### Key Entities

- **Chunk** — per `@wtfoc/common` (`id`, `content`, `sourceType`, `source`, optional `sourceUrl` / `timestamp`, chunking indices, `metadata`).
- **Edge** — per `@wtfoc/common` (`type`, `sourceId`, `targetType`, `targetId`, `evidence`, `confidence`).
- **SourceConfig** — `type` + `options` bag for adapter-specific paths, repo names, and limits.

## Success Criteria

### Measurable Outcomes

- **SC-001**: From a synthetic Slack export, ingest completes and yields at least one chunk with correct provenance fields in under 30 seconds on CI hardware (typical fixture size).
- **SC-002**: From synthetic GitHub-style content, default edge extraction produces expected `references` / `closes` edges for fixture cases with 100% agreement on golden assertions.
- **SC-003**: Default unit test suite requires no network access and completes successfully.
- **SC-004**: Custom adapter hook: swapping a mock `SourceAdapter` changes output without modifying package internals (black-box test).
- **SC-005**: Cancelling via `AbortSignal` stops iteration within bounded time without leaking listeners or hanging promises.

## Testing Strategy

- **Unit tests**: Chunking, Slack fixture parsing, GitHub text/fixture parsing, edge regex extraction, error codes. All offline.
- **Integration (optional)**: GitHub via `gh` behind env gate; documented in package README.
- **Contract tests**: Mock `SourceAdapter` / `EdgeExtractor` to verify interfaces remain sufficient for orchestration.

## Dependencies

- `@wtfoc/common` — `SourceAdapter`, `EdgeExtractor`, `Chunk`, `Edge`, `SourceConfig`, errors.
- **Conceptual**: [`001-store-backend`](../001-store-backend/spec.md) defines `Segment` / manifest shapes consumed later by CLI; ingest does not depend on `@wtfoc/store` at runtime unless a future orchestration API requires it—**peer** relationship only for workspace builds.

## Out of Scope

- Embedding, vector indices, search, and trace (`@wtfoc/search`).
- Blob upload, manifest `putHead`, segment persistence (`@wtfoc/store`) — except aligning field names with shared schemas when producing data for downstream steps.
- LLM-based or AST-based edge extraction (future extractors; seam remains pluggable).
- Web crawling (`filecoin-nova`), Jira, Discord, Linear, Confluence.
- OAuth flows or storing long-lived tokens in-repo; configuration MAY reference env vars consumed by `gh` or future adapters.
- Slack **webhooks** (live streaming) — see issue #2; this spec covers batch JSON export only.

## References

- [`SPEC.md`](../../../SPEC.md) — seams, ingest order, edges first-class.
- [`001-store-backend/spec.md`](../001-store-backend/spec.md) — segment and manifest context.
- [Issue #5](https://github.com/SgtPooki/wtfoc/issues/5) — tracking.
