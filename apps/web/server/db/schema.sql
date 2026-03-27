-- wtfoc wallet collection flow schema
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Wallet sessions: binds wallet address to authenticated session
CREATE TABLE IF NOT EXISTS wallet_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  cookie_token   TEXT NOT NULL UNIQUE,
  session_key_encrypted BYTEA,
  session_key_wallet_address TEXT,
  session_key_expires_at TIMESTAMPTZ,
  chain_id       INTEGER NOT NULL DEFAULT 314159,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_sessions_address ON wallet_sessions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_cookie ON wallet_sessions (cookie_token);

-- Collections: user-owned groupings of ingested knowledge segments
CREATE TABLE IF NOT EXISTS collections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','ingesting','ready','ingestion_failed','promoting','promoted','promotion_failed')),
  manifest_cid   TEXT,
  piece_cid      TEXT,
  car_root_cid   TEXT,
  promote_checkpoint TEXT
    CHECK (promote_checkpoint IS NULL OR promote_checkpoint IN ('car_built','uploaded','on_chain_written')),
  source_count   INTEGER NOT NULL DEFAULT 0,
  segment_count  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, name)
);

CREATE INDEX IF NOT EXISTS idx_collections_wallet ON collections (wallet_address, status);

-- Sources: content origins within a collection
CREATE TABLE IF NOT EXISTS sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  source_type    TEXT NOT NULL CHECK (source_type IN ('github','website','hackernews')),
  identifier     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ingesting','complete','failed')),
  error_message  TEXT,
  chunk_count    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sources_collection ON sources (collection_id);

-- Session key audit log: immutable trail of session key operations
CREATE TABLE IF NOT EXISTS session_key_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  operation      TEXT NOT NULL
    CHECK (operation IN ('delegated','used_upload','used_on_chain','revoked','expired','rotated')),
  collection_id  UUID REFERENCES collections(id),
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_wallet ON session_key_audit_log (wallet_address, created_at);
