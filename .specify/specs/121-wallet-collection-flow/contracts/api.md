# API Contract: Wallet Collection Flow

**Branch**: `121-wallet-collection-flow` | **Date**: 2026-03-26

All endpoints are JSON unless otherwise noted. Errors return `{ error: string, code: string }`.

## Authentication

### POST /api/auth/challenge

Request a SIWE challenge nonce for wallet verification.

**Request body**:
```json
{ "address": "0x1234...abcd" }
```

**Response** (200):
```json
{ "nonce": "abc123...", "message": "wtfoc.xyz wants you to sign in with your Ethereum account..." }
```

### POST /api/auth/verify

Verify a signed SIWE challenge, issue session cookie, and optionally accept a delegated session key.

**Request body**:
```json
{
  "message": "...",
  "signature": "0x...",
  "sessionKey": "0x..."
}
```
`sessionKey` is optional — can be delegated later via `/api/auth/session-key`.

**Response** (200): Sets `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
```json
{
  "address": "0x1234...abcd",
  "sessionKeyActive": true,
  "sessionKeyExpiresAt": "2026-04-02T00:00:00Z"
}
```

### POST /api/auth/session-key

Delegate or rotate a session key (requires active session cookie).

**Request body**:
```json
{
  "sessionKey": "0x...",
  "expiresAt": "2026-04-02T00:00:00Z",
  "chainId": 314159
}
```

**Response** (200):
```json
{ "sessionKeyActive": true, "sessionKeyExpiresAt": "2026-04-02T00:00:00Z" }
```

### DELETE /api/auth/session-key

Revoke the current session key. In-flight FOC operations using this key will be marked as failed.

**Response** (200):
```json
{ "sessionKeyActive": false }
```

### POST /api/auth/disconnect

Invalidate the session cookie. Session key remains valid for in-flight operations.

**Response** (200): Clears session cookie.
```json
{ "disconnected": true }
```

---

## Collections (all require session cookie)

### POST /api/collections

Create a new collection and start ingestion.

**Request body**:
```json
{
  "name": "my-collection",
  "sources": [
    { "type": "github", "identifier": "owner/repo" },
    { "type": "website", "identifier": "https://example.com" },
    { "type": "hackernews", "identifier": "12345678" }
  ]
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "name": "my-collection",
  "status": "ingesting",
  "sources": [
    { "id": "uuid", "type": "github", "identifier": "owner/repo", "status": "pending" }
  ],
  "createdAt": "2026-03-26T..."
}
```

**Errors**:
- 400: Invalid source identifier format
- 409: Collection name already exists for this wallet
- 429: Rate limit exceeded (per-wallet job creation limit)

### GET /api/collections

List all collections owned by the authenticated wallet.

**Response** (200):
```json
{
  "collections": [
    {
      "id": "uuid",
      "name": "my-collection",
      "status": "ready",
      "sourceCount": 3,
      "segmentCount": 42,
      "manifestCid": null,
      "createdAt": "2026-03-26T...",
      "updatedAt": "2026-03-26T..."
    }
  ]
}
```

### GET /api/collections/:id

Get collection detail including per-source ingestion status.

**Response** (200):
```json
{
  "id": "uuid",
  "name": "my-collection",
  "status": "ingesting",
  "manifestCid": null,
  "pieceCid": null,
  "sources": [
    { "id": "uuid", "type": "github", "identifier": "owner/repo", "status": "complete", "chunkCount": 120 },
    { "id": "uuid", "type": "website", "identifier": "https://example.com", "status": "ingesting", "chunkCount": null },
    { "id": "uuid", "type": "hackernews", "identifier": "12345678", "status": "failed", "error": "Thread not found" }
  ],
  "createdAt": "2026-03-26T...",
  "updatedAt": "2026-03-26T..."
}
```

**Errors**:
- 404: Collection not found or not owned by this wallet

### POST /api/collections/:id/promote

Start FOC promotion for a collection. Requires active session key.

**Response** (202):
```json
{
  "id": "uuid",
  "status": "promoting",
  "promoteCheckpoint": null
}
```

**Errors**:
- 400: Collection not in `ready` or `promotion_failed` status
- 403: Session key expired or revoked — must delegate new key
- 409: Promotion already in progress (returns current status)

### GET /api/collections/:id/promote/status

Check promotion progress.

**Response** (200):
```json
{
  "status": "promoting",
  "checkpoint": "uploaded",
  "manifestCid": null,
  "pieceCid": "baga...",
  "carRootCid": "bafy..."
}
```

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/collections | 10 per wallet | 1 hour |
| POST /api/auth/challenge | 20 per IP | 1 minute |
| All authenticated endpoints | 100 per wallet | 1 minute |

## Cookie Properties

| Property | Value |
|----------|-------|
| Name | `wtfoc_session` |
| HttpOnly | true |
| Secure | true |
| SameSite | Strict |
| Path | /api |
| Max-Age | 7 days (configurable) |
