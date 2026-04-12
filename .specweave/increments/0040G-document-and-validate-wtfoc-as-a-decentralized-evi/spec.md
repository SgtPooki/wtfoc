# Document and validate wtfoc as a decentralized evidence layer for RAG pipelines

**Increment**: 0040G-document-and-validate-wtfoc-as-a-decentralized-evi
**Type**: feature | **Priority**: P2 | **Labels**: scope, P2
**Source**: GitHub #55

## Description

## Problem

`wtfoc` has a credible story as part of a RAG stack, but we do not yet state it clearly or validate it end-to-end in the product/docs. Right now the likely message is scattered across `SPEC.md`, package boundaries, and implicit architecture decisions.

If we want people to adopt `wtfoc` in real systems, we need to be precise about what it is and what it is not.

## Proposed positioning

`wtfoc` should be described as a decentralized evidence layer for RAG pipelines:

- ingest source data into chunks plus explicit edges
- persist artifacts and manifests through a backend-neutral storage seam
- use FOC/IPFS-backed storage as the best-default decentralized persistence path
- preserve evidence provenance and portability
- expose retrieval/trace capabilities without requiring users to replace their full application stack

This is stronger and more accurate than calling `wtfoc` a vector database or a complete RAG framework.

## Goal

Make the RAG integration story explicit, technically accurate, and demonstrably functional.

## Non-goals

- Rebranding `wtfoc` as a full agent framework
- Claiming decentralized query execution when only storage/provenance is decentralized
- Overselling FOC as mandatory instead of the best default backend

## Why this matters

Many RAG systems are weak on provenance, portability, and evidence continuity. They often treat chunks and embeddings as disposable application data.

`wtfoc` has a more interesting angle:

- backend-neutral artifact identity
- immutable evidence artifacts with mutable manifest indexing
- explicit edges between artifacts
- decentralized persistence via the storage seam
- traceable retrieval that can explain why artifacts are connected

That is a differentiated product story, but only if we explain it cleanly and make it easy to try.

## Questions this issue should answer

- What is the shortest accurate description of `wtfoc` for RAG users?
- Where does `wtfoc` sit in an existing RAG stack?
- What parts of the stack can users keep, and what parts can `wtfoc` replace or augment?
- What does decentralized storage buy the user in practice?
- What integration path can we show that is real, not hypothetical?

## Candidate messaging

### Short version

`wtfoc` adds a decentralized, verifiable evidence layer to a RAG system.

### Slightly expanded version

Use `wtfoc` to ingest and persist knowledge artifacts with provenance and explicit lineage, while keeping your existing model, prompts, and application logic.

### What to avoid

Avoid describing `wtfoc` as:

- a decentralized vector DB
- a full hosted RAG platform
- an agent framework

Those descriptions are either too narrow or inaccurate relative to the architecture.

## Workstreams

### 1. Positioning and docs

- Add a concise RAG positioning section to the root README
- Add a deeper architecture explanation showing where `wtfoc` sits in a RAG pipeline
- Document the storage seam clearly: local mode, FOC-backed mode, and portability
- Explain the distinction between semantic retrieval and evidence-backed trace

### 2. Integration guide

Create a practical guide for integrating `wtfoc` into an existing RAG setup.

Possible guide outline:

- ingest data into `wtfoc`
- persist artifacts with local or FOC-backed storage
- build/load retrieval state
- query or trace for evidence
- pass selected evidence into an LLM application

### 3. Demo / example validation

We should validate one concrete example that proves the story works.

Examples:
- minimal local RAG example using `wtfoc` for ingest + retrieval
- same example with FOC-backed storage as the durable evidence backend
- evidence-backed bug investigation flow across GitHub issues/PRs/comments

### 4. Technical gap analysis

Audit what is still missing for this story to be fully credible:

- missing docs
- rough edges in storage setup
- unclear CLI workflows
- gaps in JSON outputs for downstream agents/apps
- missing examples around manifest/index loading and retrieval handoff

### 5. Acceptance criteria

Before we claim this story publicly, we should be able to show:

- a concise docs page or README section explaining the architecture
- a concrete example of `wtfoc` inside a RAG flow
- a clear statement of what is decentralized vs what is not
- a working path for local mode and a documented path for FOC-backed mode

## Proposed plan

1. Write a spec or design note for the RAG positioning and integration story.
2. Update top-level docs with a precise positioning paragraph and architecture diagram.
3. Create one minimal integration example that uses `wtfoc` as the evidence layer.
4. Validate storage behavior and retrieval flow in both local mode and FOC-backed mode where practical.
5. Identify follow-up issues for any technical gaps discovered during validation.

## Definition of done

This issue is complete when a new user can understand, from the docs and an example, how to use `wtfoc` in a RAG pipeline for decentralized evidence storage and traceable retrieval, without us making claims the code does not support.

## User Stories

- **US-001**: As a user, I want document and validate wtfoc as a decentralized evi so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #55 on 2026-04-12.
