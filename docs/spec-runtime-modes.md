# Runtime Modes and Responsibilities

> Design notes for issue #109.

## Overview

wtfoc has three runtime modes. Each combines the same package-level building blocks
(`@wtfoc/common`, `@wtfoc/store`, `@wtfoc/search`, `@wtfoc/ingest`, `@wtfoc/mcp-server`)
but with different lifecycle and capability profiles.

## Runtime Modes

### 1. CLI One-Shot (`wtfoc <command>`)

| Property | Value |
|---|---|
| Lifecycle | Process-per-command; exits after completion |
| Entry point | `@wtfoc/cli` commands |
| Collection state | Fresh load from disk each invocation |
| Caching | None (process is ephemeral) |
| Write capability | Full (ingest, publish, etc.) |
| Read capability | Full (query, trace, status, edges, sources) |

**Responsibilities:**
- Parse CLI flags and dispatch to the correct operation.
- Load a single named collection per invocation.
- Run ingest pipelines (write path).
- Execute queries and traces (read path).

### 2. Web Server (`apps/web`)

| Property | Value |
|---|---|
| Lifecycle | Long-lived HTTP process |
| Entry point | `apps/web/server/index.ts` |
| Collection state | Lazy-loaded, cached in memory with headId-based freshness |
| Caching | Process-scoped `collectionCache` with automatic invalidation |
| Write capability | None (read-only) |
| Read capability | Full (query, trace, status, edges, sources) + MCP-over-HTTP |

**Responsibilities:**
- Serve the SPA (static files cached in memory at startup).
- Expose REST API for multi-collection query/trace/status/edges/sources.
- Expose CID-addressed collection access (IPFS via verified-fetch).
- Host the `/mcp` HTTP endpoint (stateless, read-only MCP-over-HTTP).
  Each POST creates a fresh `McpServer` + transport — no session state between requests.
- Manage collection cache lifecycle (lazy load, freshness checks).

**Read-only by design:** The web server never mutates collections. Ingest
runs via CLI or MCP stdio. The `/mcp` endpoint is explicitly `readOnly: true`.

### 3. MCP Stdio Server (`@wtfoc/mcp-server`)

| Property | Value |
|---|---|
| Lifecycle | Long-lived stdio process (hosted by AI assistant) |
| Entry point | `packages/mcp-server/src/index.ts` |
| Collection state | Fresh load per tool call (no cache) |
| Caching | None today; future: shared runtime cache |
| Write capability | Full (ingest via `wtfoc_ingest` tool) |
| Read capability | Full (query, trace, status, list) |

**Responsibilities:**
- Implement MCP protocol over stdin/stdout.
- Expose read tools: `wtfoc_query`, `wtfoc_trace`, `wtfoc_status`, `wtfoc_list_collections`.
- Expose write tools: `wtfoc_ingest`.
- Expose discovery tools: `wtfoc_list_sources` (read-only, lists available adapters).
- Create store and embedder singletons at startup.

## Shared vs Entry-Point-Specific Services

| Service | Shared across modes | Notes |
|---|---|---|
| `StorageBackend` | Yes — created via `createStore()` | All modes use the same local storage |
| `ManifestStore` | Yes — part of `createStore()` | All modes read/write the same manifest files |
| `Embedder` | Yes — created once per process | Configuration differs (CLI flags vs env vars) |
| `mountCollection` | Yes — canonical hydration path | All modes use `@wtfoc/search/mount` |
| Collection cache | Web server only | CLI is ephemeral; MCP stdio has no cache yet |
| Static file serving | Web server only | N/A for CLI and MCP |
| MCP protocol handling | MCP stdio + web `/mcp` | Web reuses `createMcpServer` from the package |

## Read-Only vs Write-Capable Surfaces

| Surface | Read | Write | Rationale |
|---|---|---|---|
| Web REST API | Yes | No | Public-facing; mutations happen out of band |
| Web `/mcp` endpoint | Yes | No | Shared infra; write path needs auth before exposure |
| MCP stdio | Yes | Yes | Single-user, local, trusted by the AI assistant |
| CLI | Yes | Yes | Direct user invocation |

**Policy:** Write capability requires either direct user invocation (CLI) or a
trusted single-user channel (stdio). Network-exposed surfaces remain read-only
until an authorization model is in place.

## Does Ingest Belong in the Server Runtime?

**No, not today.** Ingest is a batch operation that:
- May run for minutes (large repos, rate-limited APIs).
- Requires write access to storage and manifests.
- Benefits from CLI-level progress reporting and error handling.
- Has no need for low-latency serving.

Ingest runs via CLI commands or the MCP stdio `wtfoc_ingest` tool. The web
server detects changes through manifest freshness (headId comparison) and
reloads automatically.

**When to reconsider:** If users need to trigger ingest from the web UI or
through a webhook, add an ingest queue/worker rather than embedding it in
the serving runtime. This keeps the query path isolated from ingest resource
pressure.

## Criteria for Splitting Runtime Components

The single-process web server is appropriate while:

1. **Collection count stays low** (< ~50 named collections loaded concurrently).
2. **Memory fits in a single process** (< ~4 GB for all cached vector indices).
3. **Query latency is acceptable** without horizontal scaling.
4. **No write path** is exposed over HTTP.

Consider splitting when:

- **Memory pressure:** Many large collections exceed single-process limits.
  Split: dedicated collection-serving workers behind a load balancer.
- **Write path exposure:** Network-facing ingest needs isolation.
  Split: separate ingest worker with queue-based coordination.
- **MCP state sharing:** The stdio MCP server needs cached collection state.
  Split: shared cache layer (e.g., Unix socket or in-process if co-located).
- **Embedding latency:** Local embedder blocks the event loop for large batches.
  Split: embedder as a sidecar service (already supported via OpenAI-compatible API).
