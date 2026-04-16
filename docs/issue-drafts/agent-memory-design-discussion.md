# Design Discussion: Agent Memory, Incremental Updates, and Decentralized Coordination on `wtfoc`

## Suggested Title

Design discussion: evidence-backed agent memory and decentralized update flows on `wtfoc`

## Suggested Labels

- `spec`

Do not mark this `ready` for implementation yet. This is a design discussion intended to shape later specs.

## Issue Body

`wtfoc` already has the right core primitives for decentralized knowledge recall:

- immutable artifacts
- segment snapshots with embeddings and edges
- mutable head manifests for "latest"
- pluggable embedders, vector indices, and storage backends

The next design question is whether `wtfoc` can become a useful foundation for agent-builders and autonomous agents that need:

- durable memory
- efficient incremental updates
- verifiable coordination across agents
- user-facing change feeds and automatic updates
- reuse from CIDs without requiring heavy local compute

This issue is for design discussion only. It should produce a clear problem statement, boundaries, and follow-on specs. It should not start implementation yet, and it should not bypass the current rule that `@wtfoc/memory` remains deferred until the core is stable.

## Why This Matters

Agent systems are moving toward:

- long-lived memory
- shared context across tools and runtimes
- background discovery and ingestion
- automatic documentation and update generation
- decentralized coordination instead of one closed vendor database

If `wtfoc` wants to be useful for that ecosystem, it needs a credible story for how agents can:

1. observe new facts or source changes
2. publish evidence-backed updates
3. version those updates safely
4. let other agents or users discover what changed
5. rehydrate useful state from CIDs and manifests

The project already has parts of this story in its storage and manifest model, but it does not yet describe the agent-facing workflows.

## Problem Statement

We need a design for how agents should use `wtfoc` as a decentralized knowledge substrate without turning the project into an unbounded "agent platform."

The design should answer:

- What counts as agent memory in `wtfoc`?
- What data should be immutable artifacts versus mutable pointers?
- How should agents publish incremental updates instead of full rebuilds?
- How should users or other agents discover diffs, feeds, or subscriptions?
- How should an agent consume an existing CID-backed collection without re-embedding the entire corpus?
- What provenance, trust, and conflict rules are required when multiple agents contribute to the same collection?

## Design Goals

- Keep `wtfoc` grounded in evidence-backed knowledge, not opaque agent state.
- Reuse the existing manifest-chain model instead of inventing a separate memory substrate.
- Support incremental publish-and-discover workflows.
- Make CID-based reuse practical for low-compute consumers.
- Preserve credible exit at every seam.
- Make user-visible updates first-class, not an afterthought.
- Keep the initial design useful for CLI and library consumers before any future MCP or agent package exists.

## Non-Goals

- Building a full autonomous multi-agent runtime.
- Adding a web dashboard.
- Adding speculative "self-improving" behavior without provenance.
- Locking the system to a single hosted embedder or vector DB.
- Scaffolding `@wtfoc/memory` or `@wtfoc/mcp` in this issue.

## Design Topics To Resolve

### 1. Memory model

Should agent memory in `wtfoc` be modeled as:

- raw source snapshots plus extracted edges
- agent-authored observations attached to evidence
- derived summaries and state snapshots
- all of the above, but with clear provenance classes

We likely need a distinction between:

- observed facts
- inferred facts
- summaries
- operational state

Only some of those belong in shared decentralized storage by default.

### 2. Incremental updates

Agents should not need to re-publish a full collection for every change.

We need a story for:

- append-only segment creation
- manifest updates that point to new segments
- lightweight diffing between head revisions
- selective re-indexing or rehydration

### 3. Change feeds and automatic updates

Users and agents will need more than ad hoc query.

We should define whether `wtfoc` eventually supports:

- "what changed since head X"
- collection revision diffs
- feed/subscription primitives
- materialized summaries for end users

### 4. Agent coordination and conflicts

Today the project assumes a single writer per project.

That is a good MVP rule, but this discussion should clarify the path for:

- multiple agent writers
- branch/merge style workflows versus strict single-writer coordination
- provenance for who published what
- trust policies for accepting or ignoring another agent's updates

### 5. Low-compute CID consumers

An important goal is that a user or agent with limited local hardware can still do useful work with a CID-backed collection.

We need to define the expected flow for:

- mounting from a head manifest CID or equivalent handle
- reusing stored corpus embeddings from segment blobs
- issuing lightweight query embeddings locally or via remote providers
- performing trace or lookup workflows with no embedder at all when possible

### 6. Public versus private memory

Because FOC/IPFS storage is durable and potentially public, we need a strong stance on:

- redaction
- privacy boundaries
- default handling for sensitive operational state
- whether some agent memory should remain local-only by design

## Proposed Outcome Of This Discussion

This issue should end with agreement on whether the following future specs are worth writing:

1. Agent memory model and provenance classes
2. Incremental collection updates and revision diffs
3. Subscription/change-feed interfaces for users and agents
4. CID-mounted collection hydration for low-compute consumers
5. Trust, identity, and conflict policy for multi-agent contributions

## Open Questions

- Is agent memory in scope for the core packages, or should it remain an application-layer concern over `store` + `search`?
- Do we need explicit schema support for agent-authored observations, or can they be represented as ordinary chunks plus metadata?
- Should "automatic user updates" be generated on read, persisted as artifacts, or both?
- Is a manifest diff enough for subscriptions, or do we need a first-class event/feed abstraction?
- What is the minimal useful agent identity model: signer, source tag, wallet address, or something else?
- How much multi-writer coordination belongs in `wtfoc` versus external orchestration?
- What should be the first concrete user workflow to optimize for: personal memory, team knowledge updates, or machine-to-machine coordination?

## Initial Direction

My current bias is:

- keep the storage story simple and evidence-first
- model agent output as published artifacts with provenance, not hidden internal state
- use segments plus head revisions as the durable update mechanism
- add revision diff and change-feed capabilities before attempting true multi-agent write coordination
- optimize the CID story so consumers can mount and query shared collections without reprocessing the whole corpus

That would keep `wtfoc` useful for agent builders without turning it into a vague "AGI memory layer."

## What Good Looks Like

A strong outcome would be a future workflow where:

1. an agent ingests or observes new evidence
2. it publishes a new segment with artifacts, edges, and derived retrieval data
3. it updates a collection head
4. another agent or user can discover the new revision
5. they can inspect a diff, fetch cited evidence, and run queries or traces from the shared state
6. they can do that from CIDs and portable manifests, with minimal local infrastructure

## Next Step After Discussion

If this direction holds up, the next step is a formal design issue on GitHub capturing scope, acceptance criteria, and open trade-offs — cross-reviewed by a second agent before any implementation work begins. Commits that complete that work reference the issue with `fixes #N`.
