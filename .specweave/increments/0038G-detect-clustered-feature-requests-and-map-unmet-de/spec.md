# Detect clustered feature requests and map unmet demand to likely code surfaces

**Increment**: 0038G-detect-clustered-feature-requests-and-map-unmet-de
**Type**: feature | **Priority**: P3 | **Labels**: scope, P3
**Source**: GitHub #57

## Description

## Problem

Across issues, comments, discussions, and other user feedback, the same request or complaint often appears multiple times in different wording. Today, that signal is easy to miss unless someone manually reads across repos and artifacts.

For `wtfoc`, a valuable user story is not just tracing a single bug or incident, but discovering repeated unmet demand:

- common requests for a feature
- recurring complaints about a gap or workflow pain
- clusters of user feedback that have no corresponding PR or implementation yet
- likely code areas and repos implicated if the team decides to act

## Goal

Enable `wtfoc` to surface common feature requests or gaps across artifacts, summarize where they are being mentioned, detect whether they appear unimplemented, and point investigators toward the likely code surfaces that would need to change.

## Why this matters

This is useful for:

- product teams identifying repeated demand
- engineering teams spotting missing capabilities before they become incidents
- agents deciding whether a request already has an implementation path
- maintainers working across multiple related repos

## Desired outcome

A user should be able to ask something like:

- what common requests are users making about uploads
- what complaints keep appearing around timeout handling
- what gaps are repeatedly mentioned but still not implemented

And get back something like:

- common request cluster: better upload timeout / cancellation support
- mentioned in: issue A, comment B, discussion C, issue D
- current implementation evidence: no matching PR or code change found
- likely code surfaces: files X/Y/Z in repos A/B
- confidence: medium

## Design considerations

### 1. Cluster repeated demand

We likely need to cluster semantically similar artifacts across source types, then merge those clusters with explicit edge signals where possible.

### 2. Distinguish implemented vs unimplemented

It is not enough to find repeated complaints. We also need to inspect whether there is evidence of:

- a PR
- code changes
- documentation updates
- closed issues referencing a fix

If none of those are found, the output should say the request appears unmet or unresolved, not just relevant.

### 3. Map demand to code surfaces

A strong differentiator would be pointing from user feedback to likely implementation areas:

- likely repos
- likely packages
- likely files or subsystems

This can be heuristic at first, but it must be explicit about uncertainty.

### 4. Keep evidence first-class

The result should cite the actual issues/comments/discussions that support the cluster, not just emit an opaque summary.

## Proposed plan

1. Define the user-facing output for request/gap clustering.
2. Determine whether this belongs under `trace`, a new command, or a separate analysis mode.
3. Prototype clustering over GitHub issues/comments/discussions with real repo data.
4. Add heuristics for detecting whether a request appears implemented.
5. Add heuristics for mapping the request to likely code surfaces across repos.
6. Validate on one or two real themes from the FOC ecosystem.

## Open questions

- Is this an extension of `trace`, or a new feature entirely?
- How should we represent confidence around “not implemented yet”?
- What is the minimum viable mapping from request cluster -> likely code surfaces?
- How much can we do with current edges plus semantic search before needing new ingest metadata?

## Acceptance criteria

- Repeated requests or complaints can be grouped into a clear cluster with supporting evidence links
- The output can distinguish likely implemented vs likely unmet demand
- The system can point to likely repos/files/subsystems that would change if the feature were implemented
- The result remains evidence-backed and explicit about uncertainty


## User Stories

- **US-001**: As a user, I want detect clustered feature requests and map unmet de so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #57 on 2026-04-12.
