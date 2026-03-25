# Tasks: .wtfoc.json Project Config

**Input**: Design documents from `/specs/118-project-config/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Organization**: Tasks grouped by user story. US4 (validation) and US5 (precedence) are cross-cutting properties implemented in the foundational phase with dedicated test coverage.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the new `@wtfoc/config` package and add shared types/errors to `@wtfoc/common`

- [x] T001 Add `packages/config` to pnpm-workspace.yaml and add project reference in tsconfig.json (root)
- [x] T002 Create `packages/config/package.json` with name `@wtfoc/config`, dependency on `@wtfoc/common` and `ignore`, `"test": "vitest run"` script, ESM config
- [x] T003 Create `packages/config/tsconfig.json` with project reference to `packages/common`, composite mode, outDir `dist`, rootDir `src`
- [x] T004 [P] Add config type interfaces (ProjectConfig, EmbedderConfig, ExtractorConfig, ResolvedEmbedderConfig, ResolvedExtractorConfig, ResolvedConfig, URL_SHORTCUTS, BUILTIN_IGNORE_PATTERNS) to `packages/common/src/config-types.ts` per contracts/config-types.ts
- [x] T005 [P] Add ConfigParseError (code: "CONFIG_PARSE", context: filePath + parseError) and ConfigValidationError (code: "CONFIG_VALIDATION", context: filePath + field + expected + got) to `packages/common/src/errors.ts`
- [x] T006 Export new config types and errors from `packages/common/src/index.ts`
- [x] T007 Create `packages/config/src/index.ts` with public API exports (loadProjectConfig, resolveConfig, resolveUrlShortcut, createIgnoreFilter)
- [x] T008 Run `pnpm install` to link the new package and verify `pnpm build` succeeds for `@wtfoc/common` and `@wtfoc/config`

**Checkpoint**: Package scaffold complete, types and errors available, workspace builds

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement all `@wtfoc/config` modules. This phase implements the core logic for US4 (validation) and US5 (precedence).

**CRITICAL**: No user story integration can begin until this phase is complete

### Tests (write first, verify they fail)

- [x] T009 [P] Write tests for shortcuts in `packages/config/src/shortcuts.test.ts` — known shortcuts resolve, unknown strings pass through, empty string passes through
- [x] T010 [P] Write tests for validator in `packages/config/src/validator.test.ts` — valid complete config, valid empty `{}`, valid partial config, invalid embedder.url type, invalid extractor.timeout type, missing url+model when extractor.enabled=true, embedder.url without model throws validation error (FR-015), unknown top-level key produces warning, invalid concurrency range
- [x] T011 [P] Write tests for ignore in `packages/config/src/ignore.test.ts` — built-in defaults always applied, user patterns merged additively, gitignore negation works, directory patterns with trailing `/`, empty user patterns still apply defaults
- [x] T012 [P] Write tests for loader in `packages/config/src/loader.test.ts` — file not found returns undefined, valid JSON parsed and validated, invalid JSON throws ConfigParseError with file path, validation error thrown with field details, empty file throws ConfigParseError
- [x] T013 Write tests for resolver in `packages/config/src/resolver.test.ts` — CLI overrides file, file overrides env, env overrides defaults, no sources yields defaults, URL shortcuts resolved in final output, custom non-shortcut URL passes through unchanged (FR-014), extractor defaults (enabled=false, timeout=20000, concurrency=4), WTFOC_OPENAI_API_KEY fallback for embedder key

### Implementation (make tests pass)

- [x] T014 [P] Implement `resolveUrlShortcut()` in `packages/config/src/shortcuts.ts` — look up URL_SHORTCUTS from `@wtfoc/common`, return input unchanged if not a shortcut
- [x] T015 [P] Implement `validateProjectConfig()` in `packages/config/src/validator.ts` — validate parsed JSON against ProjectConfig schema with typed errors: check top-level keys (warn on unknown via process.stderr, do not abort), check embedder section field types (url requires model per FR-015), check extractor section field types and conditional required (enabled=true requires url+model), check ignore is string array. Throw ConfigValidationError with field name, expected type, and actual value. Implements FR-009, FR-010, FR-011, FR-015
- [x] T016 [P] Implement `createIgnoreFilter()` in `packages/config/src/ignore.ts` — use `ignore` npm package, prepend BUILTIN_IGNORE_PATTERNS before user patterns, return filter function `(path: string) => boolean` that returns true for included files. Implements FR-005, FR-012
- [x] T017 Implement `loadProjectConfig()` in `packages/config/src/loader.ts` — read `.wtfoc.json` from given cwd (default process.cwd()) via readFileSync, return undefined if file not found, throw ConfigParseError on invalid JSON, call validateProjectConfig() on parsed result. Implements FR-001, FR-002
- [x] T018 Implement `resolveConfig()` in `packages/config/src/resolver.ts` — merge CLI flags > file config > env vars > defaults per ConfigSources interface from contracts/config-loader.ts. Read env vars (WTFOC_EMBEDDER_URL, WTFOC_EMBEDDER_MODEL, WTFOC_EMBEDDER_KEY, WTFOC_OPENAI_API_KEY, WTFOC_EXTRACTOR_URL, WTFOC_EXTRACTOR_MODEL, WTFOC_EXTRACTOR_API_KEY, WTFOC_EXTRACTOR_ENABLED, WTFOC_EXTRACTOR_TIMEOUT_MS, WTFOC_EXTRACTOR_MAX_CONCURRENCY). Apply resolveUrlShortcut() to final URL values. Defaults: extractor.enabled=false, extractor.timeout=20000, extractor.concurrency=4. Implements FR-006, FR-007, FR-008
- [x] T019 Verify `pnpm test` passes for `@wtfoc/config` and `pnpm build` succeeds

**Checkpoint**: All config modules implemented and tested. Validation (US4) and precedence (US5) logic complete.

---

## Phase 3: User Story 1 - Configure Embedding Endpoint (Priority: P1) MVP

**Goal**: CLI reads `.wtfoc.json` and uses embedder config (url, model, key) without requiring `--embedder-*` flags

**Independent Test**: Create `.wtfoc.json` with `{ "embedder": { "url": "lmstudio", "model": "nomic-embed-text" } }`, run `wtfoc ingest`, verify it uses the configured endpoint

- [ ] T020 [US1] Add `@wtfoc/config` as dependency in `packages/cli/package.json` and add project reference in `packages/cli/tsconfig.json`
- [ ] T021 [US1] Refactor `createEmbedder()` in `packages/cli/src/helpers.ts` to accept an optional ResolvedEmbedderConfig parameter — when provided, use its url/model/key instead of reading from CLI opts directly. Remove the inline `urlShortcuts` map (use resolveUrlShortcut from `@wtfoc/config` instead). Keep backward compatibility: if no ResolvedEmbedderConfig is passed, fall back to existing CLI opts behavior
- [ ] T022 [US1] Wire config loading into `packages/cli/src/cli.ts` — call `loadProjectConfig()` at startup (before command dispatch), call `resolveConfig()` with CLI opts + file config, pass resolved embedder config to `createEmbedder()`. Handle ConfigParseError and ConfigValidationError by printing the error message and exiting with code 2
- [ ] T023 [US1] Write test for CLI embedder config integration in `packages/cli/src/helpers.test.ts` — createEmbedder with ResolvedEmbedderConfig uses config values, createEmbedder without config uses existing CLI opts behavior (backwards compatible)

**Checkpoint**: `wtfoc ingest` reads embedder config from `.wtfoc.json` with full precedence. Existing CLI flag behavior preserved.

---

## Phase 4: User Story 2 - Configure LLM Edge Extraction (Priority: P1)

**Goal**: CLI reads `.wtfoc.json` extractor config and passes it to the extract-edges command

**Independent Test**: Create `.wtfoc.json` with `{ "extractor": { "enabled": true, "url": "ollama", "model": "llama3" } }`, run `wtfoc extract-edges`, verify it uses the configured LLM endpoint

**Note**: The extract-edges CLI command (PR #145) and LLM extractor (PR #138) may not be on main yet. This phase wires config into whatever extractor integration point exists. If the commands haven't landed, create the config wiring point and leave a TODO for the integration.

- [ ] T024 [US2] Ensure resolved extractor config (enabled, url, model, apiKey, timeout, concurrency) is available from the config loaded in `packages/cli/src/cli.ts` (already loaded in T022) and passed to commands that use LLM extraction
- [ ] T025 [US2] Wire resolved extractor config into the extract-edges command entry point (if it exists in `packages/cli/src/commands/`) or document the integration point for when PR #145 lands. The command should read extractor.enabled to decide whether to run LLM extraction, and use extractor.url/model/apiKey/timeout/concurrency for the LLM client

**Checkpoint**: Extractor config flows from `.wtfoc.json` through CLI to LLM extraction. If extract-edges hasn't landed, the wiring point is ready.

---

## Phase 5: User Story 3 - Ignore Files During Ingest (Priority: P2)

**Goal**: Ingest pipeline skips files matching `.wtfoc.json` ignore patterns (additive with built-in defaults)

**Independent Test**: Create `.wtfoc.json` with `{ "ignore": ["*.log", "dist/**"] }`, run `wtfoc ingest` on a directory with .log files and dist/, verify they are skipped

- [ ] T026 [US3] Add `@wtfoc/config` as dependency in `packages/ingest/package.json` and add project reference in `packages/ingest/tsconfig.json`
- [ ] T027 [US3] Modify `walkFiles()` in `packages/ingest/src/adapters/repo/chunking.ts` to accept an optional ignore filter parameter `(path: string) => boolean`. When provided, apply it to each file path (relative to the walk root) alongside existing excludeDirs and includeExts checks. Files rejected by the filter are skipped before reading
- [ ] T028 [US3] Modify the RepoAdapter in `packages/ingest/src/adapters/repo/adapter.ts` to accept an optional ignore filter and pass it through to `walkFiles()`
- [ ] T029 [US3] Wire ignore patterns from resolved config into the ingest command in `packages/cli/src/commands/ingest.ts` — call `createIgnoreFilter(resolvedConfig.ignore)` and pass the filter to the RepoAdapter. Log how many files were skipped by ignore patterns
- [ ] T030 [US3] Write test for walkFiles with ignore filter in `packages/ingest/src/adapters/repo/chunking.test.ts` — verify filter is applied, verify files matching ignore patterns are excluded, verify non-matching files are included

**Checkpoint**: `wtfoc ingest` skips files matching ignore patterns from `.wtfoc.json`. Built-in defaults (.git, node_modules) always apply.

---

## Phase 6: User Story 6 - MCP Server Reads Config (Priority: P3)

**Goal**: MCP server reads `.wtfoc.json` and uses embedder config without requiring `WTFOC_EMBEDDER_*` env vars

**Independent Test**: Create `.wtfoc.json` with embedder config, start MCP server in that directory, verify it uses the configured embedder

- [ ] T031 [US6] Add `@wtfoc/config` as dependency in `packages/mcp-server/package.json` and add project reference in `packages/mcp-server/tsconfig.json`
- [ ] T032 [US6] Refactor `createEmbedder()` in `packages/mcp-server/src/helpers.ts` to accept an optional ResolvedEmbedderConfig — when provided, use its url/model/key. Remove inline `urlShortcuts` map (use resolveUrlShortcut from `@wtfoc/config`). Keep backward compatibility with env-var-only usage
- [ ] T033 [US6] Wire config loading into `packages/mcp-server/src/index.ts` — call `loadProjectConfig()` and `resolveConfig()` (with no CLI source, just file + env), pass resolved embedder config to `createEmbedder()`. Handle errors by writing to stderr and falling back to env-var behavior

**Checkpoint**: MCP server uses `.wtfoc.json` for embedder config. Env vars still work as fallback.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Ensure quality across all integrations

- [ ] T034 Run `pnpm lint:fix` across workspace to ensure all new code passes biome
- [ ] T035 Run `pnpm test` from root to verify all packages pass (no regressions — SC-002)
- [ ] T036 Run `pnpm build` to verify TypeScript compilation succeeds with new project references
- [ ] T037 Manual smoke test: create `.wtfoc.json` per quickstart.md scenarios and verify end-to-end behavior (config loading, precedence, validation errors, unknown key warnings, ignore patterns)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — MVP target
- **US2 (Phase 4)**: Depends on Foundational + US1 (shares CLI config wiring from T022)
- **US3 (Phase 5)**: Depends on Foundational only — can run in parallel with US1/US2
- **US6 (Phase 6)**: Depends on Foundational only — can run in parallel with US1/US2/US3
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — No dependencies on other stories
- **US2 (P1)**: Depends on US1 (reuses CLI config wiring point from T022)
- **US3 (P2)**: Can start after Phase 2 — Independent of US1/US2
- **US4 (P2)**: Implemented in Phase 2 (validator.ts + tests) — No separate phase
- **US5 (P2)**: Implemented in Phase 2 (resolver.ts + tests) — No separate phase
- **US6 (P3)**: Can start after Phase 2 — Independent of other stories

### Parallel Opportunities

```
Phase 2 complete
    ├── US1 (Phase 3) ──→ US2 (Phase 4)  [sequential: US2 reuses US1's CLI wiring]
    ├── US3 (Phase 5)                      [parallel with US1/US2]
    └── US6 (Phase 6)                      [parallel with US1/US2/US3]
```

Within Phase 2, T009/T010/T011 can all run in parallel (different files). T014-T018 (tests) can all run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (includes US4 validation + US5 precedence logic)
3. Complete Phase 3: US1 — Configure Embedding Endpoint
4. **STOP and VALIDATE**: Test `wtfoc ingest` with `.wtfoc.json` embedder config
5. This alone eliminates the top pain point (3+ CLI flags per invocation)

### Incremental Delivery

1. Setup + Foundational → Config package ready
2. US1 → Embedding config via `.wtfoc.json` (MVP!)
3. US2 → Extractor config via `.wtfoc.json`
4. US3 → Ignore patterns (fixes #124)
5. US6 → MCP server reads config (unblocks #144)
6. Each story adds value without breaking previous stories

---

## Notes

- US4 (validation) and US5 (precedence) have no separate phases — their implementation lives in Phase 2 (validator.ts, resolver.ts) with dedicated test files
- US2 depends on PR #138/#145 for full integration — if those haven't landed on main, create the wiring point and document the integration
- The `ignore` npm package is the only new external dependency
- URL shortcuts are consolidated from duplicated code in CLI + MCP helpers into `@wtfoc/config`
- Commit after each task or logical group, scoped by package: `feat(config):`, `feat(cli):`, `feat(ingest):`, `feat(mcp-server):`
