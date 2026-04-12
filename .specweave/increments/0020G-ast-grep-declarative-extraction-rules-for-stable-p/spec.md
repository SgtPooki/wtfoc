# [feat] ast-grep declarative extraction rules for stable patterns

**Increment**: 0020G-ast-grep-declarative-extraction-rules-for-stable-p
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #135

## Description

## Summary

Investigate using `@ast-grep/napi` declarative rule engine for code edge extraction when extraction patterns stabilize across languages.

## Context

From cross-review (Codex + Cursor, 2026-03-25): ast-grep uses tree-sitter internally but provides a simpler declarative API. Good for stable per-language patterns with less boilerplate than raw tree-sitter traversal. Ships prebuilt binaries for many platforms.

## When to Consider
- After the initial regex + oxc-parser + ast-grep code extractors ship and patterns are validated
- When extraction rules are stable enough to express declaratively
- As a potential simplification/replacement for custom AST walking code

## Related
- #3 (edge extraction beyond regex — parent feature)

## User Stories

- **US-001**: As a user, I want ast grep declarative extraction rules for stable p so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #135 on 2026-04-12.
