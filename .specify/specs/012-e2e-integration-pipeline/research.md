# Research: E2E Integration Pipeline

## Decision 1: Mock embedder strategy

**Decision**: Use a deterministic mock embedder that hashes content to produce fixed-dimension Float32Array vectors.

**Rationale**: Real embedders (TransformersEmbedder, OpenAI) require model downloads or network calls, violating FR-002. A content-hash-based mock produces consistent vectors so query ranking is reproducible across runs.

**Alternatives considered**:
- Zero vectors: would make all chunks equidistant, breaking ranking tests
- Random vectors: non-deterministic, tests could flake
- Pre-computed fixture vectors: harder to maintain, couples to specific content

## Decision 2: Test file location

**Decision**: Place the test at `packages/store/src/e2e-pipeline.test.ts`.

**Rationale**: `@wtfoc/store` is the central package — it depends on `@wtfoc/common` and has peer deps on ingest/search concepts. The test file follows `packages/*/src/**/*.test.ts` required by the root vitest config. Store already has test infrastructure (test-helpers.ts, temp dir patterns).

**Alternatives considered**:
- `packages/cli/src/`: CLI tests focus on command parsing, not pipeline logic
- Root `tests/` directory: not discovered by vitest config
- New `packages/integration/` package: over-engineering for one test file

## Decision 3: Synthetic fixture design

**Decision**: Use inline markdown strings with known cross-references (e.g., "Refs #123") as test fixtures. No external fixture files.

**Rationale**: Inline fixtures are self-contained, readable, and don't require file I/O setup. The chunker accepts raw markdown strings. Cross-references are simple patterns the RegexEdgeExtractor already handles.

**Alternatives considered**:
- External fixture files in `fixtures/`: adds complexity for a single test
- Real repo data: violates "synthetic only" constraint
