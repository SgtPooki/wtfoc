# Track user stories, demos, examples, and documentation coverage

**Increment**: 0039G-track-user-stories-demos-examples-and-documentatio
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #56

## Description

## Problem

We need a durable way to track the user stories `wtfoc` is meant to serve, connect them to examples and docs, and keep that map easy for humans and LLMs to update without bloating the README or scattering context across GitHub comments.

Today, story ideas are emerging through conversations and individual issues, but there is no single catalog that answers:

- which user stories matter most
- which ones are only ideas vs validated demos
- which examples and docs support each story
- where the remaining gaps are

## Goal

Create a lightweight but structured system for managing `wtfoc` user stories and demo coverage.

The system should:

- make it easy to add a new user story
- make it obvious where examples and docs belong
- distinguish proposed stories from validated demos
- stay compact enough that an LLM can update it reliably
- avoid turning the README into a dumping ground

## Proposed approach

Use three layers:

1. A tracking issue
   This issue serves as the master coordination point and links to the in-repo catalog.

2. A structured in-repo catalog
   Add `docs/user-stories.md` as the source of truth for story metadata, status, and links.

3. Dedicated demo/example/docs locations
   - `docs/demos/` for story-specific walkthroughs
   - `examples/` for runnable examples or integration setups
   - README only links to the top-level catalog and selected flagship stories

## Why this shape

LLMs are much better at maintaining table-driven docs with fixed sections than large freeform narrative pages.

A structured catalog should use:

- a compact index table
- stable story IDs
- short, repeatable detail sections
- clearly labeled status values
- explicit link slots for issue / spec / docs / example

That makes automated updates safer and reduces doc sprawl.

## Initial deliverables

- [ ] Add `docs/user-stories.md`
- [ ] Define a canonical story table with stable columns
- [ ] Define a repeatable detail-section template for each story
- [ ] Seed the catalog with current known stories
- [ ] Link existing issues for lineage-first trace and RAG evidence-layer positioning
- [ ] Decide whether a GitHub issue template is also needed for new story intake

## Suggested status model

Use explicit states such as:

- `proposed`
- `planned`
- `in-progress`
- `validated`
- `needs-example`
- `archived`

## Suggested catalog fields

For the index table:

- `ID`
- `Story`
- `User`
- `Status`
- `Priority`
- `Example`
- `Docs`
- `Issue`

For each story section:

- `Story`
- `User`
- `Pain`
- `Why wtfoc`
- `Inputs`
- `Expected output`
- `Example/demo`
- `Docs`
- `Issue/spec`
- `Status`
- `Open gaps`

## Seed candidates

- Trace bug lineage across issues, PRs, comments, and repos
- Use `wtfoc` as a decentralized evidence layer in a RAG pipeline
- Additional demo stories can be added later without changing the structure

## Acceptance criteria

- A contributor can add a new story without editing the README heavily
- The catalog clearly distinguishes ideas from validated demos
- Every major story can link to its example and docs from one place
- The structure is regular enough that an LLM can update it with low risk of confusing the document

## Follow-up questions

- Should we also add `.github/ISSUE_TEMPLATE/demo-story.yml` for intake?
- When does a story graduate from `proposed` to `validated`?
- Should we keep one catalog for all stories or split by persona later if it grows too large?


## User Stories

- **US-001**: As a user, I want track user stories demos examples and documentatio so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #56 on 2026-04-12.
