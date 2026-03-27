# Data Model: Wallet-Connected Collection Creation Flow

**Branch**: `121-wallet-collection-flow` | **Date**: 2026-03-26

## Entities

### WalletSession

Server-side record binding a wallet address to an authenticated session.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| wallet_address | string (42 chars) | Not null, indexed, lowercase hex `0x...` |
| cookie_token | string | Not null, unique, cryptographically random |
| session_key_encrypted | bytes | Nullable, encrypted with app key (AES-256-GCM) |
| session_key_wallet_address | string | Nullable, the wallet address the session key operates on behalf of |
| session_key_expires_at | timestamp | Nullable, when the session key becomes invalid |
| chain_id | integer | Not null, the chain the session key is scoped to (e.g., 314159 for Calibration) |
| created_at | timestamp | Not null, default now |
| last_used_at | timestamp | Not null, updated on each API call |
| revoked_at | timestamp | Nullable, set when user disconnects or explicitly revokes |

**State transitions**: active → revoked (on disconnect or explicit revoke)

**Validation rules**:
- `wallet_address` must be valid EIP-55 checksummed or lowercase hex
- `cookie_token` must be at least 32 bytes of cryptographic randomness
- `session_key_encrypted` is encrypted using `SESSION_KEY_ENCRYPTION_KEY` env var
- A wallet can have at most one active session at a time; creating a new session revokes the previous one

### Collection

A user-owned grouping of ingested knowledge segments.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| name | string (1-128 chars) | Not null, alphanumeric + hyphens + underscores |
| wallet_address | string | Not null, FK conceptual → WalletSession.wallet_address, indexed |
| status | enum | Not null, one of: `creating`, `ingesting`, `ready`, `ingestion_failed`, `promoting`, `promoted`, `promotion_failed` |
| manifest_cid | string | Nullable, set after successful promotion |
| piece_cid | string | Nullable, set after successful promotion |
| car_root_cid | string | Nullable, set after CAR bundling (promotion checkpoint) |
| promote_checkpoint | enum | Nullable, one of: `car_built`, `uploaded`, `on_chain_written` |
| source_count | integer | Not null, total sources in this collection |
| segment_count | integer | Nullable, set after ingestion completes |
| created_at | timestamp | Not null |
| updated_at | timestamp | Not null |

**State transitions**:
```
creating → ingesting → ready → promoting → promoted
                    ↘ ingestion_failed (some sources failed, may still be promotable if ≥1 succeeded)
                                         promoting → promotion_failed (resumable from checkpoint)
                                         promotion_failed → promoting (retry)
```

**Validation rules**:
- `name` must be unique per `wallet_address` (composite unique constraint)
- `name` allows only `[a-zA-Z0-9_-]`, 1-128 characters
- `manifest_cid` and `piece_cid` are set together atomically on successful promotion
- `promote_checkpoint` tracks the last successful step for resume logic

### Source

A content origin within a collection.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| collection_id | UUID | FK → Collection.id, not null, indexed |
| source_type | enum | Not null, one of: `github`, `website`, `hackernews` |
| identifier | string | Not null (e.g., `owner/repo`, `https://example.com`, `12345`) |
| status | enum | Not null, one of: `pending`, `ingesting`, `complete`, `failed` |
| error_message | string | Nullable, set on failure |
| chunk_count | integer | Nullable, set on completion |
| created_at | timestamp | Not null |
| updated_at | timestamp | Not null |

**State transitions**: `pending → ingesting → complete` or `pending → ingesting → failed`

**Validation rules**:
- `identifier` format depends on `source_type`:
  - `github`: must match `owner/repo` pattern (alphanumeric, hyphens, dots)
  - `website`: must be valid HTTPS URL
  - `hackernews`: must be numeric thread ID
- A source cannot be modified after creation (immutable except for status/error updates)

### SessionKeyAuditLog

Immutable audit trail for session key operations.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| wallet_address | string | Not null, indexed |
| operation | enum | Not null, one of: `delegated`, `used_upload`, `used_on_chain`, `revoked`, `expired`, `rotated` |
| collection_id | UUID | Nullable, FK → Collection.id (which collection the key was used for) |
| metadata | jsonb | Nullable, additional context (e.g., piece CID for uploads) |
| created_at | timestamp | Not null |

**Validation rules**:
- Append-only table, no updates or deletes
- Every session key usage MUST create an audit log entry

### Note: Ingestion Job (spec entity)

The spec defines "Ingestion Job" as a key entity. In the data model, this concept is represented by the combination of Collection.status and per-Source.status — there is no separate `jobs` table. The collection's status (`ingesting`, `ingestion_failed`) and each source's status (`pending`, `ingesting`, `complete`, `failed`) together model the job lifecycle. This avoids an extra table while preserving all the tracking behavior the spec requires.

## Relationships

```
WalletSession 1 ──── * Collection (via wallet_address)
Collection    1 ──── * Source
WalletSession 1 ──── * SessionKeyAuditLog (via wallet_address)
Collection    1 ──── * SessionKeyAuditLog (via collection_id, nullable)
```

## Indexes

- `wallet_sessions(wallet_address)` — lookup by wallet
- `wallet_sessions(cookie_token)` — lookup by session cookie (unique)
- `collections(wallet_address, name)` — unique constraint
- `collections(wallet_address, status)` — "My Collections" filtered queries
- `sources(collection_id)` — list sources per collection
- `session_key_audit_log(wallet_address, created_at)` — audit queries

## In-Memory Fallback

When `DATABASE_URL` is not set, all entities are stored in `Map<string, T>` structures. The repository interface is identical; only the backing store changes. In-memory mode does not support:
- Persistence across server restarts
- Concurrent access from multiple server instances
- Session key encryption (keys stored in plaintext in memory)
