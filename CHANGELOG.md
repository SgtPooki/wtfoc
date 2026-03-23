# Changelog

## Day 1 — 2026-03-23 (Hackathon Kickoff)

### What we built
- **Full working CLI**: `./wtfoc init`, `ingest repo`, `trace`, `query`, `status`, `verify`
- **5 packages**: `@wtfoc/common` (interfaces), `@wtfoc/store` (local + FOC), `@wtfoc/ingest` (chunker + repo adapter + edges), `@wtfoc/search` (embedder + vector index + trace + query), `@wtfoc/cli`
- **FOC storage working**: uploaded a 69KB segment to calibration testnet, round-tripped successfully (PieceCID: `bafkzcibe57nqgddm2pjjshhv2aa57pydqwdrxtotjq4qyaz4leebppmobjwsqsy6ay`)
- **3 embedder backends**: transformers.js (local CPU), LM Studio (mxbai-embed-large), Ollama (homelab k8s nomic-embed-text)
- **10 FOC repos** in demo script: synapse-sdk, filecoin-pin, foc-cli, filecoin-pay, filecoin-pay-explorer, filecoin-services, curio, pdp-explorer, dealbot, filecoin-nova
- **146 tests** passing across all packages
- **Multi-agent coordination**: dispatch.sh, agent-loop.sh, unblock.sh for parallel Claude/Cursor/Codex development

### Architecture
- Every seam is pluggable: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor
- Manifest chain pattern: immutable segments + mutable head pointer
- Evidence-backed trace: follows edges (references, closes, changes) with semantic fallback
- Content in segments for display (not just embeddings)
- Model mismatch detection on ingest

### Key decisions
- Named **wtfoc** ("What The FOC happened? Trace it.")
- Constitution-driven development with spec-kit
- Bundle uploads into CAR files (never spam small pieces)
- Local-first with FOC as best default (not requirement)
- No `any`, no `!`, no `as unknown as` — typed errors only

### Demo tested
```
./wtfoc init foc-demo --local
./wtfoc ingest repo FIL-Builders/foc-cli -c foc-demo --embedder lmstudio
./wtfoc trace "upload files to filecoin" -c foc-demo --embedder lmstudio
# → 0.74 score on SKILL.md, 0.73 on storage docs, 0.71 on upload.ts
```

### Learnings
- transformers.js MiniLM (384d) scores ~0.38 on real queries; mxbai-embed-large (1024d) scores ~0.86 — 2x quality improvement with LM Studio
- Qwen3-Embedding-4B GGUF not yet supported in LM Studio (unsupported architecture)
- FOC min piece size is 127 bytes — need CAR bundling for small data
- GitHub API budget: ~200-500 requests for 7 repos with bulk pagination

### What's next (Day 2)
- FOC-backed ingest flow (store segments on FOC, not just local)
- Verification command with CID download proof
- More source adapters (Slack, Discord, website via Nova)
- Demo recording preparation
