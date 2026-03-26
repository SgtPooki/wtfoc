# FAQ

## Can I use my own embedder / OpenAI key / local models? Do I need to host everything myself?

**No, you don't need to host anything.** wtfoc works at three levels of self-hosting:

### Zero setup (hosted)

Point any MCP client at the hosted endpoint. No keys, no install:

```json
{
  "mcpServers": {
    "wtfoc": { "url": "https://wtfoc.xyz/mcp" }
  }
}
```

You can query any published collection by CID. The server handles embeddings.

### Local CLI (no external services)

```bash
npx wtfoc ingest repo my-org/my-repo -c my-collection
npx wtfoc trace "upload failures" -c my-collection
```

By default, wtfoc uses a built-in local embedder ([Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), 384 dimensions). It downloads once and runs entirely on your machine. No API key needed.

### Bring your own embedder

You can use **any OpenAI-compatible embedding API** — OpenAI, Ollama, LM Studio, or any `/v1/embeddings` endpoint:

```bash
# OpenAI
npx wtfoc ingest repo my-org/my-repo -c my-collection \
  --embedder-url https://api.openai.com/v1 \
  --embedder-model text-embedding-3-small \
  --embedder-key sk-...

# Local Ollama
npx wtfoc ingest repo my-org/my-repo -c my-collection \
  --embedder-url ollama \
  --embedder-model nomic-embed-text

# LM Studio
npx wtfoc ingest repo my-org/my-repo -c my-collection \
  --embedder-url lmstudio \
  --embedder-model mxbai-embed-large-v1
```

Or set environment variables instead of flags:

```bash
export WTFOC_EMBEDDER_URL=http://localhost:11434/v1
export WTFOC_EMBEDDER_MODEL=nomic-embed-text
```

**What do you need for quality data?** The built-in MiniLM embedder works for getting started. For production-quality results, use a higher-dimensional model like `nomic-embed-text` (768d) or `text-embedding-3-small` (1536d). Edge extraction also benefits from an LLM — you can use any OpenAI-compatible chat endpoint via `--extractor-url` and `--extractor-model`.

> Tracking: [#95 — Configurable embedding model profiles](https://github.com/SgtPooki/wtfoc/issues/95) covers future work on browser/server model parity and profile presets.

---

## How do I use wtfoc to analyze websites and research articles about a topic?

wtfoc has a `website` adapter that crawls and converts HTML to markdown. You can point it at documentation sites, blogs, or any public URL:

```bash
# Crawl a documentation site (follows same-domain links, up to 100 pages)
npx wtfoc ingest website https://docs.filecoin.cloud/ -c my-research

# Crawl multiple sites into the same collection
npx wtfoc ingest website https://docs.libp2p.io/ -c my-research
npx wtfoc ingest website https://blog.example.com/ -c my-research

# Add a Hacker News discussion search (no auth required)
npx wtfoc ingest hackernews "decentralized storage" -c my-research
```

Then trace connections across all of them:

```bash
npx wtfoc trace "what are the tradeoffs of content-addressed storage" \
  -c my-research --mode analytical
```

The `--mode analytical` flag (new in v0.0.3) detects cross-source insights — convergence across sources, evidence chains, and temporal clusters.

### Limitations and future work

- The website crawler uses Cheerio (no JavaScript rendering), so SPAs and dynamically-loaded content won't be captured.
- Crawl depth defaults to 100 pages. You can't yet control this from the CLI.
- There is no dedicated arXiv adapter yet — you can crawl arXiv abstract pages via the website adapter, but PDF content is not extracted.

> Tracking:
> - [#120 — Website crawler depth control](https://github.com/SgtPooki/wtfoc/issues/120)
> - [#125 — arXiv papers source adapter](https://github.com/SgtPooki/wtfoc/issues/125)

---

## How do I set up wtfoc to keep my LLM agent informed about all my team's projects, docs, and customer feedback?

This is wtfoc's core use case. Here's a full setup:

### 1. Ingest your team's sources

```bash
COLLECTION="my-team"

# Source code
npx wtfoc ingest repo my-org/api-service -c $COLLECTION --batch-size 200
npx wtfoc ingest repo my-org/web-app -c $COLLECTION --batch-size 200

# GitHub issues and PRs (last 6 months)
npx wtfoc ingest github my-org/api-service -c $COLLECTION --since 180d
npx wtfoc ingest github my-org/web-app -c $COLLECTION --since 180d

# Documentation sites
npx wtfoc ingest website https://docs.my-org.com/ -c $COLLECTION

# Slack channels (requires SLACK_BOT_TOKEN)
SLACK_BOT_TOKEN=xoxb-... npx wtfoc ingest slack general -c $COLLECTION
SLACK_BOT_TOKEN=xoxb-... npx wtfoc ingest slack customer-feedback -c $COLLECTION

# Discord (bot token or exported JSON)
WTFOC_DISCORD_TOKEN=... npx wtfoc ingest discord "My Server/support" -c $COLLECTION
```

### 2. Extract and materialize edges

Edges are the relationships between chunks — issue references, PR links, code dependencies. They turn isolated search results into connected traces.

```bash
# Extract edges using an LLM (any OpenAI-compatible endpoint)
npx wtfoc extract-edges -c $COLLECTION \
  --extractor-url http://localhost:4523/v1 \
  --extractor-model haiku

# Bake edges into segments for persistence
npx wtfoc materialize-edges -c $COLLECTION
```

### 3. Connect your LLM agent via MCP

Add to your Claude Code or Claude Desktop configuration:

```json
{
  "mcpServers": {
    "wtfoc": {
      "command": "npx",
      "args": ["@wtfoc/mcp-server"]
    }
  }
}
```

Now your agent can call `wtfoc_trace`, `wtfoc_query`, and `wtfoc_status` against your collection. Ask it things like:

- *"Trace customer complaints about upload failures across Slack and GitHub"*
- *"What features are customers asking for that we haven't started?"*
- *"Find all code related to the auth middleware rewrite"*

### 4. Keep it fresh (incremental ingestion)

wtfoc tracks cursors per source. Re-running the same ingest command only fetches new content:

```bash
# Only fetches issues/PRs created since last run
npx wtfoc ingest github my-org/api-service -c $COLLECTION
```

### Authentication requirements

| Source | Auth needed | How |
|--------|------------|-----|
| `repo` | None (public) or `gh` CLI (private) | `gh auth login` |
| `github` | `gh` CLI | `gh auth login` |
| `website` | None | Public URLs only |
| `slack` | Bot token | `SLACK_BOT_TOKEN=xoxb-...` |
| `discord` | Bot token or JSON export | `WTFOC_DISCORD_TOKEN=...` or path to exported JSON |
| `hackernews` | None | Uses Algolia API |

> Tracking:
> - [#118 — Deployable incremental ingestion service](https://github.com/SgtPooki/wtfoc/issues/118) for automated scheduled ingestion
> - [#62 — Distribute as Claude Code skill, npx skill, and MCP server](https://github.com/SgtPooki/wtfoc/issues/62)
> - [#33 — GitHub adapter: full data types + rate limiting](https://github.com/SgtPooki/wtfoc/issues/33)
