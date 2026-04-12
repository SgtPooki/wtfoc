---
status: completed
---
# Improve default edge extraction beyond regex

**Increment**: 0051G-improve-default-edge-extraction-beyond-regex
**Type**: feature | **Priority**: P0 | **Labels**: core, P0
**Source**: GitHub #3

## Description

## Summary

The current spec lists "regex-based" as the default EdgeExtractor implementation. This is underwhelming and fragile — regex won't catch natural language references, implied connections, or non-standard formats.

## Context

From SPEC.md rule 2, EdgeExtractor is a pluggable seam. The built-in default should be better than regex while still being fast and local (no LLM API calls for default).

## Options to explore

1. **Heuristic + pattern matching** — more sophisticated than raw regex. Extract GitHub refs (`#123`, `owner/repo#456`, URLs), Slack message links, PR closing keywords, but also look at co-occurrence patterns (same entity mentioned in nearby chunks).
2. **Lightweight NLP** — use a small local model (compromise.js, wink-nlp) for entity extraction + relation detection. No API calls.
3. **LLM-based extraction** — use the local embedder or a small local model to classify relationships. More accurate but slower.
4. **Hybrid** — heuristic first pass (fast, high confidence), optional LLM second pass (slower, catches what heuristics miss).

## Acceptance Criteria

- [x] Default extractor catches GitHub issue/PR references across formats
- [x] Default extractor catches Slack message cross-references
- [x] Default extractor catches URL-based connections
- [x] Confidence scores reflect extraction method (1.0 for pattern match, <1.0 for heuristic/semantic)
- [x] No external API calls required for default extractor

## Priority

Medium — current regex approach works for the hackathon demo with curated data. This becomes important when ingesting real uncurated sources.

## User Stories

- **US-001**: As a user, I want improve default edge extraction beyond regex so that the system improves
  - **AC-US1-01**: [x] Implementation satisfies the issue requirements
  - **AC-US1-02**: [x] Tests pass for the new behavior

## Notes

Imported from GitHub issue #3 on 2026-04-12.
