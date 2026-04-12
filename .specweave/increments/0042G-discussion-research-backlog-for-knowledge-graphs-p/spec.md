# Design discussion: research backlog for knowledge graphs, provenance, and retrieval in wtfoc

**Increment**: 0042G-discussion-research-backlog-for-knowledge-graphs-p
**Type**: spec | **Priority**: P3 | **Labels**: question, spec, authored-codex, P3
**Source**: GitHub #44

## Description

# Design Discussion: Research Backlog for Knowledge Graphs, Provenance, and Retrieval in `wtfoc`

## Suggested Title

Design discussion: research backlog for knowledge graphs, provenance, and retrieval in `wtfoc`

## Suggested Labels

- `spec`
- `question`

Do not mark this `ready` for implementation yet. This issue is for design discussion and research synthesis.

## Issue Body

`wtfoc` is making a strong architectural bet:

- immutable artifacts
- mutable heads over immutable segments
- explicit evidence-backed edges
- semantic search plus graph-guided trace
- portable, CID-addressable knowledge snapshots

That direction feels right, but we should pressure-test it against relevant research before we harden more schemas and workflows.

This issue is for collecting and discussing the most relevant papers, articles, and standards for:

- knowledge-graph-backed retrieval
- provenance and evidence modeling
- versioned or evolving knowledge bases
- incremental updates and low-compute reuse

The goal is not to chase every graph paper. The goal is to identify what should change or be clarified in `wtfoc` as a result of the strongest prior work.

## What We Want To Validate

We should use this discussion to evaluate whether `wtfoc` is sound on these questions:

- Is "trace != search" the right architectural split?
- Are explicit typed edges a meaningful advantage over embeddings-only storage?
- Is our immutable-segment plus mutable-head model a good fit for evolving knowledge bases?
- What provenance model do we need for trustworthy cross-source recall?
- What data should be stored to make CID-based reuse practical for low-compute users and agents?
- What should be added before we claim a strong knowledge-graph or agent-memory story?

## Recommended Sources

### 1. GraphRAG: From Local to Global

Source:

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130)

Why it matters:

- It is one of the clearest recent arguments that graph structure can outperform plain semantic retrieval for global sensemaking tasks.
- It validates the idea that relationships across chunks/documents matter, not just nearest-neighbor similarity.

What `wtfoc` should learn from it:

- global questions often need graph-aware traversal, not just top-k chunk retrieval
- graph structure helps summarize cross-document themes
- chunk-level retrieval alone is often weak for multi-hop, cross-source understanding

What it could turn into in `wtfoc`:

- clearer distinction between `query` and `trace`
- future support for collection-level summaries over edge-connected evidence
- segment metadata that improves routing before full retrieval

### 2. GraphRAG Surveys

Sources:

- [Graph Retrieval-Augmented Generation: A Survey](https://arxiv.org/abs/2408.08921)
- [Retrieval-Augmented Generation with Graphs (GraphRAG)](https://arxiv.org/abs/2501.00309)

Why they matter:

- Surveys are useful for checking whether we are missing obvious design dimensions.
- They should help us separate real architecture choices from hype.

What `wtfoc` should learn from them:

- common GraphRAG design patterns
- failure modes of graph construction and graph retrieval
- evaluation dimensions beyond simple retrieval accuracy
- where graph retrieval actually helps versus where plain dense retrieval is enough

What it could turn into in `wtfoc`:

- a more explicit retrieval strategy matrix: search, trace, hybrid
- evaluation criteria for future demos and benchmarks
- clearer non-goals so we do not drift into heavyweight GraphRAG systems prematurely

### 3. Evidence-grounded reasoning

Source:

- [TRACE the Evidence: Constructing Knowledge-Grounded Reasoning Chains for Multi-hop Question Answering](https://aclanthology.org/2024.findings-emnlp.496/)

Why it matters:

- `wtfoc` is not trying to build a generic graph database. Its value is evidence-backed reasoning across artifacts.
- This paper is directly relevant to "show me why these things are connected" workflows.

What `wtfoc` should learn from it:

- reasoning chains need explicit supporting evidence, not just retrieved context blobs
- multi-hop retrieval quality depends on preserving interpretable paths
- path quality and explanation quality should be treated as product requirements

What it could turn into in `wtfoc`:

- richer edge/path annotations in `trace`
- stronger path-scoring or confidence semantics
- evaluation of trace quality based on evidence completeness, not just answer quality

### 4. Provenance standards

Sources:

- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/)
- [PROV Primer](https://www.w3.org/TR/prov-primer/)

Why they matter:

- Provenance is a first-class requirement for `wtfoc`, not a nice-to-have.
- We should avoid inventing an ad hoc provenance model if a stable standard already covers the core concepts.

What `wtfoc` should learn from them:

- how to distinguish entities, activities, and agents
- how to model derivation, attribution, and generation cleanly
- how to represent the difference between source evidence and derived artifacts

What it could turn into in `wtfoc`:

- more explicit provenance fields on chunks, segments, or future agent-authored artifacts
- a cleaner model for "observed" versus "derived" knowledge
- better compatibility with external knowledge systems and agent tooling

### 5. Stable references to changing data

Source:

- [Reliable Granular References to Changing Linked Data](https://arxiv.org/abs/1708.09193)

Why it matters:

- `wtfoc` needs a credible story for "latest" and "what changed" without breaking immutable storage.
- This is close to the design space of manifests, segment revisions, and durable references.

What `wtfoc` should learn from it:

- how to reference evolving knowledge safely
- how to preserve stable citations as collections change
- how to think about granular addressing and revision-aware retrieval

What it could turn into in `wtfoc`:

- manifest diff support
- stronger chunk/segment/head reference semantics
- better guidance for subscriptions, updates, and long-lived citations

## Working Hypotheses

My current hypotheses are:

1. `wtfoc` is right to store more than embeddings.
2. `wtfoc` is right to keep explicit edges first-class.
3. `wtfoc` should deepen its provenance model before claiming a serious knowledge-graph story.
4. `wtfoc` should invest in revision diffs and change feeds before chasing advanced graph algorithms.
5. `wtfoc` should optimize for evidence-backed trace quality, not just semantic retrieval quality.

## Implementation Questions This Research Should Inform

If the readings support the current direction, they should help us decide whether to implement or spec the following:

- richer edge metadata and path annotations
- provenance classes for raw, derived, inferred, and agent-authored artifacts
- manifest diff and revision feed APIs
- segment routing metadata for better pre-filtering
- stronger trace scoring or traversal heuristics
- CID-mounted collection hydration flows for low-compute consumers

## Proposed Outcome

This discussion should end with one of these outcomes:

1. We confirm the current architecture is sound and document the rationale in the repo.
2. We identify a small number of schema or workflow gaps that need formal specs.
3. We decide some fashionable graph ideas are not worth implementing in `wtfoc`.

## Suggested Follow-on Specs

If this discussion is productive, likely next specs would be:

1. provenance model refinements
2. revision diffs and change feeds
3. CID-mounted collection hydration
4. trace/path scoring improvements

## Open Questions

- Do we want to align directly with parts of PROV-O, or only borrow its concepts?
- Are current `Edge` and `Segment` schemas rich enough for explainable multi-hop reasoning?
- What minimal provenance model would materially improve trust in results?
- What retrieval evaluation should matter most for `wtfoc`: path quality, citation quality, recall, latency, or some mix?
- When should graph traversal stop and semantic fallback begin?
- How much graph structure should be precomputed at ingest versus derived at query time?

## Next Step

After discussion, any architecture changes should go through the normal spec flow:

1. `/speckit.specify`
2. `/speckit.clarify`
3. `/peer-review`
4. `/speckit.plan`
5. `/speckit.tasks`

Implementation should only happen after that process.


## User Stories

- **US-001**: As a user, I want discussion research backlog for knowledge graphs p so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #44 on 2026-04-12.
