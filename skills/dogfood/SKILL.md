---
name: dogfood
description: Build a wtfoc collection from the wtfoc repo itself and run quality checks to find bugs and improvements
allowed-tools: Bash, Read, Grep, Glob, Agent
metadata:
  short-description: Dogfood wtfoc by indexing its own repo
  internal: true
---

# /dogfood

Build a wtfoc collection from the wtfoc repo itself, test every major feature, and open GitHub issues for concrete problems found. This skill is for internal repo development only.

## Arguments

- `--collection <name>` — collection name (default: `wtfoc-source-dogfood`)
- `--skip-ingest` — skip ingestion, use an existing collection
- `--skip-issues` — analyze but don't open GitHub issues

## Service selection (interactive)

Before ingesting, ask the user which services to use. Probe for available services first, then present options and let the user choose.

### Embedder

Ask: **"Which embedder would you like to use?"**

Probe for what's available:
```bash
# Check for local ollama
curl -sf http://localhost:11434/api/tags 2>/dev/null && echo "ollama: available" || echo "ollama: not found"
# Check for the local transformers.js fallback (always available, slower)
echo "local (Xenova/all-MiniLM-L6-v2): always available"
```

Present options:
1. **ollama** (if detected) — fast, good quality. Needs a model like `nomic-embed-text`. Check which models are loaded and suggest one.
2. **Local transformers.js** — no setup needed, uses `Xenova/all-MiniLM-L6-v2` (384 dims). Slower but zero dependencies.
3. **Custom API endpoint** — ask for URL, model name, and API key.

Store the user's choice as variables for later steps:
- `EMBEDDER_TYPE`: `local` or `api`
- `EMBEDDER_URL`: e.g., `ollama`, `http://...`, or empty for local
- `EMBEDDER_MODEL`: e.g., `nomic-embed-text`, or empty for local default
- `EMBEDDER_FLAGS`: the CLI flags string, e.g., `--embedder api --embedder-url ollama --embedder-model nomic-embed-text`
- `EMBEDDER_ENV`: env vars for commands that don't accept flags, e.g., `WTFOC_EMBEDDER=api WTFOC_EMBEDDER_URL=ollama WTFOC_EMBEDDER_MODEL=nomic-embed-text`

### LLM (for edge extraction)

Ask: **"Which LLM would you like to use for edge extraction?"**

Probe for what's available:
```bash
# Check for claude-direct-proxy (uses Claude Code OAuth token, no API key needed)
curl -sf http://localhost:4523/health 2>/dev/null && echo "claude-proxy: running" || echo "claude-proxy: not running"
# Check for ollama chat models
curl -sf http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(f'  ollama: {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null
```

Present options:
1. **Claude (via claude-direct-proxy)** — uses your Claude Code subscription. If not running, offer to start it:
   ```bash
   node scripts/claude-direct-proxy.mjs &
   ```
   Wait for it to be healthy, then use `--extractor-url http://localhost:4523/v1 --extractor-model haiku`.
   Note: the `/v1` suffix is required (see #189).
2. **Ollama** (if chat models detected) — free, local. Use `--extractor-url http://localhost:11434/v1 --extractor-model <model>`.
3. **OpenAI / custom API** — ask for URL, model, and API key.
4. **Skip edge extraction** — faster but no LLM-derived edges. Only heuristic/regex edges will be used.

If the user picks Claude and the proxy isn't running, start it and verify:
```bash
node scripts/claude-direct-proxy.mjs &>/tmp/claude-proxy.log &
sleep 2
curl -sf http://localhost:4523/health || echo "ERROR: proxy failed to start"
```

If the proxy fails (e.g., no OAuth token), tell the user to run any `claude` command first to authenticate, or ask them to set `ANTHROPIC_API_KEY` and provide a direct Anthropic API URL instead.

Store:
- `EXTRACTOR_FLAGS`: e.g., `--extractor-enabled --extractor-url http://localhost:4523/v1 --extractor-model haiku`, or empty if skipped
- `EXTRACTOR_ENABLED`: `true` or `false`

### Tree-sitter sidecar

Ask: **"Enable tree-sitter for AST-based code analysis? (recommended)"**

```bash
# Check if already running
curl -sf http://localhost:8384/health 2>/dev/null && echo "tree-sitter: running" || echo "tree-sitter: not running"
# Check if docker is available
docker info &>/dev/null && echo "docker: available" || echo "docker: not available"
```

Options:
1. **Yes, start it** (if docker available) — `docker compose up tree-sitter-parser -d`, then verify health.
2. **Already running** (if health check passed) — use it.
3. **Skip** — no AST edges, plain text chunking only. Fine for a quick test.

Store:
- `TREE_SITTER_FLAGS`: e.g., `--tree-sitter-url http://localhost:8384`, or empty if skipped

**After all three choices are made**, confirm the configuration with the user before proceeding:
```
Embedder:     <choice>
LLM:          <choice>
Tree-sitter:  <choice>
Collection:   <name>
```

## Steps

### 1. Build from latest source

```bash
git pull origin main
pnpm build
```

Verify the CLI works:
```bash
node packages/cli/dist/cli.js --version
```

### 2. Ingest the repo (skip if `--skip-ingest`)

Create a fresh collection with repo source + GitHub source. Use the embedder, tree-sitter, and extractor flags chosen in the service selection step.

```bash
# Initialize
node packages/cli/dist/cli.js init <collection> --local

# Ingest repo source code
node packages/cli/dist/cli.js ingest repo . \
  -c <collection> \
  --description "wtfoc monorepo — CLI, MCP server, web UI, store, search, ingest packages. Self-indexed for dogfooding." \
  $EMBEDDER_FLAGS \
  $TREE_SITTER_FLAGS \
  $EXTRACTOR_FLAGS \
  --ignore "node_modules" --ignore "dist" --ignore "*.lock" --ignore ".git"

# Ingest GitHub issues and PRs
node packages/cli/dist/cli.js ingest github SgtPooki/wtfoc \
  -c <collection> \
  $EMBEDDER_FLAGS
```

Record the chunk counts from each ingest step.

### 3. Run LLM edge extraction (skip if `EXTRACTOR_ENABLED` is false)

If the user chose to skip LLM extraction in service selection, skip to step 4.

**Critical known issue:** The LLM client builds URLs as `baseUrl/chat/completions`. If your endpoint expects `/v1/chat/completions`, you must pass the URL with `/v1` suffix (e.g., `http://localhost:4523/v1`). See issue #189.

If extraction was not already done during ingest (i.e., `--extractor-enabled` was not in `EXTRACTOR_FLAGS`), run it separately:

```bash
node packages/cli/dist/cli.js extract-edges \
  -c <collection> \
  $EXTRACTOR_FLAGS \
  --extractor-concurrency 4
```

**After extraction, verify edges were actually produced.** If the overlay shows 0 edges, something went wrong silently (see known issue above). Check:
```bash
python3 -c "import json; d=json.load(open('$HOME/.wtfoc/projects/<collection>.edges-overlay.json')); print(f'Edges: {len(d.get(\"edges\",[]))}')"
```

If 0 edges: the LLM endpoint likely returned errors that were silently swallowed. Reset extraction status and retry with corrected URL:
```bash
python3 -c "
import json
path = '$HOME/.wtfoc/projects/<collection>.extraction-status.json'
d = json.load(open(path))
d['contexts'] = {}
json.dump(d, open(path, 'w'), indent=2)
"
```

Common causes of 0 edges:
- Missing `/v1` in extractor URL (#189)
- Proxy not running or wrong port
- Model name doesn't match what the server has loaded

### 4. Materialize edges

```bash
node packages/cli/dist/cli.js materialize-edges -c <collection>
```

### 5. Run the quality test suite

Run each test and record results. Every failure is a potential issue to file.

#### 5a. Collection listing (tests `listProjects`)

```bash
node packages/cli/dist/cli.js collections --json 2>&1
```

Known issue: crashes if sidecar JSON files exist in projects dir (#188). Record whether it crashes or works.

#### 5b. Status check

```bash
node packages/cli/dist/cli.js status -c <collection>
```

Record: chunk count, segment count, embedding model, timestamps.

#### 5c. Semantic queries (tests relevance)

Run these dogfooding queries that exercise different retrieval scenarios:

```bash
# Bug tracking — should find the actual fix
node packages/cli/dist/cli.js query "Qdrant JSON parse errors with unpaired surrogates" -c <collection> $EMBEDDER_FLAGS

# Feature discovery — should find issue + PR + code
node packages/cli/dist/cli.js query "website crawling and depth limiting" -c <collection> $EMBEDDER_FLAGS

# Architecture — should find code + docs
node packages/cli/dist/cli.js query "how are segments stored and what is a segment" -c <collection> $EMBEDDER_FLAGS

# Cross-cutting concern — should find PR + code + docs
node packages/cli/dist/cli.js query "how does incremental ingest cursor work" -c <collection> $EMBEDDER_FLAGS

# Error handling — should find code + issues
node packages/cli/dist/cli.js query "what happens when embedding fails" -c <collection> $EMBEDDER_FLAGS
```

For each query, check:
- Are results relevant? (score > 0.65 for top results)
- Do results span multiple source types? (code, github-*, markdown)
- Are the top 3 results genuinely the best matches?

#### 5d. Trace (tests edge traversal)

```bash
node packages/cli/dist/cli.js trace "how does edge extraction work" \
  -c <collection> $EMBEDDER_FLAGS
```

Check: Does the trace follow edges across source types? Are hops connected logically?

#### 5e. JSON output cleanliness

```bash
node packages/cli/dist/cli.js query "test" -c <collection> $EMBEDDER_FLAGS --json 2>/dev/null | head -1
```

If the first line is not `{` or `[`, there's stdout pollution (#190).

#### 5f. Unresolved edges (tests edge quality)

```bash
node packages/cli/dist/cli.js unresolved-edges -c <collection> --json 2>&1
```

Record: total edges, resolved count, unresolved count, resolution percentage. If resolution is below 50%, the edge extraction or normalization needs work (#193).

Check `unresolvedByRepo` for:
- Placeholder repos like `owner/repo` (#192)
- Same repo in multiple formats (`X/Y`, `github.com/X/Y`, `https://github.com/X/Y`)

#### 5g. Suggest-sources (tests reference parsing)

```bash
node packages/cli/dist/cli.js suggest-sources -c <collection> --json 2>&1
```

Check for placeholder repos in `suggestedRepos` (#192).

#### 5h. Themes (tests clustering)

```bash
$EMBEDDER_ENV \
node packages/cli/dist/cli.js themes -c <collection> --dry-run
```

Note: `themes` doesn't accept `--embedder` flags (#191), so env vars (`$EMBEDDER_ENV` from service selection) are required. Check that clusters are meaningful and labels make sense.

#### 5i. Local MCP server (tests MCP protocol)

Test the MCP server via stdio:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"dogfood","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"wtfoc_list_collections","arguments":{}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"wtfoc_status","arguments":{"collection":"<collection>"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"wtfoc_query","arguments":{"queryText":"how does ingest work","collection":"<collection>","topK":3}}}' | \
$EMBEDDER_ENV \
node packages/mcp-server/dist/index.js 2>/dev/null
```

For each response, check:
- `list_collections`: Does it return without error? (Known issue #188)
- `status`: Does it show correct chunk/segment counts?
- `query`: Does it return relevant results with scores?

### 6. Compile findings and open issues (skip if `--skip-issues`)

For each failure or quality problem found in step 5, check if a GitHub issue already exists:

```bash
gh issue list --repo SgtPooki/wtfoc --state open --search "<keywords>" --limit 5
```

If no existing issue covers the finding, open one with:
- Clear problem statement
- Evidence from the dogfood run (commands, output, expected vs actual)
- Suggested fix if apparent
- Tag with "Found during dogfooding" at the bottom

### 7. Summary report

Output a structured summary:

```
## Dogfood Report: <collection>

### Collection stats
- Chunks: X (Y repo + Z github)
- Segments: N
- Edges: total / resolved / unresolved (resolution %)
- Embedding model: <model>

### Test results
| Test | Status | Notes |
|------|--------|-------|
| collections | pass/fail | ... |
| status | pass/fail | ... |
| query relevance | pass/fail | ... |
| trace traversal | pass/fail | ... |
| JSON output | pass/fail | ... |
| edge resolution | pass/fail | X% resolved |
| suggest-sources | pass/fail | ... |
| themes | pass/fail | ... |
| MCP server | pass/fail | ... |

### Issues opened
- #NNN: title
- #NNN: title

### Previously known issues confirmed
- #NNN: title (still reproduces)
```
