-- Auth.js (@auth/pg-adapter) schema for wtfoc accounts.
-- Column names are quoted camelCase because the adapter's SQL is hardcoded
-- to reference "userId", "emailVerified", "providerAccountId", "sessionToken".
-- IDs are UUIDs (matching the rest of wtfoc's schema) rather than SERIAL —
-- the adapter passes id values through opaquely, so UUID works fine.

-- Up Migration
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT,
  email          TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT,
  UNIQUE (provider, "providerAccountId")
);

CREATE INDEX idx_accounts_user ON accounts ("userId");

CREATE TABLE sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL,
  "sessionToken" TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_sessions_user ON sessions ("userId");

CREATE TABLE verification_token (
  identifier TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- Link collections to Auth.js users. wallet_address stays (SIWE will land as
-- a secondary identity via an accounts row with provider='siwe'); owner_user_id
-- is nullable for now so existing wallet-only collections keep working.
ALTER TABLE collections ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_collections_owner_user ON collections (owner_user_id);

-- Down Migration
DROP INDEX IF EXISTS idx_collections_owner_user;
ALTER TABLE collections DROP COLUMN IF EXISTS owner_user_id;
DROP TABLE IF EXISTS verification_token;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;
