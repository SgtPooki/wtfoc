FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
WORKDIR /app

# ─── Install dependencies ────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common/package.json packages/common/
COPY packages/store/package.json packages/store/
COPY packages/ingest/package.json packages/ingest/
COPY packages/search/package.json packages/search/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/wtfoc/package.json packages/wtfoc/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# ─── Build all packages ──────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm -r build
RUN pnpm --filter @wtfoc/web build:server

# ─── Production image ────────────────────────────────────────────────────────
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=deps /app/packages/store/node_modules ./packages/store/node_modules
COPY --from=deps /app/packages/search/node_modules ./packages/search/node_modules

# Copy built packages
COPY --from=build /app/packages/common/dist ./packages/common/dist
COPY --from=build /app/packages/common/package.json ./packages/common/
COPY --from=build /app/packages/store/dist ./packages/store/dist
COPY --from=build /app/packages/store/package.json ./packages/store/
COPY --from=build /app/packages/search/dist ./packages/search/dist
COPY --from=build /app/packages/search/package.json ./packages/search/
COPY --from=build /app/packages/ingest/dist ./packages/ingest/dist
COPY --from=build /app/packages/ingest/package.json ./packages/ingest/

# Copy web app (SPA + server)
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/server/dist ./apps/web/server/dist
COPY --from=build /app/apps/web/package.json ./apps/web/

# Copy workspace config for pnpm resolution
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

ENV WTFOC_PORT=3577
ENV WTFOC_WEB_DIR=/app/apps/web/dist
EXPOSE 3577

CMD ["node", "apps/web/server/dist/index.js"]
