FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
WORKDIR /app

# ─── Install all deps (for building) ─────────────────────────────────────────
FROM base AS deps
# prebuild-install needs curl to download prebuilt native addons (node-datachannel)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common/package.json packages/common/
COPY packages/config/package.json packages/config/
COPY packages/store/package.json packages/store/
COPY packages/ingest/package.json packages/ingest/
COPY packages/search/package.json packages/search/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/wtfoc/package.json packages/wtfoc/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# ─── Build everything ────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm -r build && pnpm --filter @wtfoc/web build:server

# Prune unused deps (keep @huggingface/transformers + onnxruntime for local embedder)
# Replace sharp with a checked-in ESM stub — transformers.js imports it at top-level
# but only uses it for image processing, not text embeddings. The real sharp
# requires x86-64-v2 CPU support which our KVM worker nodes lack.
RUN rm -rf node_modules/.pnpm/sharp@* node_modules/.pnpm/@img* \
    && find node_modules/.pnpm -path '*/node_modules/sharp' \( -type l -o -type d \) \
         -exec sh -ec 'rm -rf "$1"; mkdir -p "$1"; cp -a docker/sharp-stub/. "$1/"' _ {} \; \
    && test "$(find node_modules/.pnpm -path '*/node_modules/sharp/package.json' | wc -l)" -ge 1 \
       || (echo "sharp stub: expected stub package.json under a sharp path (pnpm layout changed?)" >&2; exit 1) \
    && rm -rf node_modules/.pnpm/@assemblyscript* \
    node_modules/.pnpm/@babel* \
    node_modules/.pnpm/@xenova* \
    node_modules/.pnpm/protobufjs* \
    node_modules/.pnpm/@filoz* \
    node_modules/.pnpm/viem* \
    node_modules/.pnpm/ox@* \
    node_modules/.pnpm/abitype* \
    node_modules/.pnpm/filecoin-pin* \
    node_modules/.pnpm/pino* \
    node_modules/.pnpm/@types* \
    node_modules/.pnpm/typescript* \
    node_modules/.pnpm/@biomejs* \
    node_modules/.pnpm/vitest* \
    node_modules/.pnpm/@vitest* \
    node_modules/.pnpm/esbuild*
    # NOTE: do NOT prune crawlee / @crawlee / playwright / cheerio / puppeteer.
    # @wtfoc/ingest barrel re-exports WebsiteAdapter which imports crawlee at
    # module level, so any `import "@wtfoc/ingest"` in the web server (promote /
    # ingest workers) eagerly resolves the whole chain. Pruning them causes
    # ERR_MODULE_NOT_FOUND on container start.

# ─── Production image ────────────────────────────────────────────────────────
FROM node:24-slim AS production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/common/package.json packages/common/
COPY --from=build /app/packages/common/dist packages/common/dist
COPY --from=build /app/packages/common/node_modules packages/common/node_modules
COPY --from=build /app/packages/store/package.json packages/store/
COPY --from=build /app/packages/store/dist packages/store/dist
COPY --from=build /app/packages/store/node_modules packages/store/node_modules
COPY --from=build /app/packages/ingest/package.json packages/ingest/
COPY --from=build /app/packages/ingest/dist packages/ingest/dist
COPY --from=build /app/packages/ingest/node_modules packages/ingest/node_modules
COPY --from=build /app/packages/search/package.json packages/search/
COPY --from=build /app/packages/search/dist packages/search/dist
COPY --from=build /app/packages/search/node_modules packages/search/node_modules
COPY --from=build /app/packages/mcp-server/package.json packages/mcp-server/
COPY --from=build /app/packages/mcp-server/dist packages/mcp-server/dist
COPY --from=build /app/packages/mcp-server/node_modules packages/mcp-server/node_modules
COPY --from=build /app/packages/config/package.json packages/config/
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/config/node_modules packages/config/node_modules
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/web/server/dist apps/web/server/dist
COPY --from=build /app/apps/web/node_modules apps/web/node_modules

ENV WTFOC_PORT=3577
ENV WTFOC_WEB_DIR=/app/apps/web/dist
EXPOSE 3577

CMD ["node", "apps/web/server/dist/index.js"]
