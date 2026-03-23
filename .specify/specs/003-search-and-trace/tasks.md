# Tasks: Search and Trace

**Input**: Design documents from `/specs/003-search-and-trace/`

## Phase 1: Embedder (US1)

- [ ] T001 [US1] Create `packages/search/src/embedders/transformers.ts` — TransformersEmbedder using @huggingface/transformers with lazy model init, AbortSignal support
- [ ] T002 [P] [US1] Create `packages/search/src/embedders/transformers.test.ts` — embed returns Float32Array of correct dimensions, batch works, cold start succeeds, abort rejects
- [ ] T003 [P] [US1] Create `packages/search/src/embedders/openai.ts` — OpenAIEmbedder as fallback (fetch-based, API key required)
- [ ] T004 [P] [US1] Create `packages/search/src/embedders/openai.test.ts` — mocked fetch, correct dimensions, missing API key throws

**Checkpoint**: Embedding works with local model or OpenAI

---

## Phase 2: Vector Index (US2)

- [ ] T005 [US2] Create `packages/search/src/index/in-memory.ts` — InMemoryVectorIndex with brute-force cosine similarity, serialize/deserialize
- [ ] T006 [P] [US2] Create `packages/search/src/index/in-memory.test.ts` — add entries, search returns sorted by score, topK respected, empty index, round-trip serialization

**Checkpoint**: Vector search works in memory

---

## Phase 3: Trace (US3) — Hero Feature

- [ ] T007 [US3] Create `packages/search/src/trace.ts` — `trace(query, options)`: embed query → find seed chunks → follow explicit edges → semantic fallback for unconnected chunks → group by sourceType → annotate each hop with edge evidence
- [ ] T008 [P] [US3] Create `packages/search/src/trace.test.ts` — multi-source fixture with known edge chain: Slack → Issue → PR → Code. Assert trace follows edges, falls back to semantic for unconnected, detects cycles, groups by sourceType.
- [ ] T009 [US3] Implement cycle detection: track visited chunk IDs during edge traversal, stop at already-visited nodes

**Checkpoint**: Trace follows edges across source types with semantic fallback

---

## Phase 4: Query (US4)

- [ ] T010 [US4] Create `packages/search/src/query.ts` — `query(text, options)`: embed → vector search → return ranked results with scores + storage IDs + sourceType
- [ ] T011 [P] [US4] Create `packages/search/src/query.test.ts` — ranked results, sourceType diversification, empty results

**Checkpoint**: Semantic search works

---

## Phase 5: Public API (US5)

- [ ] T012 [US5] Update `packages/search/src/index.ts` — export embedders, vector index, trace, query
- [ ] T013 [P] [US5] Create `packages/search/README.md`
- [ ] T014 [P] Ensure `pnpm test` and `pnpm lint` pass

---

## Dependencies

- **Phase 1 (Embedder)**: No dependencies — start immediately
- **Phase 2 (Vector Index)**: No dependencies — parallel with Phase 1
- **Phase 3 (Trace)**: Depends on Phase 1 + Phase 2
- **Phase 4 (Query)**: Depends on Phase 1 + Phase 2 (parallel with Phase 3)
- **Phase 5**: Depends on all above
