# Demo: Full Stack — MCP + Web UI + Claude Integration

The hero demo. Claude uses `wtfoc` as a tool to answer architecture questions while the web UI shows the same data as an interactive D3 graph.

## The Point

You ask Claude "How does upload work end-to-end?" and Claude uses `wtfoc_trace` via MCP to answer — reconstructing the full story from SDK code, GitHub issues, PRs, and docs — all with confidence scores and evidence URLs. Meanwhile, the web UI shows the cross-source connection graph visually.

The killer moment: Claude finds a real open bug while answering your architecture question. That's decentralized AI memory made real.

## Prerequisites

1. A pre-built collection (run the upload-flow-trace demo first)
2. Claude Desktop with MCP configured
3. The wtfoc web server running

## Setup

### 1. Build the collection

```bash
./docs/demos/upload-flow-trace/run.sh
```

This creates the `foc-upload-flow` collection with ~16K chunks across 5 source types.

### 2. Start the web UI

```bash
./wtfoc serve -c foc-upload-flow
```

Open http://localhost:3577 — you should see the collection picker and search bar.

### 3. Configure Claude Desktop MCP

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wtfoc": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "cwd": "/path/to/wtfoc"
    }
  }
}
```

Restart Claude Desktop. You should see `wtfoc` tools available (trace, query, status, etc.).

## The Demo Arc

### Beat 1: Ask Claude the architecture question

In Claude Desktop, ask:

> "Trace how an upload works end-to-end through the FOC stack using the foc-upload-flow collection"

Watch Claude call `wtfoc_trace` — it surfaces:
- `StorageManager.upload()` as the entry point
- The three-phase pipeline: store, pull, commit
- Real GitHub URLs for issues and PRs
- The open DX friction issue (filecoin-pin#372)

**Analytical mode bonus:** Use `--mode analytical` for synthesis queries like "what to prioritize?" This adds cross-source insights — convergence (multiple source types discuss the same topic), evidence chains (Slack → Issue → PR → Code trails), and temporal clusters (recent activity spikes).

### Beat 2: Show the web UI simultaneously

While Claude is responding, switch to the browser at http://localhost:3577:
- Run the same trace query in the search bar
- The D3 connection graph shows cross-source edges visually
- Nodes are colored by source type (code=green, issue=orange, PR=purple, doc=blue)

### Beat 3: Ask Claude for gap analysis

> "What sources am I missing? Run suggest-sources on the foc-upload-flow collection"

Claude calls `wtfoc_list_collections` + uses its knowledge to suggest what to ingest next.

### Beat 4: Theme discovery

> "What are the main themes in this collection?"

Claude can explain the themes in natural language while the raw `themes` output provides the mathematical backing.

## The Demo Line

> "I asked Claude 'how does upload work?' and it used wtfoc as a tool to trace the answer across 4 repos, 2 doc sites, and 90 days of GitHub activity. It found the entry point, the three-phase pipeline, and a real open bug — all without me typing a single wtfoc command. The web UI shows the same evidence as an interactive graph."

## Tips for Recording

- **Pre-bake the collection** the night before to avoid live ingest delays
- Run `./wtfoc themes -c foc-upload-flow` beforehand so you know which themes will appear
- Keep the web UI open in a split screen while Claude responds
- The existing [upload-flow-trace README](../upload-flow-trace/README.md) has pre-documented trace results you can narrate

## Quick Reference

| Command | Purpose |
|---------|---------|
| `./docs/demos/upload-flow-trace/run.sh` | Build the collection |
| `./wtfoc serve -c foc-upload-flow` | Start web UI |
| `./wtfoc trace "query" -c foc-upload-flow --mode analytical` | Trace with cross-source insights |
| `./wtfoc themes -c foc-upload-flow` | Preview themes |
| `./wtfoc suggest-sources -c foc-upload-flow` | Preview gap analysis |
| `./wtfoc status -c foc-upload-flow` | Check collection stats |
