# Design lineage-first trace output for human and agent investigation workflows

**Increment**: 0041G-lineage-first-trace-output-for-human-and-agent-inv
**Type**: feature | **Priority**: P1 | **Labels**: core, P1
**Source**: GitHub #54

## Description

## Problem

`wtfoc trace` currently returns relevant artifacts, but the human-facing output is still mostly a grouped result set. That is useful for inspection, but weak for investigation. Users and agents still have to manually reconstruct the actual story: what happened first, what likely caused it, what attempted to fix it, whether the fix is complete, and what to read next.

This is especially visible in cross-repo GitHub data, where the truth is fragmented across issues, PRs, PR comments, and neighboring repos.

## Why this matters

The differentiator for `wtfoc` is not just semantic retrieval. It is evidence-backed, cross-source lineage. If the CLI only shows grouped matches, we are leaving the hardest and most valuable part of the work to the operator.

For humans, this means slower bug triage and more tab-opening.
For agents, this means extra reasoning steps before they can act.

## Goal

Make `trace` answer higher-order questions directly:

- What is the primary artifact for this incident?
- What likely fixed it?
- Is the fix complete or contested?
- What related context is adjacent but not part of the core chain?
- What should the reader inspect next?

## Non-goals

- Replacing raw evidence output entirely
- Hiding uncertainty or overfitting a single narrative when evidence is weak
- Baking in GitHub-only assumptions at the package seam level

## Key observation

`trace()` already preserves a flat hop list in traversal order, but the CLI emphasizes grouping by `sourceType`. We likely need lineage-first rendering, with grouped evidence as a secondary/debugging view.

## Design directions

### 1. Lineage-first default view

Show the best inferred chain first, with concise reasoning per hop.

Example shape:

1. Problem report: issue/discussion/slack message
2. Proposed fix: PR/commit/code/doc
3. Review or contradiction: PR comment/review/follow-up issue
4. Related context: semantic neighbors and adjacent repos
5. Conclusion: one-paragraph synthesis with uncertainty noted

This should prioritize explicit edges, then use timestamps and semantic confidence as supporting signals.

### 2. Timeline view

Show all relevant artifacts in strict chronological order.

This is useful when the operator asks:
- what happened when
- how the incident evolved
- whether a bug report predates or follows a suspected fix

This requires exposing chunk-level timestamps through the trace result contract.

### 3. Evidence view

Preserve the current grouped-by-source output as an inspection mode.

This is still useful for:
- debugging ingest/search behavior
- auditing source coverage
- verifying which source types contributed to the trace

### 4. Agent-oriented conclusion block

Add a structured summary that can be consumed by both humans and agents:

- `primaryArtifact`
- `candidateFixes[]`
- `openQuestions[]`
- `relatedContext[]`
- `recommendedNextReads[]`

This can exist in JSON even before the human formatter is perfect.

### 5. Confidence separation

Do not collapse everything into one score. Keep these as separate signals:

- semantic similarity
- edge strength / explicit linkage
- temporal ordering confidence
- narrative confidence

This will make the system more honest and easier for agents to reason about.

## Human use cases

- Triage a bug across multiple repos without manually correlating issue -> PR -> review comments
- Understand whether an issue was actually fixed or only partially addressed
- Recover project context after being dropped into an unfamiliar codebase or ecosystem
- Prepare a status update or incident summary grounded in evidence

## Agent use cases

- Decide what artifact to read first when asked to investigate a bug
- Determine whether a fix already exists before proposing a new one
- Detect unresolved contradictions in review comments or follow-up issues
- Produce grounded summaries with evidence links instead of flat search hits
- Route work: implementation, validation, documentation, or escalation

## Proposed plan

### Phase 1: Research and shape the contract

- Audit current `trace` output and identify what signal is lost in the formatter
- Confirm available metadata across adapters, especially timestamps and artifact subtype
- Propose an updated `TraceResult` contract that supports lineage, timeline, and evidence views without breaking the search/trace distinction

### Phase 2: Define ranking and ordering heuristics

- Establish a deterministic heuristic for the core lineage chain
- Prefer explicit edges for the main chain
- Use timestamps as ordering/tie-break support
- Keep semantic-only neighbors out of the primary chain unless evidence is sparse
- Define how to surface uncertainty and competing narratives

### Phase 3: Design human output

- Prototype `--view lineage`, `--view timeline`, and `--view evidence`
- Make lineage the default if the output is clearly better than grouped results
- Ensure stdout remains data-oriented and `--json` remains first-class

### Phase 4: Design agent output

- Add machine-readable conclusion fields to JSON
- Make it easy for agents to identify primary artifact, likely fix, unresolved concerns, and next reads
- Avoid forcing downstream agents to re-derive obvious structure

### Phase 5: Validate with real demo traces

Use the existing FOC ecosystem data to test examples like:
- upload timeout / abort signal propagation
- issue -> PR -> review concern chains
- cross-repo neighboring context in `filecoin-pin` and `synapse-sdk`

## Open questions

- Should lineage be one best chain, or a small set of competing chains?
- How much inference should `trace` do versus leaving ambiguity explicit?
- Should artifact subtypes be normalized further in ingest so ranking is less formatter-specific?
- What is the minimum JSON structure that materially helps agents without overcommitting the API too early?
- Do we need adapter-specific lineage rules, or can we get most of the value from generic edge + timestamp heuristics?

## Acceptance criteria for follow-up work

- A ratified spec updates trace behavior/output intentionally rather than ad hoc
- Real demo queries produce a readable lineage narrative without requiring manual reconstruction
- JSON output includes enough structure for agent consumers to act on the result
- The evidence view remains available for debugging and auditability

## Demo standard

A successful trace should not end with "18 results across 3 source types" as the main takeaway.
It should be able to say something like:

> Most likely chain: issue `#328` -> PR `#332` -> review comment indicating incomplete signal propagation.

That is the product bar for lineage.

## User Stories

- **US-001**: As a user, I want lineage first trace output for human and agent inv so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #54 on 2026-04-12.
