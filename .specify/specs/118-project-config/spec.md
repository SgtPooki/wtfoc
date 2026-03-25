# Feature Specification: .wtfoc.json Project Config

**Feature Branch**: `118-project-config`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Issue #39: .wtfoc.json project config file — project-level configuration for embedding, edge extraction, and ignore patterns"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Embedding Endpoint (Priority: P1)

A user has a local LM Studio instance or a remote vLLM cluster and wants their project to use it for embeddings without passing CLI flags every time. They create a `.wtfoc.json` file in their project root specifying the embedding URL and model. All wtfoc commands (CLI, MCP server) automatically pick up this configuration.

**Why this priority**: Embedding is the core operation — every ingest and query uses it. Removing the need for CLI flags on every invocation is the highest-friction pain point.

**Independent Test**: Can be fully tested by creating a `.wtfoc.json` with embedding config, running `wtfoc ingest`, and verifying it uses the configured endpoint without any `--embedder-*` flags.

**Acceptance Scenarios**:

1. **Given** a project with `.wtfoc.json` containing `{ "embedder": { "url": "lmstudio", "model": "nomic-embed-text" } }`, **When** the user runs `wtfoc ingest`, **Then** the system uses `http://localhost:1234/v1` with model `nomic-embed-text` for embedding.
2. **Given** a project with `.wtfoc.json` containing `{ "embedder": { "url": "http://vllm.k8s.local:8000/v1", "model": "nomic-embed-text" } }`, **When** the user runs `wtfoc ingest`, **Then** the system connects to the specified vLLM endpoint.
3. **Given** a project with `.wtfoc.json` with embedding config AND the user passes `--embedder-url ollama`, **When** the user runs `wtfoc ingest`, **Then** the CLI flag takes precedence over the config file.

---

### User Story 2 - Configure LLM Edge Extraction (Priority: P1)

A user wants to enable LLM-powered edge extraction for their project using their homelab vLLM cluster. They add edge extraction settings to `.wtfoc.json` specifying the LLM endpoint, model, and tuning parameters. The extract-edges command and ingest pipeline use these settings automatically.

**Why this priority**: LLM extraction is disabled by default and requires multiple flags to enable. Config file support is essential to make it practical for repeated use.

**Independent Test**: Can be fully tested by creating a `.wtfoc.json` with edge extraction config, running `wtfoc extract-edges`, and verifying it uses the configured LLM endpoint.

**Acceptance Scenarios**:

1. **Given** a `.wtfoc.json` with `{ "extractor": { "enabled": true, "url": "http://vllm.k8s.local:8000/v1", "model": "Qwen3-32B-AWQ" } }`, **When** the user runs `wtfoc extract-edges`, **Then** the system uses the configured LLM endpoint with default timeout and concurrency.
2. **Given** a `.wtfoc.json` with extraction disabled (`"enabled": false`), **When** the user runs `wtfoc extract-edges`, **Then** the system skips LLM extraction.
3. **Given** a `.wtfoc.json` with extractor config AND the user passes `--extractor-model different-model`, **When** the user runs `wtfoc extract-edges`, **Then** the CLI flag overrides the config file model.
4. **Given** a `.wtfoc.json` with `{ "extractor": { "enabled": true, "url": "ollama", "model": "llama3", "timeout": 30000, "concurrency": 2 } }`, **When** the user runs `wtfoc extract-edges`, **Then** the URL shortcut resolves and the custom timeout/concurrency values are used.

---

### User Story 3 - Ignore Files During Ingest (Priority: P2)

A user's project has large generated files, vendor directories, and binary artifacts that should never be ingested. They add ignore patterns to `.wtfoc.json` so these files are automatically skipped during ingest without needing to remember CLI flags.

**Why this priority**: Highest-friction UX issue from dogfooding (issue #124). Consolidating with config file avoids a separate `.wtfocignore` file for v1.

**Independent Test**: Can be fully tested by adding ignore patterns, running `wtfoc ingest`, and verifying matching files are skipped.

**Acceptance Scenarios**:

1. **Given** a `.wtfoc.json` with `{ "ignore": ["node_modules/**", "*.min.js", "dist/**"] }`, **When** the user runs `wtfoc ingest`, **Then** files matching those patterns are skipped.
2. **Given** a `.wtfoc.json` with ignore patterns, **When** the user ingests a directory containing both matching and non-matching files, **Then** only non-matching files are ingested.
3. **Given** no `.wtfoc.json` file, **When** the user runs `wtfoc ingest`, **Then** the system uses sensible built-in defaults (e.g., skip `.git`, `node_modules`).

---

### User Story 4 - Config Validation and Error Reporting (Priority: P2)

A user makes a typo in their `.wtfoc.json` (invalid JSON, unknown field, wrong type). The system provides a clear, actionable error message pointing to the problem rather than failing silently or crashing.

**Why this priority**: Config files are error-prone. Clear validation prevents frustrating debugging sessions.

**Independent Test**: Can be fully tested by creating malformed config files and verifying the error messages are specific and actionable.

**Acceptance Scenarios**:

1. **Given** a `.wtfoc.json` with invalid JSON syntax, **When** any wtfoc command runs, **Then** the system reports a parse error with the file path and a description of the syntax issue.
2. **Given** a `.wtfoc.json` with `{ "embedder": { "url": 123 } }` (wrong type), **When** any wtfoc command runs, **Then** the system reports which field has the wrong type and what type is expected.
3. **Given** a `.wtfoc.json` with `{ "enbedder": { ... } }` (typo in section name), **When** any wtfoc command runs, **Then** the system warns about the unrecognized key (possible typo).

---

### User Story 5 - Precedence: CLI > Config > Env > Defaults (Priority: P2)

A user has a `.wtfoc.json` with team defaults but needs to override a setting for a one-off run. CLI flags always win. When no config file exists, env vars and built-in defaults still work as they do today.

**Why this priority**: Precedence rules ensure backwards compatibility and flexibility. Without clear precedence, config file introduction could break existing workflows.

**Independent Test**: Can be fully tested by setting values at multiple precedence levels and verifying the correct one wins.

**Acceptance Scenarios**:

1. **Given** `WTFOC_EMBEDDER_URL=ollama` is set AND `.wtfoc.json` has `embedder.url = "lmstudio"` AND the user passes `--embedder-url http://custom:8000/v1`, **When** the user runs a command, **Then** the CLI flag value (`http://custom:8000/v1`) is used.
2. **Given** `WTFOC_EMBEDDER_URL=ollama` is set AND `.wtfoc.json` has `embedder.url = "lmstudio"` AND no CLI flag, **When** the user runs a command, **Then** the config file value (`lmstudio` → `http://localhost:1234/v1`) is used.
3. **Given** no `.wtfoc.json` AND `WTFOC_EMBEDDER_URL=ollama`, **When** the user runs a command, **Then** the env var value is used.
4. **Given** no `.wtfoc.json` AND no env vars AND no CLI flags, **When** the user runs a command, **Then** built-in defaults are used (local transformers.js embedder).

---

### User Story 6 - MCP Server Reads Config (Priority: P3)

The MCP server (used by IDE integrations) reads `.wtfoc.json` from the project root so that IDE-based queries use the same embedding endpoint configured for the project, without requiring separate env var setup.

**Why this priority**: Unblocks #144 (wire LLM config into MCP). Important but lower priority than CLI integration since MCP currently works via env vars.

**Independent Test**: Can be fully tested by creating a `.wtfoc.json`, starting the MCP server in that project, and verifying it uses the configured embedder.

**Acceptance Scenarios**:

1. **Given** a project with `.wtfoc.json` containing embedding config, **When** the MCP server starts in that project directory, **Then** it uses the configured embedder instead of requiring `WTFOC_EMBEDDER_*` env vars.
2. **Given** a project with `.wtfoc.json` AND `WTFOC_EMBEDDER_*` env vars set, **When** the MCP server starts, **Then** the config file takes precedence over env vars (but env vars still serve as fallback).

---

### Edge Cases

- What happens when `.wtfoc.json` exists but is an empty file? System reports a JSON parse error (empty string is not valid JSON).
- What happens when `.wtfoc.json` exists but is empty `{}`? System treats it as valid config with no overrides, uses defaults for everything.
- What happens when the user specifies `extractor.enabled: true` but omits `url` and `model`? System reports a validation error: URL and model are required when extraction is enabled.
- What happens when the config file is in a subdirectory, not the project root? System only looks for `.wtfoc.json` in the current working directory (project root). Subdirectory configs are not discovered.
- What happens when a URL shortcut is used but the local server is not running? System proceeds with the resolved URL; the connection error surfaces naturally when the endpoint is contacted.
- What happens when ignore patterns match all files in the source? System ingests zero files and reports that all files were skipped by ignore patterns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST look for a `.wtfoc.json` file in the current working directory when any command starts.
- **FR-002**: System MUST parse the config file as JSON and validate it against the expected schema.
- **FR-003**: System MUST support an `embedder` section with fields: `url` (string), `model` (string), `key` (string, optional).
- **FR-004**: System MUST support an `extractor` section with fields: `enabled` (boolean), `url` (string), `model` (string), `apiKey` (string, optional), `timeout` (number, milliseconds), `concurrency` (number).
- **FR-005**: System MUST support an `ignore` section as an array of `.gitignore`-style pattern strings for file exclusion during ingest, including negation (`!`), directory markers (trailing `/`), and anchoring. Pattern matching MUST use an established library.
- **FR-006**: System MUST resolve URL shortcuts in config file values: `"lmstudio"` → `http://localhost:1234/v1`, `"ollama"` → `http://localhost:11434/v1`.
- **FR-007**: System MUST apply precedence order: CLI flags > `.wtfoc.json` > environment variables > built-in defaults.
- **FR-008**: System MUST continue to function with all existing defaults when no `.wtfoc.json` file is present (backwards compatible).
- **FR-009**: System MUST report clear validation errors when the config file contains invalid JSON, wrong types, or structurally invalid values. The command MUST abort (fail fast) on any validation error — partial config application is not allowed.
- **FR-010**: System MUST warn (not error) when unrecognized top-level keys are present in the config, to catch typos. Warnings are written to stderr and do not trigger the fail-fast abort — only structural validation errors abort.
- **FR-011**: System MUST validate that when `extractor.enabled` is `true`, both `url` and `model` are also provided.
- **FR-012**: System MUST apply ignore patterns during ingest to skip matching files before chunking. User-specified patterns are additive — they merge with built-in defaults (`.git`, `node_modules`), which always apply.
- **FR-013**: System MUST make the resolved configuration available to all consumers (CLI commands, MCP server) through a shared config-loading mechanism.
- **FR-014**: System MUST support any OpenAI-compatible endpoint URL (not just shortcuts).
- **FR-015**: System MUST validate that when `embedder.url` is set, `embedder.model` is also provided — the system cannot guess which model a server has loaded.

### Key Entities

- **ProjectConfig**: The root configuration object loaded from `.wtfoc.json`. Contains optional sections for embedder, extractor, and ignore patterns.
- **EmbedderConfig**: Endpoint configuration for the embedding service (url, model, key).
- **ExtractorConfig**: LLM endpoint configuration for edge extraction (enabled flag, url, model, apiKey, timeout, concurrency).
- **ResolvedConfig**: The final merged configuration after applying precedence rules across all sources (CLI, file, env, defaults).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can configure embedding and edge extraction endpoints in under 1 minute by creating a single config file, eliminating the need to pass 3+ CLI flags on every command invocation.
- **SC-002**: All existing commands and workflows continue to work identically when no `.wtfoc.json` is present (zero regressions).
- **SC-003**: Config validation errors are specific enough that users can fix the problem without consulting documentation — each error message names the field, the expected type/value, and what was found.
- **SC-004**: Ignore patterns reduce ingested file count by filtering unwanted files, with the system reporting how many files were skipped.
- **SC-005**: The MCP server uses the same config mechanism, so IDE users and CLI users share one source of truth for project settings.

## Clarifications

### Session 2026-03-25

- Q: Should config section names match CLI/env naming (`embedder`/`extractor`) or use concept names (`embedding`/`edgeExtraction`)? → A: Match CLI naming — use `"embedder"` and `"extractor"` sections.
- Q: When config has a mix of valid and invalid sections, should the system partially apply or abort? → A: Fail fast — abort the command on any validation error in the config file.
- Q: What matching standard should ignore patterns follow? → A: `.gitignore`-style semantics (negation, anchoring, directory markers), using an existing library — not hand-rolled.
- Q: When user specifies ignore patterns, do they replace or merge with built-in defaults? → A: Additive — user patterns merge with built-in defaults (`.git`, `node_modules` always skipped).

## Assumptions

- The config file name is `.wtfoc.json` (dot-prefixed, hidden file). This matches conventions like `.eslintrc.json`, `.prettierrc`.
- Config file discovery searches only the current working directory, not parent directories. Recursive upward search may be added later.
- URL shortcuts are limited to `lmstudio` and `ollama` in v1, matching the existing CLI behavior.
- Edge extraction defaults: `enabled: false`, `timeout: 20000`, `concurrency: 4` (matching the existing spec in the 117 feature).
- Default ignore patterns (when no config is present) include at minimum `.git` and `node_modules`.
- Per-user config tied to wallet identity (#75) is noted as future work and will not be implemented in this feature.

## Future Considerations *(not in scope)*

- **Per-user config (#75)**: Config sections tied to wallet/DID identity for multi-user scenarios.
- **Config inheritance**: Loading config from parent directories or a global `~/.wtfoc/config.json`.
- **Standalone `.wtfocignore` file**: If ignore patterns grow complex, a dedicated file (like `.gitignore`) could supplement the inline `ignore` array.
- **Config `init` command**: Interactive scaffolding to generate a `.wtfoc.json` with sensible defaults.
- **Schema versioning**: A `version` field to handle breaking config format changes.
