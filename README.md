# wtfoc

> What the FOC happened? Trace it.

**wtfoc is a cross-source trace engine for engineering context.** It helps teams and agents answer why something happened across code, issues, docs, and conversations with explicit, evidence-backed links instead of keyword matches alone.

Use it when search is not enough and you need the chain: the Slack complaint, the GitHub issue, the PR that fixed it, the code that changed, and the docs that were updated.

**Learn more:** [Why wtfoc?](docs/why.md) | [Vision & North-Star Goals](docs/vision.md) | [Pipeline Architecture](docs/pipeline-architecture.md)

## Search vs Trace

Most tools stop at search: find chunks that look similar to the query.

wtfoc does both:

- **`query`** finds semantically relevant chunks.
- **`trace`** follows explicit edges across sources so you can see how artifacts connect and why they matter.

That makes it useful for questions like:

- What was the full context behind this bug fix?
- Which discussions led to this architecture decision?
- What customer feedback, issues, PRs, and docs connect to this feature?
- If I change this API, what else is affected?

## Choose Your Path

### Hosted MCP

No setup required. Point Claude Code or Claude Desktop at the hosted endpoint:

```json
{
  "mcpServers": {
    "wtfoc": {
      "url": "https://wtfoc.xyz/mcp"
    }
  }
}
```

> **Note:** `https://wtfoc.xyz/mcp` is read-only. You can use it to list available hosted collections and run query/trace workflows, but you cannot ingest data or create collections through the hosted MCP endpoint. To ingest data or build your own collection, use the CLI flow below with a local or self-hosted deployment.

Then ask:

> List the available wtfoc collections, then trace upload failures in the largest one.

### CLI

Use the CLI when you want to build and inspect your own local or private collection.

```bash
# Install globally (or use npx @wtfoc/cli)
npm install -g @wtfoc/cli

wtfoc ingest github FilOzone/synapse-sdk -c my-collection
wtfoc ingest slack ./exports/support.json -c my-collection
wtfoc ingest website https://docs.example.com -c my-collection

wtfoc trace "upload failures" -c my-collection
wtfoc trace "what should we prioritize next?" -c my-collection --mode analytical
wtfoc query "session key auth" -c my-collection -k 20
```

### Self-Host

Deploy the web UI, REST API, and MCP endpoint yourself:

```bash
docker pull ghcr.io/sgtpooki/wtfoc
docker run -p 3577:3577 \
  -e WTFOC_EMBEDDER_URL=http://ollama:11434/v1 \
  -e WTFOC_EMBEDDER_MODEL=nomic-embed-text \
  -v ~/.wtfoc:/root/.wtfoc \
  ghcr.io/sgtpooki/wtfoc
```

The container exposes:

- **Web UI** at `/`
- **REST API** at `/api/collections`
- **MCP endpoint** at `/mcp` (read-only: query/trace only)

You can also browse the hosted UI at [wtfoc.xyz](https://wtfoc.xyz).

## What Makes wtfoc Different

### Evidence-Backed Edges

wtfoc does not treat your corpus as a bag of chunks. It extracts typed relationships between artifacts so trace can walk from one source to another with evidence and provenance.

### Portable, Shareable Collections

Collections can be stored locally or on [Filecoin Onchain Cloud](https://docs.filecoin.cloud). FOC is the best default for portable, content-addressed knowledge artifacts, but it is not required. The storage layer stays swappable.

### Living Knowledge, Not Disposable Indexes

Useful computed results should persist with the collection. Chunks, embeddings, edges, and other derived analysis travel with the artifact so another agent or teammate can continue improving it instead of rebuilding from scratch.

### Pluggable by Design

wtfoc is built around interfaces. You can swap embedders, vector indexes, storage backends, source adapters, manifest stores, and edge extractors without changing the whole stack.

## What Works Today

wtfoc already gives you a real path to:

- ingest source material into a collection
- run semantic query and cross-source trace workflows
- use it from the CLI, a hosted MCP endpoint, or a self-hosted server
- store collections locally or through the FOC-backed storage path

For broader north-star direction, read [docs/vision.md](docs/vision.md). The README stays focused on the current front door and concrete ways to try the project.

## Example Trace

The [Upload Flow Trace demo](docs/demos/upload-flow-trace/) follows a real cross-source story through SDK code, GitHub issues, pull requests, documentation, and backend behavior. It shows the kind of evidence chain `trace` is meant to surface when a simple nearest-neighbor search is not enough.

See [docs/user-stories.md](docs/user-stories.md) for more example workflows and story coverage.

## Run Your Own MCP Server

For local or private collections, run the MCP server on stdio:

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

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@wtfoc/common`](packages/common/) | Shared types, interfaces, schemas | `npm i @wtfoc/common` |
| [`@wtfoc/store`](packages/store/) | Storage backends and manifest management | `npm i @wtfoc/store` |
| [`@wtfoc/ingest`](packages/ingest/) | Source adapters, chunking, and edge extraction | `npm i @wtfoc/ingest` |
| [`@wtfoc/search`](packages/search/) | Embedders, vector index, query, and trace | `npm i @wtfoc/search` |
| [`@wtfoc/mcp-server`](packages/mcp-server/) | MCP server for AI assistants | `npm i @wtfoc/mcp-server` |
| [`@wtfoc/cli`](packages/cli/) | CLI that composes the full stack | `npm i -g @wtfoc/cli` |

Every package is standalone. Use only what you need.

## Core Seams

wtfoc is built on interfaces, not hard lock-in. Core seams include:

| Seam | Default | Swap to |
|------|---------|---------|
| **Embedder** | transformers.js (local) | OpenAI, Ollama, Cohere, vLLM |
| **Vector Index** | In-memory | Qdrant, Pinecone, Weaviate |
| **Storage Backend** | FOC or local filesystem | S3, GCS, other blob stores |
| **Source Adapter** | Built-in source adapters | Custom adapters |
| **Manifest Store** | Built-in manifest handling | Custom mutable index implementations |
| **Edge Extractor** | Regex-based defaults | LLM-based, AST-based, custom |

See [SPEC.md](SPEC.md) for the full architecture and project invariants.

## More Docs

- [docs/why.md](docs/why.md)
- [docs/vision.md](docs/vision.md)
- [docs/pipeline-architecture.md](docs/pipeline-architecture.md)
- [docs/foc-rag-storage.md](docs/foc-rag-storage.md)
- [docs/demos/README.md](docs/demos/README.md)

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, testing, and contribution guidelines.

## License

[MIT](LICENSE)
