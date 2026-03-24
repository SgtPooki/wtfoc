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
# Re-install with prod-only deps, keeping pnpm workspace symlinks intact
FROM base AS production
COPY --from=build /app ./
RUN pnpm install --frozen-lockfile --prod
# Clean up source files, keep only dist
RUN find packages -name "src" -type d -exec rm -rf {} + 2>/dev/null; \
    rm -rf apps/web/src apps/web/server/*.ts apps/web/server/tsconfig.json; \
    rm -rf .git .claude .specify docs; \
    true

ENV WTFOC_PORT=3577
ENV WTFOC_WEB_DIR=/app/apps/web/dist
EXPOSE 3577

CMD ["node", "apps/web/server/dist/index.js"]
