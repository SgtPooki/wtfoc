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

-- Jobs: app-owned job records for the orchestration layer (#168).
-- pg-boss owns execution durability via its own schema (auto-migrated on
-- boss.start()). This table owns the user-facing fields the API exposes —
-- wallet scoping, collection scoping, progress, cancellation intent, parent
-- linkage, error surfacing. Never join to pg-boss schema from here.
CREATE TABLE IF NOT EXISTS jobs (
  id                    UUID PRIMARY KEY,
  boss_job_id           TEXT,
  type                  TEXT NOT NULL
    CHECK (type IN ('ingest','extract-edges','materialize','cid-pull')),
  wallet_address        TEXT NOT NULL,
  collection_id         UUID REFERENCES collections(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  phase                 TEXT,
  current               INTEGER NOT NULL DEFAULT 0,
  total                 INTEGER NOT NULL DEFAULT 0,
  message               TEXT,
  cancel_requested_at   TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  error_code            TEXT,
  error_message         TEXT,
  parent_job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_wallet_created ON jobs (wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_collection ON jobs (collection_id);
CREATE INDEX IF NOT EXISTS idx_jobs_parent ON jobs (parent_job_id);

-- "One active mutating job per collection" invariant — partial unique index
-- on the active states only, so terminal rows don't block re-enqueue (#168).
CREATE UNIQUE INDEX IF NOT EXISTS jobs_collection_active_unique
  ON jobs (collection_id)
  WHERE status IN ('queued', 'running') AND collection_id IS NOT NULL;
