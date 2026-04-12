# feat(ingest): add arXiv papers source adapter

**Increment**: 0021G-ingest-add-arxiv-papers-source-adapter
**Type**: feature | **Priority**: P3 | **Labels**: enhancement, scope, P3
**Source**: GitHub #125

## Description

## Summary
Add a first-class `arxiv` source adapter so users can ingest research papers into a collection alongside repos, docs, GitHub discussions, and other sources.

## Why
Dogfooding and product review both point to a clear user story: people want to analyze their own repo in the context of adjacent products, features, and research. `wtfoc` already supports mixed-source collections and cross-source trace, but research papers are still a gap. A dedicated arXiv adapter would make papers a normal part of the evidence graph instead of an ad hoc website crawl.

## User story
As a user analyzing a repo or product area,
I want to ingest relevant arXiv papers into the same collection as code, docs, issues, and discussions,
so an LLM can compare implementation details, feature claims, and research ideas across sources.

## Scope
- Add `wtfoc ingest arxiv <query-or-id> -c <collection>`
- Support both direct paper IDs and search queries
- Ingest paper metadata: title, authors, abstract, categories, published/updated timestamps, canonical URL
- Prefer structured text sources when available; fall back cleanly if PDF/text extraction is limited
- Emit chunks with a dedicated source type such as `paper-abstract`, `paper-section`, or similar
- Extract explicit references where feasible:
  - arXiv IDs / URLs
  - GitHub repo URLs mentioned in paper metadata or abstract text
  - dataset / project URLs when detectable
- Preserve evidence metadata for downstream trace and comparison

## Notes
This should fit the existing `SourceAdapter` seam and mixed-source collection model already used by `repo`, `github`, `website`, `hackernews`, `slack`, and `discord` ingest.

Potential follow-ups that should stay out of the first issue unless needed:
- General paper adapters beyond arXiv
- Citation graph enrichment from external APIs
- PDF layout-aware parsing
- LLM-based extraction of claims, methods, benchmarks, and results


## User Stories

- **US-001**: As a user, I want ingest add arxiv papers source adapter so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #125 on 2026-04-12.
