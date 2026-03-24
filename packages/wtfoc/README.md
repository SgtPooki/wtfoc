# wtfoc

> What the FOC happened? Trace it.

Convenience package that installs the [wtfoc CLI](../cli/) — a cross-source knowledge graph that traces questions across code, issues, PRs, docs, Slack, and Discord.

## Install

```bash
npm install -g wtfoc
```

This is equivalent to `npm install -g @wtfoc/cli`. Use whichever you prefer.

## Quick Start

```bash
# Ingest sources
wtfoc ingest github FilOzone/synapse-sdk -c my-collection
wtfoc ingest slack ./exports/support.json -c my-collection

# Trace a question across all sources
wtfoc trace "upload failures" -c my-collection

# Serve the web UI
wtfoc serve -c my-collection
```

## Packages

wtfoc is modular — use only what you need:

| Package | Description |
|---------|-------------|
| [`@wtfoc/common`](../common/) | Shared types, interfaces, schemas |
| [`@wtfoc/store`](../store/) | Storage backends (local, FOC) + collection management |
| [`@wtfoc/ingest`](../ingest/) | Source adapters + chunking + edge extraction |
| [`@wtfoc/search`](../search/) | Embedder + vector index + query + trace |
| [`@wtfoc/cli`](../cli/) | Full CLI |
| [`@wtfoc/mcp-server`](../mcp-server/) | MCP server for Claude integration |

## Learn More

See the [main README](https://github.com/SgtPooki/wtfoc#readme) for architecture, demos, and development setup.

## License

MIT
