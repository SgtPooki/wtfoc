# Research: Fix Docker Image for Hosted MCP Web Server

## R-001: Which workspace packages are missing from the production image?

**Decision**: Add `packages/config` and `packages/ingest` to the production stage COPY block.

**Rationale**: The Dockerfile's production stage (lines 56-83) copies common, store, search, mcp-server, and apps/web — but omits config and ingest. The mcp-server package has:
- Static import of `@wtfoc/config` in `src/index.ts` (line 5)
- Dynamic import of `@wtfoc/ingest` in `src/server.ts` (lines 146, 169)

Both are built during the `build` stage but never copied to production.

**Alternatives considered**:
- Bundling mcp-server with its deps into a single file — rejected because the workspace uses pnpm symlinks and the existing pattern is to copy each package individually.
- Only adding config (since ingest is dynamically imported for write-mode tools) — rejected because the module must still be resolvable even if the dynamic import path is never reached; Node.js module resolution can still fail at startup depending on how the server initializes.

## R-002: Will adding ingest bring in heavy pruned dependencies?

**Decision**: No. The ingest package's `node_modules` contains workspace symlinks to its dependencies, but the heavy native deps (crawlee, discord.js, sharp) are pruned from the root `node_modules/.pnpm` in the build stage. The symlinks will be dangling, which is fine since the web server runs in `readOnly: true` mode and never invokes the ingest tools that use those deps.

**Rationale**: The build stage (lines 29-54) removes crawlee, @crawlee, playwright, cheerio, puppeteer from `node_modules/.pnpm`. The ingest package's own `node_modules` just has pnpm workspace symlinks. Only the compiled JS in `dist/` and the `package.json` are needed for module resolution.

**Alternatives considered**: Not copying ingest at all — rejected because if the import path is ever reached (even erroneously), a clear "module X not found within @wtfoc/ingest" error is better than "@wtfoc/ingest not found".

## R-003: Does packages/config need a node_modules directory?

**Decision**: Yes, follow the same COPY pattern as other packages (package.json, dist, node_modules). If the package has no runtime deps beyond workspace peers, the node_modules directory may be empty or contain only symlinks, but copying it is harmless and consistent.

**Rationale**: Consistency with the existing COPY pattern for common, store, search, mcp-server reduces cognitive overhead and prevents subtle breakage.
