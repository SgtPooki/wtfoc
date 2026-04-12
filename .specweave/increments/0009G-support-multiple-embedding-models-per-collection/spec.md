# feat: support multiple embedding models per collection

**Increment**: 0009G-support-multiple-embedding-models-per-collection
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #186

## Description

## Problem

Collections are currently locked to a single embedding model. If someone pulls a collection and wants to use a different embedder (faster, more accurate, domain-specific), they have to re-ingest from scratch. This also blocks the "improvable knowledge" model — a contributor can't add better embeddings without replacing existing ones.

## Proposed solution

Allow a collection to carry multiple embedding sets per segment, keyed by model name. Queries select which embedding to use at search time (defaulting to whatever the collection was originally embedded with).

Key considerations:
- Schema evolution: segments need to support multiple embedding vectors per chunk (keyed by model identifier)
- Backwards compatibility: existing single-model collections should work without migration
- Storage: each additional embedding set increases size, so this pairs well with #(compressed source issue) for re-embedding from stored source material
- Discovery: `wtfoc_list_collections` / status should surface which models are available

## Open questions

- Should re-embedding be a CLI command (`wtfoc reembed -c foo --model nomic-embed-text`) or happen transparently during ingest?
- How to handle dimension mismatches across models in the vector index?
- Should the manifest track a "primary" model vs alternatives?

## User Stories

- **US-001**: As a user, I want support multiple embedding models per collection so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #186 on 2026-04-12.
