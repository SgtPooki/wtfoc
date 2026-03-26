# Tasks: Wallet-Connected Collection Creation Flow

**Input**: Design documents from `/specs/121-wallet-collection-flow/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

**Tests**: Included per constitution VI (Test-First). Each user story includes unit tests for server-side logic using in-memory backends.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Add new dependencies and configure project for wallet + Postgres features

- [x] T001 Add Hono, pg, siwe, wagmi, @walletconnect/modal dependencies to apps/web/package.json
- [x] T002 [P] Add preact/compat alias to apps/web/vite.config.ts for wagmi React compatibility
- [x] T003 [P] Create apps/web/server/db/schema.sql with wallet_sessions, collections, sources, session_key_audit_log tables and indexes per data-model.md
- [x] T004 [P] Add auth/session error classes (SessionExpiredError, SessionKeyRevokedError, WalletVerificationError, RateLimitError) to packages/common/src/errors/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement repository interface in apps/web/server/db/repository.ts defining Collection, Source, WalletSession, AuditLog CRUD operations
- [x] T006 [P] Implement Postgres repository in apps/web/server/db/postgres.ts using pg client, connection pooling, and migrations runner for schema.sql
- [x] T007 [P] Implement in-memory repository in apps/web/server/db/memory.ts using Map-based stores matching the same repository interface
- [x] T008 Create repository factory in apps/web/server/db/index.ts that selects Postgres (when DATABASE_URL set) or in-memory fallback
- [x] T009 Migrate apps/web/server/index.ts from raw http.createServer() to Hono — preserve all existing routes (/api/collections/:name/query, /api/collections/:name/trace, /api/collections/:name/status, /api/collections/:name/edges, /api/collections/:name/sources, /api/collections/cid/:cid/*, /mcp, static file serving). Add CSRF protection middleware (hono/csrf) on all mutating (POST/PUT/DELETE) endpoints.
- [x] T010 [P] Implement SSRF-safe URL validator in apps/web/server/security/ssrf.ts with HTTPS-only check, private/link-local/metadata IP blocking, DNS rebinding defense (re-resolve after redirect), content-type validation (HTML/text only)
- [x] T011 [P] Implement per-wallet and per-IP rate limiter in apps/web/server/security/rate-limit.ts as Hono middleware
- [x] T012 [P] Add SessionKeyConfig support to packages/store/src/backends/foc.ts — new constructor option accepting { walletAddress, sessionKey } that uses Synapse.create() directly instead of filecoin-pin.initializeSynapse()
- [x] T013 [P] Create HTTP transport in packages/ingest/src/adapters/github/http-transport.ts implementing ExecFn interface — accepts a GitHubTokenProvider (from @wtfoc/ingest, already on main). Translates gh api calls to fetch() with GitHub REST API, handles pagination via Link header, ports rate limit detection from stderr to X-RateLimit-* response headers. Server wires up GitHubAppTokenProvider when GITHUB_APP_ID is set, falls back to PatTokenProvider (GITHUB_TOKEN), or unauthenticated if neither configured.

**Checkpoint**: Foundation ready — Hono server running with existing routes preserved, DB layer ready, security utilities available, FocStorageBackend supports session keys, GitHub adapter has HTTP transport.

---

## Phase 3: User Story 1 — Connect Wallet (Priority: P1) MVP

**Goal**: User visits wtfoc.xyz, connects wallet, proves ownership via SIWE, receives session cookie. Server can identify the user on subsequent requests.

**Independent Test**: Visit site → click Connect Wallet → approve MetaMask → sign SIWE message → see wallet address in UI → refresh page → still connected → disconnect → returned to unauthenticated state.

### Tests for User Story 1

- [x] T014a [P] [US1] Write unit tests for SIWE challenge/verify and session cookie lifecycle in apps/web/server/auth/siwe.test.ts and apps/web/server/auth/session.test.ts — test nonce generation, signature verification (valid/invalid), cookie issuance, cookie invalidation on disconnect. Use in-memory repository.

### Implementation for User Story 1

- [x] T014 [P] [US1] Implement SIWE challenge generation and signature verification in apps/web/server/auth/siwe.ts — generate nonce, build SIWE message, verify signature with viem.verifySiweMessage()
- [x] T015 [P] [US1] Implement session cookie management in apps/web/server/auth/session.ts — issue HttpOnly/Secure/SameSite=Strict cookie on successful SIWE verify, validate cookie on requests, invalidate on disconnect
- [x] T016 [US1] Implement auth middleware in apps/web/server/auth/middleware.ts — Hono middleware that reads session cookie, looks up WalletSession in repository, attaches wallet_address to request context, returns 401 if invalid/missing
- [x] T017 [US1] Implement auth routes in apps/web/server/auth/routes.ts — POST /api/auth/challenge, POST /api/auth/verify, POST /api/auth/disconnect per contracts/api.md
- [x] T018 [P] [US1] Create wagmi config with MetaMask + WalletConnect connectors in apps/web/src/wallet.ts — configure chains (Calibration testnet), WalletConnect project ID from env, SIWE helper functions (requestChallenge, signAndVerify)
- [x] T019 [P] [US1] Add wallet state signals (walletAddress, isConnected, chainId, sessionKeyActive) to apps/web/src/state.ts
- [x] T020 [US1] Create WalletConnect component in apps/web/src/components/WalletConnect.tsx — Connect/Disconnect button, shows truncated address when connected, handles MetaMask and WalletConnect providers, triggers SIWE flow on connect
- [x] T021 [US1] Integrate WalletConnect into app layout in apps/web/src/app.tsx — add wallet button to header, conditionally show authenticated vs unauthenticated UI
- [x] T022 [US1] Add chain mismatch detection in apps/web/src/components/WalletConnect.tsx — detect wrong chain ID, prompt user to switch to Calibration testnet

**Checkpoint**: User can connect wallet, sign SIWE, see their address, refresh without losing session, and disconnect. Server correctly identifies the user on API calls.

---

## Phase 4: User Story 2 — Create Collection from Sources (Priority: P1)

**Goal**: Wallet-connected user creates a collection by specifying a name and source identifiers. Server validates inputs, creates collection record, and starts async ingestion.

**Independent Test**: Connect wallet → click Create Collection → enter name + GitHub owner/repo → submit → see collection created with "ingesting" status → invalid source rejected with error.

### Tests for User Story 2

- [x] T023a [P] [US2] Write unit tests for collection creation, source validation, and ingest worker in apps/web/server/collections/routes.test.ts and apps/web/server/collections/ingest-worker.test.ts — test valid/invalid source identifiers, duplicate collection name rejection, async ingestion status updates, per-source failure isolation. Use in-memory repository and mock adapters.

### Implementation for User Story 2

- [x] T023 [P] [US2] Implement collection CRUD operations in apps/web/server/collections/routes.ts — POST /api/collections (create + start ingest), GET /api/collections (list by wallet), GET /api/collections/:id (detail with sources) per contracts/api.md. All routes require auth middleware.
- [x] T024 [P] [US2] Implement source identifier validation in apps/web/server/collections/validators.ts — validate GitHub owner/repo format, HTTPS URL for websites (pass through SSRF checker), numeric HackerNews thread ID
- [x] T025 [US2] Implement async ingestion worker in apps/web/server/collections/ingest-worker.ts — accepts collection ID, iterates sources, calls appropriate adapter (GitHubAdapter with HTTP transport + GitHubTokenProvider from @wtfoc/ingest, WebsiteAdapter with SSRF-safe fetcher, HackerNewsAdapter), updates per-source status in repository, builds segments via existing pipeline, updates collection status to ready/ingestion_failed on completion. Enforce max 10 concurrent ingestion jobs via semaphore — queue excess jobs and start them as slots free up (SC-006).
- [x] T026 [US2] Wire ingest-worker to collection creation in apps/web/server/collections/routes.ts — on POST /api/collections success, spawn ingest-worker as background async task (not blocking request), return collection with job ID
- [x] T027 [US2] Add collection API functions to apps/web/src/api.ts — createCollection(), fetchMyCollections(), fetchCollectionDetail()
- [x] T028 [US2] Create CreateCollection form component in apps/web/src/components/CreateCollection.tsx — name input, source type selector (GitHub/Website/HackerNews), source identifier input, add/remove sources, submit button, error display
- [x] T029 [US2] Add collection state signals (collections, activeCollection) to apps/web/src/state.ts and wire CreateCollection to API
- [x] T029a [US2] Add source size limit enforcement in apps/web/server/collections/validators.ts — max sources per collection, max pages per website crawl, max file count per GitHub repo. Return limits in validation error messages per FR-014.
- [x] T030 [US2] Integrate CreateCollection into app navigation in apps/web/src/app.tsx — show "Create Collection" button when wallet connected, route to form

**Checkpoint**: User can create a collection with sources, server validates inputs, ingestion starts in background. Collection appears in API responses with correct status.

---

## Phase 5: User Story 3 — Monitor Ingestion Progress (Priority: P2)

**Goal**: User sees per-source ingestion status with live updates on the collection detail page.

**Independent Test**: Create a collection → navigate to detail page → see per-source status (pending/ingesting/complete/failed) → wait for completion → see "Ready" status.

### Implementation for User Story 3

- [ ] T031 [US3] Create CollectionDetail component in apps/web/src/components/CollectionDetail.tsx — displays collection name, overall status, per-source status list (pending/ingesting/complete/failed with error messages), chunk counts, timestamps
- [ ] T032 [US3] Add polling logic to CollectionDetail in apps/web/src/components/CollectionDetail.tsx — poll GET /api/collections/:id every 5 seconds while status is ingesting/promoting, stop polling when terminal state reached
- [ ] T033 [US3] Add collection detail route and navigation in apps/web/src/app.tsx — clicking a collection in list or after creation navigates to detail view

**Checkpoint**: User can see live ingestion progress per-source. Failed sources show error messages. Completed collections show "Ready" status.

---

## Phase 6: User Story 4 — Promote Collection to FOC (Priority: P2)

**Goal**: User delegates a session key and promotes a ready collection to FOC. Server bundles, uploads, and writes on-chain using the session key. User gets a shareable CID.

**Independent Test**: Create + ingest a collection → delegate session key → click Promote → see promoting status → see manifest CID when complete → load collection by CID in search/trace UI.

### Tests for User Story 4

- [ ] T034a [P] [US4] Write unit tests for session key delegation, revocation, and promote worker in apps/web/server/auth/session-key.test.ts and apps/web/server/collections/promote-worker.test.ts — test key encryption/storage, revocation deletes key, expired key rejection, promote checkpoint persistence and resume from each checkpoint stage. Use in-memory repository and mock FocStorageBackend.

### Implementation for User Story 4

- [ ] T034 [US4] Implement session key delegation and revocation routes in apps/web/server/auth/routes.ts — POST /api/auth/session-key (delegate/rotate), DELETE /api/auth/session-key (revoke) per contracts/api.md. Encrypt session key before storing in repository. Log to audit trail.
- [ ] T035 [P] [US4] Create SessionKeyManager component in apps/web/src/components/SessionKeyManager.tsx — UI for delegating a session key (generates ephemeral keypair client-side, signs delegation, sends to server), shows active/expired status, revoke button
- [ ] T036 [US4] Implement promote worker in apps/web/server/collections/promote-worker.ts — loads collection segments from LocalStorageBackend, calls bundleAndUpload() with FocStorageBackend configured with session key (SessionKeyConfig), persists promotion checkpoints (car_built, uploaded, on_chain_written) to repository, handles resume from last checkpoint on retry, updates collection with manifestCid/pieceCid on success
- [ ] T037 [US4] Implement promote routes in apps/web/server/collections/routes.ts — POST /api/collections/:id/promote (start promotion, requires active session key), GET /api/collections/:id/promote/status per contracts/api.md. Deduplicate concurrent promote requests.
- [ ] T038 [US4] Create PromoteButton component in apps/web/src/components/PromoteButton.tsx — shows "Promote to FOC" when collection is ready and session key active, shows "Delegate Session Key" if key missing/expired, shows progress during promotion, shows CID after success
- [ ] T039 [US4] Add promote API functions to apps/web/src/api.ts — delegateSessionKey(), revokeSessionKey(), promoteCollection(), fetchPromoteStatus()
- [ ] T040 [US4] Integrate PromoteButton and SessionKeyManager into CollectionDetail in apps/web/src/components/CollectionDetail.tsx — show promote controls when status is ready, show promotion progress when promoting, show CID when promoted

**Checkpoint**: User can delegate session key, promote a collection, see promotion progress, and receive a shareable CID. Promoted collection is loadable via existing CID-based search/trace UI.

---

## Phase 7: User Story 5 — View My Collections (Priority: P3)

**Goal**: Wallet-connected user sees a dashboard of all their collections with status, source count, and CID.

**Independent Test**: Connect wallet with multiple collections → navigate to My Collections → see all collections with correct statuses → click a collection → go to detail view.

### Implementation for User Story 5

- [ ] T041 [US5] Create CollectionList component in apps/web/src/components/CollectionList.tsx — table/list of collections showing name, status badge, source count, segment count, CID (if promoted), created date. Links to CollectionDetail.
- [ ] T042 [US5] Add "My Collections" navigation to apps/web/src/app.tsx — show link in header when wallet connected, default landing page for authenticated users
- [ ] T043 [US5] Add auto-refresh to CollectionList in apps/web/src/components/CollectionList.tsx — poll GET /api/collections every 10 seconds to reflect status changes

**Checkpoint**: User sees all their collections in a dashboard view with correct statuses and can navigate to detail pages.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T044 [P] Add structured error responses across all API routes in apps/web/server/ — consistent { error, code } format matching contracts/api.md
- [ ] T045 [P] Add session key audit logging throughout promote-worker and auth routes in apps/web/server/ — log all session key operations with wallet address, operation type, timestamp per data-model.md
- [ ] T046 [P] Wire SSRF-safe fetcher into WebsiteAdapter invocation in apps/web/server/collections/ingest-worker.ts — validate all website URLs through ssrf.ts before passing to adapter
- [ ] T047 (moved to T029a in US2)
- [ ] T048 Run pnpm lint:fix across all modified files
- [ ] T049 Validate quickstart.md end-to-end — start server with DATABASE_URL, connect wallet, create collection, ingest, promote, verify CID is queryable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 Connect Wallet (Phase 3)**: Depends on Foundational — BLOCKS US2, US4, US5
- **US2 Create Collection (Phase 4)**: Depends on US1 (needs auth) — BLOCKS US3
- **US3 Monitor Progress (Phase 5)**: Depends on US2 (needs collections to monitor)
- **US4 Promote to FOC (Phase 6)**: Depends on US2 (needs ingested collections) + US1 (needs session key delegation)
- **US5 My Collections (Phase 7)**: Depends on US1 (needs auth) — can run parallel with US3/US4
- **Polish (Phase 8)**: Depends on all story phases

### User Story Dependencies

```
Setup → Foundational → US1 (Connect Wallet) → US2 (Create Collection) → US3 (Monitor)
                                             ↘                         ↗
                                              US4 (Promote) ─────────
                                             ↘
                                              US5 (My Collections)
```

### Within Each User Story

- Server-side routes before frontend components
- Auth/middleware before routes that use them
- API client functions before UI components that call them
- Core implementation before integration

### Parallel Opportunities

- T002, T003, T004 can all run in parallel (Setup phase)
- T006, T007, T010, T011, T012, T013 can all run in parallel (Foundational phase)
- T014, T015 can run in parallel (US1 server auth)
- T018, T019 can run in parallel (US1 frontend wallet)
- T023, T024 can run in parallel (US2 server routes + validation)
- T034, T035 can run in parallel (US4 session key server + client)
- US3 and US5 can run in parallel after US2 is complete
- All Polish tasks (T044-T047) can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# Launch all independent foundational tasks together:
Task: "T006 Implement Postgres repository in apps/web/server/db/postgres.ts"
Task: "T007 Implement in-memory repository in apps/web/server/db/memory.ts"
Task: "T010 Implement SSRF-safe URL validator in apps/web/server/security/ssrf.ts"
Task: "T011 Implement rate limiter in apps/web/server/security/rate-limit.ts"
Task: "T012 Add SessionKeyConfig to packages/store/src/backends/foc.ts"
Task: "T013 Create HTTP transport in packages/ingest/src/adapters/github/http-transport.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 — Connect Wallet
4. Complete Phase 4: US2 — Create Collection
5. **STOP and VALIDATE**: User can connect wallet and create collections with async ingestion
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 Connect Wallet → Test independently → User can sign in (MVP-1)
3. US2 Create Collection → Test independently → User can create + ingest (MVP-2)
4. US3 Monitor Progress → Test independently → User sees live status
5. US4 Promote to FOC → Test independently → User gets shareable CID
6. US5 My Collections → Test independently → User has dashboard
7. Polish → Production hardening

### Single Developer Strategy

Work sequentially through phases. Each phase is a natural commit boundary. Stop at any checkpoint to validate.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Run `pnpm lint:fix` (not manual lint fixes) per project convention
