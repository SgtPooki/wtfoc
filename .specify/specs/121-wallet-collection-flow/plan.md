# Implementation Plan: Wallet-Connected Collection Creation Flow

**Branch**: `121-wallet-collection-flow` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/121-wallet-collection-flow/spec.md`

## Summary

Add a wallet-connected collection creation flow to the wtfoc.xyz hosted UI. Users connect their Ethereum wallet, delegate a scoped session key to the server, create collections from public sources (GitHub repos, websites, HackerNews threads), monitor async ingestion, and promote to FOC. The server performs all heavy operations (ingest, bundle, upload, on-chain write) using the delegated session key. Two-layer auth: SIWE + session cookie for API access, session key for FOC writes. Postgres persistence for production, in-memory fallback for local dev.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >= 24
**Primary Dependencies**: Preact 10.x + @preact/signals (frontend), Hono (server routing), wagmi + viem (wallet connection), pg (Postgres), @filoz/synapse-sdk + filecoin-pin (FOC), siwe (wallet auth)
**Storage**: PostgreSQL (production) with in-memory fallback (local dev). Existing LocalStorageBackend + FocStorageBackend for segment/CAR storage.
**Testing**: vitest (unit + integration), in-memory backends for tests
**Target Platform**: Web browser (frontend) + Node.js server (backend), deployed on homelab k8s cluster
**Project Type**: Web application (monorepo: apps/web frontend + server)
**Performance Goals**: <2s status page load, <5min promote for <50 segments, 10 concurrent ingestion jobs
**Constraints**: No `any`, AbortSignal on all async interfaces, conventional commits, Biome formatting
**Scale/Scope**: MVP targets ~10 concurrent users, ~100 collections, ~1000 sources

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | New wallet auth uses existing StorageBackend interface. Session key delegation uses synapse-sdk's native SessionKeyConfig. No new lock-in. |
| II. Standalone Packages | PASS | Changes are in apps/web (application package) which already hard-depends on library packages. New Postgres persistence is self-contained within the web app. No new cross-package deps added to libraries. |
| III. Backend-Neutral Identity | PASS | StorageResult still uses `id` with optional CIDs. Session key support extends FocStorageBackend without changing the StorageBackend interface. |
| IV. Immutable Data, Mutable Index | PASS | Collections follow same pattern: immutable segments, mutable manifest/collection head. No schema changes to existing data formats. |
| V. Edges Are First-Class | N/A | Edge pipeline unchanged. Default extractors used for web-created collections. |
| VI. Test-First | PASS | All new modules will have unit tests. In-memory backends for testing. No network calls in tests. |
| VII. Bundle Uploads — Never Spam Small Pieces | PASS | Server-side promote reuses existing bundleAndUpload() — same single-CAR-per-batch guarantee. |
| VIII. Ship-First, Future-Aware | PASS | MVP scope is tight. Session keys, Postgres, and SSRF hardening are the right investments for a hosted service. |
| TypeScript strict, ESM, no defaults | PASS | All new code follows existing conventions. |
| pnpm workspaces | PASS | No new packages created. Changes within existing apps/web workspace. |
| Biome | PASS | All code will pass biome check. |
| Conventional commits | PASS | Scoped by package: `feat(web): ...` |
| Named errors only | PASS | New error classes for auth failures, session expiry, etc. in @wtfoc/common |

**Post-Phase 1 re-check**: The GitHub HTTP transport change touches `packages/ingest/` (library package). This is a transport-layer change to an existing adapter — it does not add new cross-package dependencies or change the SourceAdapter interface. Constitution II is still satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/121-wallet-collection-flow/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Postgres schema + entity definitions
├── quickstart.md        # Dev setup guide
├── contracts/
│   └── api.md           # REST API contract
├── checklists/
│   └── requirements.md  # Quality checklist
└── tasks.md             # Phase 2 output (not yet created)
```

### Source Code (repository root)

```text
apps/web/
├── src/                          # Frontend (Preact + Vite)
│   ├── components/
│   │   ├── WalletConnect.tsx     # NEW: Wallet connect/disconnect button
│   │   ├── SessionKeyManager.tsx # NEW: Session key delegation UI
│   │   ├── CreateCollection.tsx  # NEW: Collection creation form
│   │   ├── CollectionDetail.tsx  # NEW: Per-source ingestion status
│   │   ├── CollectionList.tsx    # NEW: "My Collections" dashboard
│   │   ├── PromoteButton.tsx     # NEW: Promote to FOC with status
│   │   └── ... (existing components)
│   ├── wallet.ts                 # NEW: wagmi config, SIWE helpers
│   ├── api.ts                    # MODIFIED: Add auth + collection API calls
│   ├── state.ts                  # MODIFIED: Add wallet/collection signals
│   └── app.tsx                   # MODIFIED: Add wallet-gated routes
│
├── server/
│   ├── index.ts                  # MODIFIED: Migrate to Hono, add new routes
│   ├── auth/                     # NEW: Authentication module
│   │   ├── siwe.ts               # SIWE challenge/verify logic
│   │   ├── session.ts            # Cookie session management
│   │   └── middleware.ts         # Auth middleware for Hono
│   ├── collections/              # NEW: Collection management
│   │   ├── routes.ts             # CRUD + promote endpoints
│   │   ├── ingest-worker.ts      # Async ingestion job runner
│   │   └── promote-worker.ts     # Async promote job runner
│   ├── db/                       # NEW: Database layer
│   │   ├── schema.sql            # Postgres schema + migrations
│   │   ├── postgres.ts           # Postgres repository implementation
│   │   ├── memory.ts             # In-memory repository implementation
│   │   └── repository.ts         # Repository interface
│   └── security/                 # NEW: Security utilities
│       ├── ssrf.ts               # URL validation, IP blocking
│       └── rate-limit.ts         # Per-wallet/IP rate limiting
│
packages/ingest/
│   └── src/adapters/github/
│       └── transport.ts          # MODIFIED: Add HTTP transport alongside gh CLI
│
packages/store/
│   └── src/backends/
│       └── foc.ts                # MODIFIED: Add SessionKeyConfig support
│
packages/common/
│   └── src/errors/               # MODIFIED: Add auth/session error classes
```

**Structure Decision**: All new code lives within the existing `apps/web/` workspace (both frontend and server), with minimal targeted changes to `packages/ingest/` (GitHub HTTP transport) and `packages/store/` (session key support in FocStorageBackend). No new packages are created. This respects Constitution II — the application package composes the library packages.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Hono migration (server framework change) | Raw HTTP is unmaintainable with 15+ routes + middleware (auth, CSRF, rate limiting, cookie management) | Keeping raw HTTP would produce spaghetti code that's hard to test and extend. Hono is 14KB and has built-in middleware for exactly our needs. |
| Postgres dependency | Session keys and collection state must survive restarts/deploys for a hosted service. In-memory is not viable for production. | File-based storage (like LocalManifestStore) doesn't support concurrent access or transactional updates needed for job state management. |
