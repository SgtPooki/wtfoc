# Detect stale documentation and implemented features missing from docs

**Increment**: 0037G-detect-stale-documentation-and-implemented-feature
**Type**: feature | **Priority**: P2 | **Labels**: scope, P2
**Source**: GitHub #58

## Description

## Problem

Documentation drift is a persistent problem across codebases. Teams often have both of these failure modes at once:

- docs describe behavior that is outdated or no longer true
- implemented features or flags exist in code but are not documented anywhere useful

This is hard to detect manually, especially across multiple repos, packages, and docs surfaces.

## Goal

Enable `wtfoc` to identify likely documentation gaps and drift by comparing documentation artifacts against code, issues, PRs, and other evidence.

The output should help users answer questions like:

- what docs are likely out of date
- what features appear implemented but undocumented
- what docs sections should be updated first
- what code or PR evidence supports that conclusion

## Why this matters

This is useful for:

- maintainers trying to keep docs accurate
- DX teams looking for adoption blockers
- agents preparing documentation updates
- reviewers checking whether a change shipped without docs coverage

## Desired outcome

A user should be able to ask something like:

- what CLI flags are implemented but not documented
- what docs around upload cancellation are stale
- what features changed recently without matching docs updates

And get back something like:

- likely undocumented feature: `--foo-bar`
- implementation evidence: PR X, file Y, tests Z
- missing from: README section A, package docs B
- likely stale doc: page C references old behavior contradicted by PR D and current code in file E
- confidence: medium

## Design considerations

### 1. Detect implemented but undocumented behavior

We likely need heuristics that compare:

- CLI commands/flags
- exported APIs
- config fields
- behavior implied by tests or changelog entries

against:

- README files
- package docs
- demo guides
- reference docs

### 2. Detect stale documentation

We should identify docs claims that are contradicted by newer code, tests, issues, or PRs.

### 3. Keep evidence first-class

The system should cite the actual code, PR, or test evidence that makes a doc look stale or missing.

### 4. Support prioritization

The output should help users prioritize:

- user-facing gaps with the highest impact
- recently changed behavior lacking docs coverage
- docs most likely to mislead users today

## Proposed plan

1. Define the output shape for documentation drift analysis.
2. Identify what signals already exist in `wtfoc` ingest/search/trace data.
3. Prototype heuristics for implemented-but-undocumented detection.
4. Prototype heuristics for stale-doc detection.
5. Validate against real repo docs and code changes.
6. Decide whether this belongs under `trace`, a new command, or a higher-level analysis mode.

## Open questions

- How much of this can be done generically vs requiring adapter-specific logic?
- What evidence threshold should be required before calling a doc stale?
- Should tests and changelog entries be treated as first-class signals for documentation coverage?
- How do we separate user-facing docs gaps from internal-only gaps?

## Acceptance criteria

- The system can identify likely stale docs with supporting evidence
- The system can identify likely implemented-but-undocumented features with supporting evidence
- Results are explicit about uncertainty and prioritize the highest-value gaps
- The output is actionable enough for a human or agent to plan a docs update


## User Stories

- **US-001**: As a user, I want detect stale documentation and implemented feature so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #58 on 2026-04-12.
