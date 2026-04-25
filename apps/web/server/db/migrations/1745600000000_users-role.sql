-- Platform role on users. Distinct from per-collection roles (owner/editor/
-- viewer, future migration) and from any future org/team roles. Two values
-- only today: 'user' (default) and 'admin' (full site-wide access). Bootstrap
-- the first admin via apps/web/server/scripts/grant-admin.ts.

-- Up Migration
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

CREATE INDEX idx_users_role ON users (role) WHERE role <> 'user';

-- Down Migration
DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE users DROP COLUMN IF EXISTS role;
