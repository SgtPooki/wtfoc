# [roadmap] Product opportunities and direction

**Increment**: 0044G-product-opportunities-and-direction
**Type**: spec | **Priority**: P3 | **Labels**: spec, P3
**Source**: GitHub #42

## Description

## wtfoc Product Opportunity Map

From Codex design review + team discussion. Organized by timeline.

### Near-Term (Hackathon / v0.1)
**Already shipping:**
- ✅ Evidence-backed trace (Slack → issue → PR → code)
- ✅ Pluggable embedder seam (transformers.js, LM Studio, OpenAI)
- ✅ Pluggable vector index seam
- ✅ Pluggable storage backend seam (local, FOC planned)
- ✅ Verification-first results (every result has a storage ID)
- ✅ Multi-repo code + docs ingestion

**Still needed for demo:**
- Multi-repo ingest in one collection (multiple `ingest repo` calls)
- Demo script for 2-min recording
- Real FOC repo data (7 repos)

### Medium-Term Product Wedges
These are the directions that make wtfoc more than a hackathon project:

1. **CID-mounted query packs** — load a collection from CIDs and query it without full re-ingest. "Here's a CID, query it." Zero setup for the consumer.

2. **Collection diffing** — compare two manifest heads. Show added/removed/changed chunks and edges. "What changed in our knowledge base since last week?"

3. **Cross-source change intelligence** — "what happened related to uploads since Monday?" combining new Slack messages, new issues, new PRs, new code commits.

4. **Trust-scoped knowledge** — filter results by source trust level, agent identity, repo, or evidence strength. Not all sources are equal.

5. **Compliance/audit trails** — "show why this decision happened" with traceable artifacts. Every fact → source → CID → verification.

### Long-Term Platform Bets

6. **Multi-party shared corpora** — several teams contribute evidence to one collection while preserving provenance. Each team's contributions are separately verifiable.

7. **Background watcher agents** — agents that continuously ingest new GitHub activity, docs changes, or discussions and publish incremental updates to collections.

8. **Automatic documentation** — agents turn changes into evidence-backed docs, changelogs, or incident summaries.

9. **Open-source project intelligence** — cross-repo issue/PR/code tracing for ecosystems (not just one project). "What's happening across the entire Filecoin ecosystem?"

10. **Institutional memory export** — teams leaving a vendor stack can preserve knowledge in portable, verifiable form.

### Anti-Patterns (What NOT to Build)
Per constitution:
- Don't become a vector DB
- Don't become an agent framework
- Don't promise multi-writer coordination too early
- Don't store opaque summaries without evidence links
- Embeddings are compute; CID-addressed evidence is the product

### References
- #36 — Agent memory design discussion
- docs/foc-rag-storage.md — FOC storage architecture
- docs/embedding-audit-trail.md — Model audit trail

## User Stories

- **US-001**: As a user, I want product opportunities and direction so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #42 on 2026-04-12.
