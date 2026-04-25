-- Durable nonce store for SIWE (Sign-In With Ethereum). The pre-Auth.js
-- wallet flow kept nonces in a node-local Map, which loses state on every
-- restart and breaks any future multi-pod deployment. Each nonce is
-- bound to the requesting address so a stolen nonce can't be reused for
-- a different wallet.

-- Up Migration
CREATE TABLE siwe_nonces (
  nonce        TEXT PRIMARY KEY,
  address      TEXT NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);

CREATE INDEX idx_siwe_nonces_expires ON siwe_nonces (expires_at);
CREATE INDEX idx_siwe_nonces_address ON siwe_nonces (address);

-- Down Migration
DROP INDEX IF EXISTS idx_siwe_nonces_address;
DROP INDEX IF EXISTS idx_siwe_nonces_expires;
DROP TABLE IF EXISTS siwe_nonces;
