# Research: Wallet-Connected Collection Creation Flow

**Branch**: `121-wallet-collection-flow` | **Date**: 2026-03-26

## R1: Session Key Delegation on Filecoin/Synapse SDK

**Decision**: Use synapse-sdk's `SessionKeyConfig` for session key delegation. The SDK already supports `{ walletAddress, sessionKey }` as a valid authentication mode — no custom protocol needed.

**Rationale**: The `@filoz/synapse-sdk` accepts 4 auth modes via `SynapseSetupConfig`:
1. `PrivateKeyConfig` — `{ privateKey: "0x..." }` (current CLI path)
2. `SessionKeyConfig` — `{ walletAddress: "0x...", sessionKey: "0x..." }` (our target)
3. `ReadOnlyConfig` — `{ walletAddress: "0x...", readOnly: true }`
4. `AccountConfig` — `{ account: Account }` (viem Account)

The `SessionKeyConfig` path is exactly what we need: the user delegates a session key from their wallet, and the server passes `{ walletAddress, sessionKey }` to Synapse.create(). The session key is functionally a private key with limited scope.

**Alternatives considered**:
- `AccountConfig` with viem Account from browser wallet — requires browser to stay open during upload
- Custom signed delegation protocol — unnecessary since SDK has native session key support
- filecoin-pin's `initializeSynapse()` — only accepts raw private key, doesn't support session keys; bypass it and use Synapse.create() directly

**Implementation note**: `FocStorageBackend` currently uses `filecoin-pin.initializeSynapse()` which only accepts private keys. For session key support, use `Synapse.create()` directly (the download path already does this). Create a new constructor option or subclass that accepts `{ walletAddress, sessionKey }` instead of `{ privateKey }`.

## R2: Wallet Connection Library for Preact Frontend

**Decision**: Use `wagmi` + `viem` + `@walletconnect/modal` for wallet connection in the Preact frontend.

**Rationale**: The codebase already depends on `viem` (v2.47.6) in `@wtfoc/store`. wagmi is the standard React/Preact wallet connection library built on top of viem. It provides:
- MetaMask and WalletConnect support out of the box
- Session persistence across page refreshes
- Chain switching and detection
- TypeScript-first with full type safety
- Works with Preact via `preact/compat`

**Alternatives considered**:
- RainbowKit — heavier, more opinionated UI; wagmi alone is sufficient
- Raw viem only — would need to hand-roll wallet connection, provider management, and WalletConnect integration
- ethers.js — different ecosystem, would conflict with existing viem dependency

**WalletConnect requirement**: Needs a WalletConnect Cloud project ID (free tier available). Register at cloud.walletconnect.com.

## R3: Server Architecture — Raw HTTP vs Framework

**Decision**: Add lightweight routing to the existing raw Node.js HTTP server using a router utility, or migrate to Hono for minimal overhead.

**Rationale**: The current server (`apps/web/server/index.ts`) uses raw `http.createServer()` with manual URL parsing. Adding wallet auth, session management, cookie handling, CSRF protection, and 10+ new API routes will make manual routing unmaintainable.

Options:
1. **Hono** — ultralight (14KB), works with Node.js, has built-in cookie, CORS, and CSRF middleware. Clean migration path from raw HTTP.
2. **Express** — heavier but well-known. Overkill for this use case.
3. **Keep raw HTTP** — possible but will produce spaghetti with auth middleware + 15+ routes.

**Decision**: Use Hono. It's the lightest option with the middleware we need (cookie, CSRF, CORS) and aligns with the project's "ship-first" principle.

**Alternatives considered**:
- Express — too heavy, not aligned with project minimalism
- Fastify — good but more complex than needed
- Keep raw HTTP — unmaintainable at this route count

## R4: GitHub Adapter HTTP Transport

**Decision**: Replace `gh` CLI transport with direct `fetch()` calls to GitHub REST API, using the `GitHubTokenProvider` interface from `@wtfoc/ingest` for auth.

**Rationale**: The current `GitHubAdapter` shells out to `gh api` via `execFile`. The `ExecFn` abstraction is already injectable. A separate agent has landed the `GitHubTokenProvider` interface on main with three implementations:
- `PatTokenProvider` — wraps a static PAT (fallback when no GitHub App configured)
- `GitHubAppTokenProvider` — JWT signing + installation token exchange with auto-refresh
- `GitHubOAuthTokenProvider` — OAuth code exchange for per-user tokens (post-MVP)

For hosted use, the server uses `GitHubAppTokenProvider` when GitHub App credentials are configured (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`), falling back to `PatTokenProvider` (`GITHUB_TOKEN`) or unauthenticated if neither is set. This is optional — server operators without a GitHub App still get unauthenticated access (60 req/hr).

**Implementation approach**: Create an `HttpTransport` that implements `ExecFn` by translating `gh api` calls to `fetch()`:
- Accept a `GitHubTokenProvider` for auth headers
- REST endpoints: `GET https://api.github.com/{path}` with `Authorization: token ${token}` header
- GraphQL endpoint (discussions): `POST https://api.github.com/graphql`
- Handle pagination manually (parse `Link` header) instead of `--paginate`
- Port rate limit detection from stderr parsing to response header parsing (`X-RateLimit-*`)

The adapter code in `adapter.ts` needs zero changes — it already uses the injectable `ExecFn`.

**Alternatives considered**:
- Octokit — full GitHub SDK; heavier than needed since we only call 4 endpoints
- Keep `gh` CLI — still requires `gh` installed on server

## R5: Postgres Integration

**Decision**: Use `pg` (node-postgres) with a thin repository pattern. No ORM.

**Rationale**: The server needs to persist collections, jobs, sources, session keys, and audit logs. A thin SQL layer with `pg` keeps it simple and avoids ORM complexity. Schema migrations via plain SQL files.

**Alternatives considered**:
- Drizzle ORM — nice TypeScript integration but adds abstraction layer; overkill for ~5 tables
- Prisma — heavy codegen, slow cold starts, not aligned with minimalism
- Knex — query builder without full ORM; reasonable but still more than raw SQL needed
- SQLite (better-sqlite3) — no network dependency but doesn't match production target (Postgres)

**In-memory fallback**: When `DATABASE_URL` is not set, use a simple `Map`-based in-memory store implementing the same repository interface. This keeps local dev friction-free.

## R6: SSRF Hardening for Website Adapter

**Decision**: Add a `SafeFetcher` wrapper to the website adapter that validates URLs before fetching.

**Rationale**: The website adapter uses Crawlee for crawling. SSRF hardening needs to happen at the fetch level:
1. Resolve hostname to IP before connecting
2. Check IP against blocklist (private ranges, link-local, metadata)
3. After redirect, re-resolve and re-check IP (DNS rebinding defense)
4. Enforce HTTPS-only
5. Validate Content-Type (HTML/text only)
6. Enforce max pages and max bytes per crawl

**Implementation**: Wrap Crawlee's request handler with pre-fetch IP validation. Use Node's `dns.resolve()` to check IPs before connecting.

## R7: Signed Challenge for Wallet Verification (FR-002a)

**Decision**: Use SIWE (Sign-In with Ethereum) standard (EIP-4361) for the initial wallet ownership proof.

**Rationale**: SIWE is the established standard for "prove you own this wallet" flows:
1. Server generates a nonce and presents a SIWE message
2. Client signs the message with their wallet (user sees human-readable text in MetaMask)
3. Server verifies the signature using `viem.verifyMessage()`
4. Server issues session cookie

Using SIWE rather than a raw nonce means the user sees a human-readable message in their wallet popup explaining what they're signing, which is better UX and security.

The `siwe` npm package handles message creation and verification. viem also has built-in SIWE support via `parseSiweMessage()` and `verifySiweMessage()`.

**Alternatives considered**:
- Raw nonce signing — works but user sees hex gibberish in wallet popup
- EIP-712 typed data — more complex, not needed for simple auth
