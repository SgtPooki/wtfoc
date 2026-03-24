FROM node:24-slim AS base
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
WORKDIR /app

# ─── Install all deps (for building) ─────────────────────────────────────────
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

# ─── Build everything ────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm -r build && pnpm --filter @wtfoc/web build:server

# ─── Production: minimal runtime ─────────────────────────────────────────────
FROM base AS production

# Only include packages the server actually imports at runtime:
# @wtfoc/web (server), @wtfoc/common, @wtfoc/store, @wtfoc/search
COPY package.json pnpm-workspace.yaml ./

# Minimal pnpm-workspace that only includes what we need
RUN echo 'packages:\n  - "packages/common"\n  - "packages/store"\n  - "packages/search"\n  - "apps/web"' > pnpm-workspace.yaml

COPY --from=build /app/pnpm-lock.yaml ./
COPY packages/common/package.json packages/common/
COPY packages/store/package.json packages/store/
COPY packages/search/package.json packages/search/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --prod --filter @wtfoc/web...

# Copy built dist artifacts
COPY --from=build /app/packages/common/dist packages/common/dist
COPY --from=build /app/packages/store/dist packages/store/dist
COPY --from=build /app/packages/search/dist packages/search/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/web/server/dist apps/web/server/dist

ENV WTFOC_PORT=3577
ENV WTFOC_WEB_DIR=/app/apps/web/dist
EXPOSE 3577

CMD ["node", "apps/web/server/dist/index.js"]
