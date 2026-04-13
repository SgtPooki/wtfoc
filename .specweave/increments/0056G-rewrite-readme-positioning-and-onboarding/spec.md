---
status: completed
---
# Rewrite README positioning and onboarding

**Increment**: 0056G-rewrite-readme-positioning-and-onboarding
**Type**: docs | **Priority**: P2 | **Labels**: docs, P2
**Source**: GitHub #235

## Description

## Problem

The root `README.md` already communicates the broad thesis of `wtfoc`, but it does not present that thesis in the clearest order for a new visitor.

The current document has three messaging problems:

- it introduces multiple entry points before clearly establishing the product outcome and intended audience
- it underemphasizes the strongest differentiators from `docs/why.md`: search vs trace, evidence-backed edges, and provenance
- it blurs current product reality with longer-term vision in ways that can make the project sound more complete than the README can immediately prove

This makes the README less effective as the front door for skeptical developers and less aligned with the sharper positioning already developed in `docs/why.md` and `docs/vision.md`.

## Goal

Rewrite the root README so it:

- states the user, problem, and outcome in plain language near the top
- surfaces the search-vs-trace distinction early
- keeps the document honest about current capabilities while still pointing at the broader vision
- simplifies early onboarding choices
- preserves concrete, runnable ways to try the project

## Non-goals

- changing product behavior, package boundaries, or public APIs
- introducing new roadmap promises that are not already grounded in the current repo
- adding private/encrypted collection claims to the README before they have active implementation work

## Proposed shape

The rewritten README should follow this flow:

1. Hero and concise value proposition
2. Short problem framing
3. Search vs trace comparison
4. Quick start paths for hosted MCP, CLI, and self-hosting
5. What makes `wtfoc` different today
6. Example or proof section that shows a concrete trace outcome
7. Packages, seams, and deeper docs

## Acceptance criteria

- The opening section identifies who `wtfoc` is for and what it does without requiring the reader to infer it
- The README explicitly distinguishes `query` from `trace`
- The differentiators from `docs/why.md` appear in the README without copying the entire essay
- The README avoids implying untracked or distant vision items are available now
- The README still preserves concrete adoption paths: hosted MCP, CLI, and self-host

## User Stories

- **US-001**: As a new visitor, I want the README to explain what `wtfoc` is, why it is different, and how to try it so I can decide quickly whether it fits my workflow
  - **AC-US1-01**: [x] The rewritten README clearly states user, problem, and differentiation
  - **AC-US1-02**: [x] The rewritten README keeps current capabilities and longer-term vision appropriately separated
  - **AC-US1-03**: [x] The rewritten README preserves concrete onboarding paths and links to deeper docs

## Notes

This increment is documentation-only and should validate through doc review rather than code tests.
