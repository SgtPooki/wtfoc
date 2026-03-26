# wtfoc

> What the FOC happened? Trace it.

**Cross-source knowledge tracing on [Filecoin Onchain Cloud](https://docs.filecoin.cloud).** Ingest from Slack, GitHub, docs, code, Discord, and Hacker News. Extract relationship edges. Trace evidence-backed connections across all sources — with verifiable, content-addressed citations stored on decentralized storage.

## Why

A customer complains in Slack. Someone files an issue. Someone else fixes it in a PR. These connections live in people's heads. When someone leaves, so does the context.

wtfoc makes those connections queryable. One trace surfaces the Slack complaint, the GitHub issue, the PR that fixed it, and the code that changed — all linked by extracted edges, not keyword matches.

## Try It Now

### Point Claude at the hosted MCP endpoint

No setup required. Add this to your Claude Code or Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "wtfoc": {
      "url": "https://wtfoc.xyz/mcp"
    }
  }
}
```

Then ask Claude: *"List the available wtfoc collections, then trace upload failures in the largest one"*

### Browse the web UI

Visit [wtfoc.xyz](https://wtfoc.xyz) to search and trace collections interactively, including a force-directed graph visualization of cross-source connections.

### Install agent skills

```bash
npx skills add SgtPooki/wtfoc
```

Installs `/trace-analyze`, `/collection-setup`, and `/drift-check` skills for Claude Code, Cursor, Codex, and other agents.

## Use the CLI

```bash
# Install globally (or use npx @wtfoc/cli)
npm install -g wtfoc

wtfoc ingest github FilOzone/synapse-sdk -c my-collection
wtfoc ingest slack ./exports/support.json -c my-collection
wtfoc ingest website https://docs.example.com -c my-collection

wtfoc trace "upload failures" -c my-collection
wtfoc trace "what to prioritize" -c my-collection --mode analytical
wtfoc query "session key auth" -c my-collection -k 20
```

## Run Your Own MCP Server

For local/private collections, run the MCP server on stdio:

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

## Self-Host the Web Server

Deploy the full web UI + REST API + MCP endpoint:

```bash
docker pull ghcr.io/sgtpooki/wtfoc
docker run -p 3577:3577 \
  -e WTFOC_EMBEDDER_URL=http://ollama:11434/v1 \
  -e WTFOC_EMBEDDER_MODEL=nomic-embed-text \
  -v ~/.wtfoc:/root/.wtfoc \
  ghcr.io/sgtpooki/wtfoc
```

The server exposes:
- **Web UI** at `/`
- **REST API** at `/api/collections`
- **MCP endpoint** at `/mcp` (Streamable HTTP, read-only)

## FOC for RAG

FOC is the immutable system of record for your knowledge base. Collections are content-addressed — any collection can be verified, shared by CID, rehydrated, and re-queried by anyone without trusting a central server. Embedders and vector indices stay swappable.

See [docs/foc-rag-storage.md](docs/foc-rag-storage.md) for the storage layout and CID reuse story.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@wtfoc/common`](packages/common/) | Shared types, interfaces, schemas | `npm i @wtfoc/common` |
| [`@wtfoc/store`](packages/store/) | Storage backends (local, FOC) + manifest management | `npm i @wtfoc/store` |
| [`@wtfoc/ingest`](packages/ingest/) | Source adapters + chunking + edge extraction | `npm i @wtfoc/ingest` |
| [`@wtfoc/search`](packages/search/) | Embedders + vector index + query + trace | `npm i @wtfoc/search` |
| [`@wtfoc/mcp-server`](packages/mcp-server/) | MCP server for Claude and other AI assistants | `npm i @wtfoc/mcp-server` |
| [`@wtfoc/cli`](packages/cli/) | CLI wrapping all packages | `npm i -g @wtfoc/cli` |

Every package is standalone. Use only what you need.

## Pluggable at Every Seam

wtfoc is built on interfaces, not implementations. Swap any component:

| Seam | Default | Swap to |
|------|---------|---------|
| **Embedder** | transformers.js (local) | OpenAI, Ollama, Cohere, vLLM |
| **Vector Index** | In-memory | Qdrant, Pinecone, Weaviate |
| **Storage** | Local filesystem | FOC (Filecoin-backed IPFS), S3, GCS |
| **Sources** | Slack, GitHub, Discord, HN, websites, code repos | Any `SourceAdapter` implementation |
| **Edge Extraction** | Regex-based | LLM-based, AST-based, custom |

See [SPEC.md](SPEC.md) for the full architecture.

## Demos

| Demo | What it shows |
|------|--------------|
| [Upload Flow Trace](docs/demos/upload-flow-trace/) | Map file upload across SDK code, GitHub issues, PRs, docs, and SP backend — 5 source types, ~16K chunks |

See [docs/user-stories.md](docs/user-stories.md) for the full story catalog.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, testing, and contribution guidelines.

## License

[MIT](LICENSE)
