# Feature Specification: CLI

**Feature Branch**: `004-cli`
**Created**: 2026-03-23
**Status**: Draft
**Package**: `@wtfoc/cli`

## Overview

Implement `@wtfoc/cli` — the CLI that composes store, ingest, and search into user-facing commands. Pluggable ingest via `wtfoc ingest <source-type>`.

## Commands

| Command | Description |
|---------|-------------|
| `wtfoc init <name> [--local\|--foc]` | Create a project |
| `wtfoc ingest <source-type> [args] --collection <name>` | Ingest from a source |
| `wtfoc trace <query> --collection <name>` | Evidence-backed cross-source trace |
| `wtfoc query <query> --collection <name>` | Semantic search |
| `wtfoc verify <id>` | Verify artifact exists on storage |
| `wtfoc status --collection <name>` | Show collection info |
| `wtfoc doctor` | Health check (storage, embedder, config) |

## User Scenarios & Testing

### User Story 1 — Init + ingest + trace end-to-end (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `wtfoc init myproject --local`, **Then** project config created, local storage ready.
2. **Given** `wtfoc ingest slack ./export.json --collection myproject`, **Then** chunks ingested, segment stored, manifest updated.
3. **Given** `wtfoc trace "upload failures" --collection myproject`, **Then** trace output with grouped results.
4. **Given** `--json` flag on any command, **Then** machine-readable JSON output to stdout.
5. **Given** `--quiet` flag, **Then** only errors to stderr.

---

### User Story 2 — Pluggable ingest sources (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `wtfoc ingest slack <file>`, **Then** Slack adapter is used.
2. **Given** `wtfoc ingest github <repo>`, **Then** GitHub adapter is used.
3. **Given** an unknown source type, **Then** helpful error listing available types.

---

### User Story 3 — Verify and status (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `wtfoc verify <id>`, **Then** confirms artifact exists (or reports not available if backend doesn't support verify).
2. **Given** `wtfoc status --collection myproject`, **Then** shows: source count, chunk count, segment count, last updated, storage type.
3. **Given** `wtfoc doctor`, **Then** checks: storage backend reachable, embedder model available, config valid.

## Requirements

- **FR-001**: Commander-based CLI with subcommands
- **FR-002**: stderr for logs, stdout for data
- **FR-003**: Exit codes: 0 success, 1 general, 2 usage, 3 storage, 4 conflict
- **FR-004**: `--json` and `--quiet` flags on all commands
- **FR-005**: Config precedence: flag > env > config file > default
- **FR-006**: Source types discovered dynamically from registered SourceAdapters

## Dependencies

- `@wtfoc/common`, `@wtfoc/store`, `@wtfoc/ingest`, `@wtfoc/search`
- `commander` — CLI framework
