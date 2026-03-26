# Quickstart: Wallet-Connected Collection Creation Flow

**Branch**: `121-wallet-collection-flow` | **Date**: 2026-03-26

## Prerequisites

- Node.js >= 24
- pnpm
- MetaMask browser extension (or WalletConnect-compatible wallet)
- PostgreSQL (optional for local dev, required for production)
- GitHub PAT (optional, for higher rate limits on GitHub source ingestion)

## Environment Variables

```bash
# Required for production
DATABASE_URL=postgresql://user:pass@localhost:5432/wtfoc

# Required for session key encryption (production)
SESSION_KEY_ENCRYPTION_KEY=your-32-byte-hex-key

# Optional
GITHUB_TOKEN=ghp_...                    # Server-provisioned GitHub PAT
WALLETCONNECT_PROJECT_ID=abc123         # WalletConnect Cloud project ID
WTFOC_PORT=3577                         # Server port (default: 3577)
```

## Local Development (no Postgres)

```bash
pnpm install
pnpm --filter @wtfoc/web dev
```

The server starts in in-memory mode. Wallet auth and collection creation work, but data is lost on restart.

## Production (with Postgres)

```bash
# Run migrations
DATABASE_URL=postgresql://... pnpm --filter @wtfoc/web migrate

# Start server
DATABASE_URL=postgresql://... pnpm --filter @wtfoc/web start
```

## User Flow

1. Visit `http://localhost:3577`
2. Click "Connect Wallet" → approve in MetaMask
3. Sign the SIWE challenge message
4. (Optional) Delegate a session key for FOC operations
5. Click "Create Collection" → enter name + sources
6. Monitor ingestion progress on the collection detail page
7. When ready, click "Promote to FOC" (requires active session key)
8. Share the resulting CID with anyone

## Key Architectural Decisions

- **Server handles all FOC operations** using delegated session keys (not browser)
- **Two-layer auth**: session cookie for API reads, session key for FOC writes
- **SIWE** for initial wallet ownership proof
- **Hono** for server routing (replacing raw HTTP)
- **wagmi + viem** for frontend wallet connection
- **Direct GitHub REST API** (no `gh` CLI dependency)
- **Postgres** for production persistence, in-memory for local dev
