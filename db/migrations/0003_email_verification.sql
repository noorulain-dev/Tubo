-- 0003_email_verification
-- Step 71: email verification + password reset.
--
-- NOTE ON MIGRATION STRATEGY: this repository uses raw `pg` (no ORM / query
-- builder / migration runner). The canonical, idempotent schema bootstrap lives
-- in `ensureSchema()` (see apps/api/src/db.ts), which mirrors these migration
-- files with CREATE ... IF NOT EXISTS / ADD COLUMN ... IF NOT EXISTS so it is
-- safe to run on every startup. This file is the human-readable record of the
-- change; the idempotent bootstrap is what actually runs (matching the existing
-- 0001_initial.sql / 0002_tenancy.sql convention).

-- New registrations start unverified (NULL). Pre-existing rows are backfilled
-- exactly once by a guarded backfill in ensureSchema (schema_migrations marker).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Verification tokens: only the SHA-256 hash is stored; single-use, expiring.
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user ON verification_tokens(user_id);

-- Password reset tokens: hash only, single-use (used_at), expiring.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);