# Feature Specification: Wallet-Connected Collection Creation Flow

**Feature Branch**: `121-wallet-collection-flow`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "Wallet-connected collection creation flow for wtfoc.xyz hosted UI. User connects wallet, creates collection from sources, server ingests async, user monitors progress, promotes to FOC by signing with wallet."
**Related Issues**: #75, #76, #67, #80, #167, #168

## Clarifications

### Session 2026-03-26

- Q: How does the server verify wallet ownership and authenticate API calls? → A: Two-layer auth model. (1) **Session cookie** — when the user delegates a session key, the server issues an HTTP session cookie tied to the wallet address. This cookie authenticates all subsequent API calls (my collections, status polling, revocation) and persists across page refreshes. The cookie can have a longer lifetime (days/weeks). (2) **Session key** — a scoped, time-limited private key delegated to the server for FOC write operations (upload, on-chain write). Can be shorter-lived than the cookie for security. If the cookie is valid but the session key has expired, the user can still view their collections but must re-delegate a session key before promoting. The server never has access to the user's actual wallet private key. This also solves the promote architecture: the server performs the full promote flow (bundle CAR, upload to FOC, on-chain write) using the delegated session key, identical to how the CLI uses `WTFOC_PRIVATE_KEY` today.
- Q: How should server-side URL fetching be secured against SSRF and abuse? → A: Allowlist by source type. For structured sources (GitHub, HackerNews), users provide only identifiers (e.g., `owner/repo`), and the server constructs the actual API URLs — no arbitrary URL input. For website sources, apply full hardening: HTTPS-only, block private/link-local/metadata IPs, DNS rebinding defense (re-resolve after redirect, verify IP still public), redirect re-validation per hop, content-type restrictions (HTML/text only), max page count per crawl, per-wallet and per-IP rate limits on job creation. All hardening is application-level code in the website adapter and server middleware — no infra changes required.
- Q: How should the GitHub adapter work on a hosted server? → A: Replace `gh` CLI transport with direct HTTP calls to GitHub's REST API. For MVP, use a server-provisioned GitHub PAT (env var) for 5,000 req/hr shared across users. Post-MVP, wire up GitHub App OAuth for per-user rate limits and private repo access. GitHub App can be registered now as parallel groundwork.
- Q: Are unpromoted collections visible to other users? → A: Private to creator. Only the authenticated wallet that created a collection can view its status and details. Promoted collections are public by CID. Post-MVP: users will be able to opt-in to "list publicly for wtfoc.xyz users" when promoting, and an encryption story for RAG data will be added.
- Q: How should collection and job state be persisted? → A: Postgres when available, in-memory fallback otherwise. When `DATABASE_URL` is set, the server persists collection metadata, job state, and session keys to Postgres — surviving restarts, deploys, and crashes. Without it, the server uses in-memory state (suitable for local dev but data is lost on restart). The hosted wtfoc.xyz deployment will always use Postgres.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect Wallet (Priority: P1)

A user visits wtfoc.xyz and connects their Ethereum-compatible wallet to establish their identity. This is the foundational step that gates all write operations (collection creation and FOC promotion). The user sees a "Connect Wallet" button, clicks it, selects their wallet provider, approves the connection, and delegates a scoped session key to the server. The UI displays their address confirming they are connected and the server can now act on their behalf for FOC operations.

**Why this priority**: Without wallet connection, neither collection ownership nor FOC promotion is possible. This is the identity layer that everything else depends on.

**Independent Test**: Can be fully tested by visiting the site, clicking "Connect Wallet", approving the MetaMask/WalletConnect popup, and verifying the wallet address appears in the UI. Delivers value by establishing user identity.

**Acceptance Scenarios**:

1. **Given** a user on wtfoc.xyz with no wallet connected, **When** they click "Connect Wallet" and approve in their wallet provider, **Then** the UI displays their truncated wallet address and transitions to the authenticated state.
2. **Given** a user with a connected wallet, **When** they refresh the page, **Then** the wallet remains connected (session persistence) and their address is displayed.
3. **Given** a user with a connected wallet, **When** they click "Disconnect", **Then** the browser wallet connection is dropped, the session cookie is invalidated server-side, and the UI returns to the unauthenticated state. The delegated session key remains valid on the server so any in-flight operations (ingestion, promotion) can complete. The user can explicitly revoke the session key separately if they want to stop all server-side operations.
4. **Given** a user on a device without a wallet extension, **When** they click "Connect Wallet", **Then** they are offered WalletConnect as an alternative (QR code / deep link).

---

### User Story 2 - Create Collection from Sources (Priority: P1)

A wallet-connected user creates a new collection by providing a name and selecting one or more sources to ingest. For MVP, supported source types are: public GitHub repositories (by `owner/repo`), public websites (by HTTPS URL), and HackerNews threads (by thread ID). The user fills out a form specifying the collection name and source identifiers, then submits. The server validates the inputs, constructs the actual fetch URLs server-side for structured sources, and begins ingestion as a background job.

**Why this priority**: This is the core value proposition — letting users build knowledge collections from the web UI without touching the CLI. Tied with wallet connect as the other P1 because you need both for any useful flow.

**Independent Test**: Can be tested by connecting a wallet, entering a collection name and a public GitHub repo URL, submitting the form, and verifying the server acknowledges the creation request with a job ID.

**Acceptance Scenarios**:

1. **Given** a wallet-connected user, **When** they fill in a collection name and at least one valid source identifier and submit, **Then** the system accepts the request, returns a job identifier, and begins ingestion in the background.
2. **Given** a wallet-connected user, **When** they submit a collection name that already exists for their wallet address, **Then** the system rejects the request with a clear error message.
3. **Given** a wallet-connected user, **When** they submit a form with no sources, **Then** the system rejects the request and prompts them to add at least one source.
4. **Given** a wallet-connected user, **When** they submit an invalid source identifier (unrecognized format or unreachable), **Then** the system rejects that source with a specific error while allowing valid sources to proceed.

---

### User Story 3 - Monitor Ingestion Progress (Priority: P2)

After creating a collection, the user can see the status of the background ingestion job. The UI shows which sources have been ingested, which are in progress, and whether any have failed. The user can navigate to a collection detail view to see this progress at any time.

**Why this priority**: Users need feedback that their collection is being built. Without progress visibility, they have no idea if ingestion is working or stuck. However, the core create + promote flow can technically work with polling the final status alone.

**Independent Test**: Can be tested by creating a collection, navigating to the collection detail page, and verifying that source-level progress indicators update as ingestion proceeds.

**Acceptance Scenarios**:

1. **Given** a collection with an active ingestion job, **When** the user views the collection detail page, **Then** they see a per-source status (pending, ingesting, complete, failed) and an overall progress indicator.
2. **Given** a collection where one source has failed, **When** the user views the detail page, **Then** they see an error message for the failed source, and other sources continue ingesting independently.
3. **Given** a collection where all sources have finished ingesting, **When** the user views the detail page, **Then** the status shows "Ready" and the option to promote to FOC becomes available.

---

### User Story 4 - Promote Collection to FOC (Priority: P2)

When ingestion is complete, the user promotes their collection to the Filecoin Open Compute network. The server bundles the collection segments into a CAR file and uploads it to FOC storage using the user's delegated session key — the user does not need to keep their browser open during upload. The server performs the on-chain write using the same session key. After completion, the user receives a shareable CID for their collection.

**Why this priority**: This is the payoff — making the collection permanent and verifiable on FOC. It depends on both wallet connection and completed ingestion, so it naturally follows P1 stories. Ranked P2 because users get value from local collections even before promoting.

**Independent Test**: Can be tested by creating a collection, waiting for ingestion to complete, clicking "Promote to FOC", and verifying the server completes the upload using the delegated session key and returns an accessible CID.

**Acceptance Scenarios**:

1. **Given** a collection with status "Ready" (all sources ingested) and a valid session key, **When** the user clicks "Promote to FOC", **Then** the server bundles the collection, uploads to FOC using the delegated session key, writes on-chain, and displays the resulting manifest CID.
2. **Given** a collection with status "Ready" but an expired or revoked session key, **When** the user clicks "Promote to FOC", **Then** the system prompts the user to delegate a new session key before proceeding.
3. **Given** a promote is in progress, **When** the user closes their browser, **Then** the server continues the promote to completion using the session key and the user can see the result when they return.
4. **Given** a promoted collection, **When** any user loads the collection by its CID, **Then** the collection is queryable and traceable through the existing wtfoc.xyz search/trace UI.

---

### User Story 5 - View My Collections (Priority: P3)

A wallet-connected user can see a list of all collections associated with their wallet address. This includes collections in various states: ingesting, ready, and promoted. Each collection shows its name, status, source count, and (if promoted) its CID.

**Why this priority**: Quality-of-life feature for repeat users. The create and promote flows work without a dedicated "my collections" view (the user can bookmark the collection detail page), but a dashboard improves usability significantly.

**Independent Test**: Can be tested by connecting a wallet that owns multiple collections and verifying the list view shows all of them with correct statuses.

**Acceptance Scenarios**:

1. **Given** a wallet-connected user who owns 3 collections (one ingesting, one ready, one promoted), **When** they navigate to "My Collections", **Then** all 3 appear with correct status labels and metadata.
2. **Given** a user who is not wallet-connected, **When** they try to access "My Collections", **Then** they are prompted to connect their wallet first.

---

### Edge Cases

- What happens when the user's wallet network doesn't match the expected chain (e.g., mainnet vs. Calibration testnet)? The system should detect the mismatch and prompt the user to switch networks.
- What happens when ingestion is in progress and the user closes the browser? The server-side job continues; the user can return later and see the current status.
- What happens when the session key expires mid-promote? The server should detect the failure, record promotion progress (CAR built, upload status), and prompt the user to delegate a new session key to resume without re-bundling.
- What happens when the user clicks "Promote" multiple times? Repeated promote requests for a collection already in "promoting" state MUST be deduplicated — the server returns the existing job status rather than starting a new promote. If a previous promote failed, the user can retry manually and the server resumes from the last checkpoint (CAR built → skip bundling, upload complete → skip upload, only retry on-chain write).
- What happens on server restart during promotion? The server persists promotion checkpoints to the database: (1) CAR bundled with root CID, (2) upload complete with piece CID, (3) on-chain write complete with manifest CID. On restart, promotion-in-progress collections are marked as promotion-failed and can be resumed from the last checkpoint.
- What happens when a source URL is valid but the content is inaccessible (e.g., rate-limited, 404)? The source is marked as failed with a descriptive error; other sources continue.
- What happens when the user submits a very large source (e.g., a monorepo with 100K files)? The system should enforce reasonable size limits and inform the user before starting ingestion.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to connect an Ethereum-compatible wallet via browser extension (MetaMask) or WalletConnect protocol.
- **FR-002**: System MUST persist wallet identity across page refreshes via a server-issued session cookie tied to the wallet address. The cookie is issued upon successful session key delegation (after the server verifies wallet ownership — see FR-002a) and authenticates all subsequent API calls. The cookie MUST be `HttpOnly`, `Secure`, and `SameSite=Strict`. Mutating API endpoints MUST include CSRF protection.
- **FR-002a**: Before issuing a session cookie or accepting a delegated session key, the server MUST verify wallet ownership via a signed challenge: the server presents a unique nonce, the client signs it with their wallet, and the server verifies the signature matches the claimed address. This binds the cookie, session key, and wallet address together cryptographically.
- **FR-003**: System MUST associate each collection with the wallet address of the user who created it.
- **FR-003a**: Before the first FOC write operation (promote), system MUST prompt the user to delegate a scoped, time-limited session key to the server. Session key delegation is a separate step from wallet connection — the user can browse and create collections with only a session cookie, but must delegate a session key before promoting.
- **FR-003b**: System MUST allow users to revoke or rotate their delegated session key from the UI. On revocation, the session key MUST be deleted from the database and any in-flight FOC operations using that key MUST be marked as failed.
- **FR-003c**: System MUST reject server-side FOC operations when the session key is expired or revoked, and prompt the user to delegate a new one.
- **FR-003d**: System MUST support Postgres for persisting collection metadata, job state, and session keys (via `DATABASE_URL`). When no database is configured, system MUST fall back to in-memory state suitable for local development.
- **FR-004**: System MUST allow wallet-connected users to create a new collection by specifying a name and one or more source identifiers (e.g., `owner/repo` for GitHub, HTTPS URL for websites, thread ID for HackerNews).
- **FR-005**: For structured sources (GitHub, HackerNews), system MUST accept source identifiers (e.g., `owner/repo`, thread ID) rather than raw URLs, and construct API URLs server-side. For website sources, system MUST apply full SSRF hardening: HTTPS-only, block private/link-local/metadata IPs, DNS rebinding defense (re-resolve after redirect), redirect re-validation per hop, content-type restrictions (HTML/text only), and enforce crawl limits (max pages, max bytes).
- **FR-005a**: System MUST enforce per-wallet rate limits on job creation to prevent abuse.
- **FR-006**: System MUST process source ingestion asynchronously in the background, not blocking the user's browser session.
- **FR-007**: System MUST provide per-source status tracking (pending, ingesting, complete, failed) for each collection's ingestion job.
- **FR-008**: System MUST allow users to view the ingestion status of their own collections at any time. Unpromoted collections MUST only be accessible to the wallet that created them.
- **FR-009**: System MUST enable users to promote a fully-ingested collection to FOC by having the server bundle segments into a CAR file, upload to FOC storage, and write on-chain — all using the user's delegated session key.
- **FR-010**: System MUST NOT require the user's browser to remain open during the promote upload; the server performs the full flow asynchronously using the session key.
- **FR-011**: System MUST return a shareable manifest CID after successful promotion.
- **FR-012**: System MUST allow users to view a list of all collections owned by their wallet address.
- **FR-013**: System MUST detect wallet network mismatches (e.g., wrong chain ID) and prompt the user to switch to the correct network before allowing promotion.
- **FR-014**: System MUST enforce source size limits to prevent unbounded ingestion jobs, informing the user of the limits before ingestion begins.

### Key Entities

- **Collection**: A named grouping of ingested knowledge segments, owned by a wallet address. Has a lifecycle: creating → ingesting → ready → promoting → promoted. Additional terminal/resumable states: ingestion-failed (some sources failed but others succeeded — collection may still be promotable), promotion-failed (upload or on-chain write failed — can retry without re-bundling if CAR was already built). Contains references to its source configurations and (after promotion) its manifest CID and batch records.
- **Source**: A content origin identified by a source-type-specific identifier (`owner/repo` for GitHub, HTTPS URL for websites, thread ID for HackerNews) associated with a collection. Has its own ingestion status independent of other sources in the same collection.
- **Ingestion Job**: A background task that processes one or more sources for a collection. Tracks per-source progress and overall completion state. Survives browser disconnection.
- **Wallet Identity**: An Ethereum address used to establish ownership of collections and authorize FOC writes. Not an account in the traditional sense — no registration, no password, no stored profile beyond the address.
- **Session Key**: A scoped, time-limited private key delegated by the user to the server. Authorizes the server to perform FOC uploads and on-chain writes on the user's behalf. Can be revoked or rotated by the user. The server stores session keys encrypted at rest in Postgres (encrypted with a server-side application key from env var). All session key usage is logged with wallet address, operation type, and timestamp for audit. The server uses session keys identically to how the CLI uses `WTFOC_PRIVATE_KEY`.
- **Session Cookie**: An HTTP cookie issued by the server upon session key delegation, tied to the wallet address. Authenticates all read-only API calls (my collections, status, details). Has a longer lifetime than the session key — users can browse their collections even after the session key expires, but must re-delegate before FOC write operations.

## Scope & Boundaries *(mandatory)*

### In Scope (MVP)

- Wallet connection via MetaMask and WalletConnect
- Collection creation with public GitHub repos, public websites, and HackerNews threads as sources
- Server-side async ingestion with progress tracking
- FOC promotion via server using delegated session keys
- Session key delegation, revocation, and rotation
- "My Collections" list view
- Collection detail view with ingestion status

### Out of Scope (Deferred)

- **Source authentication / OAuth connectors** (#76): Private GitHub repos, Slack, Discord sources requiring user OAuth tokens. MVP supports only public, unauthenticated sources.
- **GitHub App per-user OAuth flow**: The GitHubOAuthTokenProvider exists in @wtfoc/ingest but wiring the OAuth callback route and per-user token storage is deferred to post-MVP. MVP uses GitHubAppTokenProvider (installation-level) or PatTokenProvider.
- **Collection encryption** (#79): End-to-end encryption of collection data before FOC upload.
- **Collection sharing / access control**: All promoted collections are publicly readable by CID. Post-MVP: opt-in public listing on wtfoc.xyz at promote time, and RAG data encryption (#79).
- **Incremental re-ingestion**: Updating an existing collection with new data from the same sources. MVP is create-once.
- **Edge extraction configuration**: Users cannot customize edge extractors in the UI. Default extractors are used.
- **Custom embedder selection**: Users cannot choose their embedder model. Server default is used.

## Assumptions

- The existing ingest pipeline (adapters, chunker, segment builder) can be driven programmatically from the web server without modification to its core interfaces.
- The existing `bundleAndUpload()` and `FocStorageBackend` from `@wtfoc/store` can be reused for the server-side promote flow by passing the user's delegated session key where the CLI currently passes `WTFOC_PRIVATE_KEY`. The session key is functionally a private key with limited scope and lifetime.
- The server supports Postgres for persisting collection metadata, job state, and session keys (configured via `DATABASE_URL`). Without a database URL, the server falls back to in-memory state suitable for local development. The hosted wtfoc.xyz deployment and the user's homelab infra will use Postgres.
- Users are expected to have basic familiarity with wallet connections (MetaMask popup flow).
- The Calibration testnet will be used during development and initial launch; mainnet support follows.
- The GitHub adapter's `gh` CLI transport will be replaced with direct HTTP calls to GitHub's REST API for hosted use. Auth uses the `GitHubTokenProvider` interface (already on main in @wtfoc/ingest): `GitHubAppTokenProvider` when GitHub App credentials are configured (5,000 req/hr per installation), `PatTokenProvider` as fallback (`GITHUB_TOKEN` env var), or unauthenticated if neither is set. GitHub App auth is optional — server operators choose their auth strategy via env vars.
- WalletConnect requires a project ID from WalletConnect Cloud, which will need to be provisioned.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from first visit to a fully promoted FOC collection in under 15 minutes (for a small source like a single GitHub repo with <100 files).
- **SC-002**: 90% of users who start the collection creation flow successfully complete it (submit at least one source and receive a job ID).
- **SC-003**: Users can check ingestion progress within 2 seconds of navigating to the collection detail page.
- **SC-004**: The promote-to-FOC flow completes (bundle + upload + sign) in under 5 minutes for collections with fewer than 50 segments.
- **SC-005**: A promoted collection's CID is resolvable and queryable through the existing search/trace UI within 10 minutes of promotion.
- **SC-006**: The system handles at least 10 concurrent ingestion jobs without degradation in ingestion throughput or UI responsiveness.
