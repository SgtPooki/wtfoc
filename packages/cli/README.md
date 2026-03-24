# @wtfoc/cli

Command-line interface for the [wtfoc](https://github.com/SgtPooki/wtfoc) knowledge graph.

## Install

```bash
npm install -g @wtfoc/cli
```

Or use the convenience package:

```bash
npm install -g wtfoc
```

## Commands

```bash
# Ingest sources into a collection
wtfoc ingest github FilOzone/synapse-sdk -c my-collection
wtfoc ingest slack ./exports/support.json -c my-collection
wtfoc ingest repo ./my-project -c my-collection
wtfoc ingest discord ./exports/general.json -c my-collection
wtfoc ingest website https://docs.example.com -c my-collection

# Semantic search
wtfoc query "upload failures" -c my-collection

# Cross-source trace — follow edges across all sources
wtfoc trace "upload failures" -c my-collection

# Collection status and edge resolution stats
wtfoc status -c my-collection

# Serve the web UI
wtfoc serve -c my-collection --port 3000
```

## Options

| Flag | Description |
|------|-------------|
| `--collection, -c` | Collection name |
| `--storage` | Storage backend: `local` (default) or `foc` |
| `--embedder` | Embedder: `transformers` (default, local) or `openai` |
| `--json` | Output as JSON |
| `--quiet` | Suppress output (errors only) |

## Related Packages

- [`@wtfoc/ingest`](../ingest/) — Source adapters used by `ingest` commands
- [`@wtfoc/search`](../search/) — Query and trace engines
- [`@wtfoc/store`](../store/) — Storage backends
- [`@wtfoc/mcp-server`](../mcp-server/) — Use wtfoc tools from Claude via MCP

## License

MIT
