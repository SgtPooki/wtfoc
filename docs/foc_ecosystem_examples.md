# FOC Ecosystem Collection: Demo Examples

**Manifest CID:** `bafkreifbotswqsx6gctha2prynvkcz4dndd6ohesv4flzhmpwlr2z3x2dq`

Collection: `foc-ecosystem-v2` | 28,880 chunks | 580 segments | nomic-embed-text (768d)

## Sources Ingested

| Source | Type | Chunks |
|---|---|---|
| FilOzone/synapse-sdk | GitHub | 2,952 |
| FilOzone/filecoin-pin | GitHub | 1,750 |
| filecoin-project/curio | GitHub (180d) | 1,500 |
| filecoin-project/filecoin-docs | GitHub | 6,714 |
| filecoin-project/lotus | GitHub (180d) | 725 |
| SgtPooki/wtfoc | GitHub | 675 |
| FilOzone/dealbot | GitHub | 2,805 |
| FilOzone/pdp | GitHub | 901 |
| FilOzone/filecoin-cloud | GitHub | 1,472 |
| FilOzone/filecoin-services | GitHub | 2,039 |
| FilOzone/foc-devnet | GitHub | 462 |
| FilOzone/pdp-explorer | GitHub | 163 |
| FilOzone/onramp-contracts | GitHub | 41 |
| FilOzone/dagparts | GitHub | 42 |
| filecoin-project/curio-docs | GitHub | 6 |
| filecoin-project/FIPs | GitHub (180d) | 186 |
| #fil-foc | Slack (180d) | 570 |
| #fil-pdp | Slack (180d) | 19 |
| #fil-implementers | Slack (180d) | 34 |
| #fil-builders | Slack (180d) | 103 |
| docs.filecoin.cloud | Website (94 pages) | 2,830 |
| docs.filecoin.io | Website (200 pages) | 2,791 |

## Edge Statistics

- **24,693 segment edges** (regex, heuristic, code, tree-sitter)
- **22,272 LLM-extracted edges** (haiku via claude-direct-proxy)
- **4,111 temporal-proximity edges** (Slack <-> GitHub, 6h window)

---

## Demo Queries

### 1. Cross-source trace: Slack to GitHub issue chains

**Goal:** Show how a Slack discussion connects to specific GitHub work.

```bash
node packages/cli/dist/cli.js trace "fil-foc slack discussion curio deployment" \
  -c foc-ecosystem-v2 --mode analytical \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text \
  --max-total 30 --max-per-source 10 --max-hops 6 \
  --include slack-message github-issue github-pr
```

**What it shows:**
- Slack message in #fil-foc about "updating M3 Calibnet contract addresses in Curio"
- Chains to curio PR #685 (fix breaking changes due to PDP v2.2.0)
- Which chains to issue #679 (Update Curio to use M3 FWSS contracts)
- And issue #683 (M3 Curio PDP Burndown Overview)
- Temporal edges: Slack messages within 0.4h of curio PR comments
- **Insight: Slack -> GitHub Issues -> GitHub PRs -> Slack round-trip**

---

### 2. Deep issue graph: PDP cache proving in Curio

**Goal:** Follow the full dependency chain of a feature across PRs and issues.

```bash
node packages/cli/dist/cli.js trace "curio PDP storage provider bug fix" \
  -c foc-ecosystem-v2 --mode analytical \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text \
  --max-total 50 --max-per-source 10 --max-hops 6
```

**What it shows:**
- Starts at issue #888 (PDP: cache merkle tree layer for proof generation to reduce RAM 100-1000x)
- Chains through PR #997 (introduce PDP Save Cache and Proving Task) with deep code review comments
- Into issue #1062 (testing Verify() against go-fil-commp-hashhash)
- Links to PR #1067 (extract cached proof pipeline behind testable interfaces)
- PR #1065 (verify validity tests)
- Issue #1111 (pdpv0: notify_task.go uses t.db.Exec inside BeginTransaction)
- Also surfaces FilOzone/pdp#121 (Merge pdp into Curio) and Slack temporal edges
- **49 of 50 results found via edges** (not just semantic similarity)
- Cross-source evidence trail: Issues -> PRs -> Issues -> PR Comments -> Slack

---

### 3. FWSS contract upgrade story across repos

**Goal:** Trace a contract upgrade across filecoin-services, synapse-sdk, filecoin-pin, and Slack.

```bash
node packages/cli/dist/cli.js trace "FWSS contract upgrade M3 calibnet deployment" \
  -c foc-ecosystem-v2 --mode analytical \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text \
  --max-total 20 --max-per-source 8 --max-hops 6 \
  --exclude github-pr-comment doc-page
```

**What it shows:**
- filecoin-services issues and PRs about contract deployment
- synapse-sdk tracking issues for M3 support
- filecoin-pin integration PRs
- Slack messages from #fil-foc and #fil-implementers about the rollout
- **Insight: GitHub Issues -> GitHub PRs -> GitHub Issues -> Slack**

---

### 4. Developer how-to: Synapse SDK upload flow

**Goal:** Find the latest upload API and breaking changes.

```bash
node packages/cli/dist/cli.js query "synapse-sdk storage operations upload file" \
  -c foc-ecosystem-v2 -k 10 \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text
```

**What it shows:**
- filecoin-pin PR #369 (update to synapse-sdk@0.40.0 breaking upload API)
- Synapse SDK changelog with storage feature details
- Issue #646 (update synapse-react for multi SP upload flow)
- filecoin-pin PR #262 (fix: use StorageManager for upload)

---

### 5. Source-filtered trace: Only Slack + Issues (no noise)

**Goal:** Focus on high-signal human discussions, filter out code review noise.

```bash
node packages/cli/dist/cli.js trace "PDP proving performance issues" \
  -c foc-ecosystem-v2 --mode analytical \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text \
  --max-total 30 --max-per-source 10 --max-hops 6 \
  --include slack-message github-issue
```

---

### 6. Session key registry: cross-repo deployment coordination

**Goal:** Find how session key changes propagated across repos.

```bash
node packages/cli/dist/cli.js query "session key registry deployment migration breaking changes" \
  -c foc-ecosystem-v2 -k 10 \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text
```

**What it shows:**
- filecoin-services PR #197 (update load session-key-registry via https)
- filecoin-services PR #205 (fix nonce handling in deploy script)
- filecoin-pin PR #107 (fix: use correct addresses with session key auth)
- foc-devnet PR #61 (add sessions key registry in DevnetInfo, remove curio layers)
- filecoin-services PR #384 (v1.1.0 FWSS upgrade scripts — matched via breaking changes discussion)
- dealbot PR #181 (migration safety review comments about pgcrypto/pgboss)

---

## New CLI Features

### Expanded trace limits
```bash
--max-total 50       # Up to 200 results (was hardcoded at 15)
--max-per-source 10  # Up to 50 per source type (was hardcoded at 3)
--max-hops 6         # Up to 10 edge hops (was hardcoded at 3)
```

### Source type filtering
```bash
--exclude github-pr-comment doc-page  # Remove noisy sources
--include slack-message github-issue  # Focus on specific types
```

### Available source types in this collection
- `slack-message` - Slack channel messages
- `github-issue` - GitHub issues
- `github-pr` - GitHub pull requests
- `github-pr-comment` - PR review comments
- `doc-page` - Website documentation pages

---

## Prerequisites for running demos

1. **Run ollama with nomic-embed-text** — queries need the same embedder used during ingestion:
   ```bash
   # If you have ollama installed locally:
   ollama pull nomic-embed-text
   ollama serve
   # Default: http://localhost:11434
   ```

2. **Tree-sitter parser sidecar** (optional, for re-ingestion with code edges):
   ```bash
   docker run -p 8080:8080 ghcr.io/sgtpooki/wtfoc-tree-sitter-parser:latest
   ```

3. **Claude direct proxy** (optional, for LLM edge extraction):
   ```bash
   bun scripts/claude-direct-proxy.mjs
   ```

---

## Run it yourself

This collection is stored on Filecoin via FOC. Anyone can pull it down and query it locally.

### 1. Install wtfoc

```bash
npx wtfoc --version
```

### 2. Start ollama with nomic-embed-text

The collection was embedded with `nomic-embed-text` (768 dimensions). You need the same model to query it.

```bash
ollama pull nomic-embed-text
ollama serve
```

### 3. Pull the collection locally

Download all segments from IPFS/FOC to your local `~/.wtfoc` storage:

```bash
npx wtfoc pull bafkreifbotswqsx6gctha2prynvkcz4dndd6ohesv4flzhmpwlr2z3x2dq
```

This fetches the manifest and all 580 segments (~28K chunks) to local storage. Once pulled, you can query without network access.

### 4. Query locally via CLI

```bash
# Semantic search
npx wtfoc query "synapse SDK upload flow" \
  -c foc-ecosystem-v2 \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text

# Trace with edge traversal
npx wtfoc trace "PDP verification curio" \
  -c foc-ecosystem-v2 --mode analytical \
  --embedder api --embedder-url ollama --embedder-model nomic-embed-text \
  --max-total 50 --max-per-source 10 --max-hops 6
```

### 5. Browse via the web UI

Visit [wtfoc.xyz](https://wtfoc.xyz) and paste the manifest CID to explore in your browser:

```
bafkreifbotswqsx6gctha2prynvkcz4dndd6ohesv4flzhmpwlr2z3x2dq
```

Or run the web UI locally after pulling:

```bash
npx wtfoc serve -c foc-ecosystem-v2 \
  --embedder-url ollama --embedder-model nomic-embed-text
```

### Embedding model compatibility

The collection **must** be queried with the same embedding model it was built with. If you use a different model, you'll get a dimension mismatch error.

| Model | Dimensions | Compatible? |
|---|---|---|
| nomic-embed-text (ollama) | 768 | **Yes** — this is what was used |
| nomic-embed-text (any provider) | 768 | **Yes** — same model, same vectors |
| Xenova/all-MiniLM-L6-v2 | 384 | No — dimension mismatch |
| text-embedding-3-small | 1536 | No — dimension mismatch |
