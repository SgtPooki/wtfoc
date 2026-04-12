# Research: Evaluate GitNexus as a code intelligence seam alongside existing tree-sitter implementation

**Increment**: 0003G-evaluate-gitnexus-as-a-code-intelligence-seam-alon
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #201

## Description

## Context

wtfoc already has a tree-sitter edge extractor (`packages/ingest/src/edges/tree-sitter.ts`) that delegates to an HTTP sidecar for AST parsing. It works but is limited — it's a sidecar dependency, supports a fixed set of languages, and doesn't do AST-aware chunking (only edge extraction).

[GitNexus](https://github.com/abhigyanpatwari/GitNexus) (`npm: gitnexus`) is an MIT-licensed TypeScript library that builds full code knowledge graphs using tree-sitter. It extracts functions, classes, imports, call chains, and symbol resolution across 8 languages (TS, JS, Python, Java, Go, Rust, PHP, Ruby). It has 1.2K+ stars and an MCP server.

## Proposal

Evaluate GitNexus as an **additional code intelligence seam** — not a replacement for our existing tree-sitter implementation, but a pluggable alternative that can be used when available.

The `EdgeExtractor` interface already supports this pattern: register multiple extractors, merge results with confidence weighting. GitNexus would be another extractor option alongside the existing tree-sitter sidecar.

## What to evaluate

1. **Can GitNexus be used as a library?** It's published on npm — can we import its parsing/graph-building pipeline directly, or is it CLI/browser-only?
2. **Does its output map to wtfoc's `Edge` schema?** What edge types does it produce? Can they be converted to wtfoc edges with evidence + confidence?
3. **Can it inform AST-aware chunking?** GitNexus knows function/class boundaries — could we use that for P2-2 (tree-sitter chunking) without building our own AST chunker?
4. **What does it NOT do that we need?** Our tree-sitter sidecar may handle languages or edge types that GitNexus doesn't. We need both to coexist.
5. **Performance and dependency weight** — Is it reasonable to include as a dependency in `@wtfoc/ingest`?

## Related

- Existing tree-sitter extractor: `packages/ingest/src/edges/tree-sitter.ts`
- AST-aware chunking: #134
- Epic: #200 (P2-2, P2-3)
- [Codebase-Memory](https://arxiv.org/html/2603.27277v1) — another tree-sitter-based code graph tool worth comparing (66 language support)
- [tree-sitter-graph](https://github.com/tree-sitter/tree-sitter-graph) — official tree-sitter graph DSL

## User Stories

- **US-001**: As a user, I want evaluate gitnexus as a code intelligence seam alon so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #201 on 2026-04-12.
