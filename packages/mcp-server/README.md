# @wtfoc/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server that exposes wtfoc tools to Claude and other MCP-compatible AI assistants.

## Install

```bash
npm install @wtfoc/mcp-server
```

## Setup

Add to your Claude Code MCP configuration:

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

## Available Tools

| Tool | Description |
|------|-------------|
| `wtfoc_ingest` | Ingest a source into a collection |
| `wtfoc_query` | Semantic search across a collection |
| `wtfoc_trace` | Cross-source trace with edge following |
| `wtfoc_status` | Collection status and edge resolution stats |

## Usage with Claude

Once configured, Claude can use wtfoc tools directly:

> "Trace upload failures across the foc-ecosystem collection"

Claude will call `wtfoc_trace` with the query and collection, returning evidence-backed results from code, issues, PRs, Slack, and docs.

## Related Packages

- [`@wtfoc/cli`](../cli/) — Same capabilities via the command line
- [`@wtfoc/search`](../search/) — Query and trace engines used by the MCP tools
- [`@wtfoc/ingest`](../ingest/) — Source adapters used by `wtfoc_ingest`
- [`@wtfoc/store`](../store/) — Storage backend

## License

MIT
