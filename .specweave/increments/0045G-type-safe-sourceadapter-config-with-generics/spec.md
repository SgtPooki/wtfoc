# [refactor] Type-safe SourceAdapter config with generics

**Increment**: 0045G-type-safe-sourceadapter-config-with-generics
**Type**: feature | **Priority**: P2 | **Labels**: implementation
**Source**: GitHub #37

## Description

## Problem

`SourceConfig.options` is `Record<string, unknown>`, requiring adapters to manually extract and cast properties. This is fragile and loses type safety.

## Proposed Solution

Make `SourceAdapter` generic over its config type:

```typescript
interface SourceAdapter<TConfig = Record<string, unknown>> {
  readonly sourceType: string;
  ingest(config: TConfig, signal?: AbortSignal): AsyncIterable<Chunk>;
  extractEdges(chunks: Chunk[]): Edge[];
}

// Each adapter is fully typed
class RepoAdapter implements SourceAdapter<RepoAdapterConfig> {
  async *ingest(config: RepoAdapterConfig) { ... }
}
```

The CLI discovers adapters and handles the untyped → typed boundary at the edge (command parsing → adapter config).

## Why not now

Changing `@wtfoc/common` interfaces is a breaking change per SPEC.md rule 9. For hackathon MVP, explicit property access works. Clean up post-hackathon.

## User Stories

- **US-001**: As a user, I want type safe sourceadapter config with generics so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #37 on 2026-04-12.
