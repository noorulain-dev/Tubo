import { getPool, isDbConfigured, pingDb, withTransaction } from "./client.js";

// Single Postgres client/transaction/health layer (see client.ts).
export { getPool, isDbConfigured, pingDb, withTransaction } from "./client.js";

/** Idempotent schema bootstrap — safe to run on every startup. */
export async function ensureSchema(): Promise<void> {
  if (!isDbConfigured()) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      secret text NOT NULL,
      status text NOT NULL DEFAULT 'connected',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider)
    );

    ALTER TABLE connections ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'connected';

    -- Pipeline persistence (see db/migrations/0002_tenancy.sql).
    CREATE TABLE IF NOT EXISTS app_runs (
      id         text PRIMARY KEY,
      user_id    text NOT NULL,
      mode       text NOT NULL,
      status     text NOT NULL,
      account_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      error      text,
      payload    jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_runs_user ON app_runs(user_id);

    CREATE TABLE IF NOT EXISTS app_proposals (
      id         text PRIMARY KEY,
      user_id    text NOT NULL,
      run_id     text NOT NULL,
      status     text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      payload    jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_proposals_user ON app_proposals(user_id);
    CREATE INDEX IF NOT EXISTS idx_app_proposals_run ON app_proposals(run_id);

    CREATE TABLE IF NOT EXISTS app_audit (
      id         bigserial PRIMARY KEY,
      user_id    text NOT NULL,
      run_id     text,
      event_type text NOT NULL,
      actor      text,
      level      text NOT NULL DEFAULT 'info',
      payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_app_audit_user ON app_audit(user_id);
    CREATE INDEX IF NOT EXISTS idx_app_audit_run ON app_audit(run_id);

    CREATE TABLE IF NOT EXISTS app_executions (
      execution_id       text PRIMARY KEY,
      user_id            text NOT NULL,
      proposal_signature text NOT NULL,
      result             jsonb NOT NULL,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_executions_sig ON app_executions(proposal_signature);
    CREATE INDEX IF NOT EXISTS idx_app_executions_user ON app_executions(user_id);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id                 text PRIMARY KEY,
      user_id            text NOT NULL,
      provider           text NOT NULL,
      provider_event_id  text NOT NULL,
      calendar_id        text NOT NULL,
      title              text,
      start_at           timestamptz,
      end_at             timestamptz,
      organizer_email    text,
      attendees          jsonb NOT NULL DEFAULT '[]'::jsonb,
      meeting_url        text,
      status             text NOT NULL,
      provider_updated_at timestamptz,
      synced_at          timestamptz NOT NULL DEFAULT now(),
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, provider, calendar_id, provider_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);

    CREATE TABLE IF NOT EXISTS meeting_artifacts (
      id                 text PRIMARY KEY,
      user_id            text NOT NULL,
      provider           text NOT NULL,
      provider_meeting_id text NOT NULL,
      provider_updated_at timestamptz,
      metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
      ingestion_status   text NOT NULL DEFAULT 'pending',
      interaction_id     text,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, provider, provider_meeting_id)
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_artifacts_user ON meeting_artifacts(user_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id              text PRIMARY KEY,
      user_id         text NOT NULL,
      type            text NOT NULL,
      resource_ref    text,
      payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
      scheduled_at    timestamptz NOT NULL DEFAULT now(),
      status          text NOT NULL DEFAULT 'scheduled',
      attempts        integer NOT NULL DEFAULT 0,
      max_attempts    integer NOT NULL DEFAULT 5,
      last_error_code text,
      idempotency_key text NOT NULL UNIQUE,
      created_at      timestamptz NOT NULL DEFAULT now(),
      started_at      timestamptz,
      completed_at    timestamptz
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

    CREATE TABLE IF NOT EXISTS job_events (
      id         bigserial PRIMARY KEY,
      job_id     text NOT NULL,
      user_id    text NOT NULL,
      event_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id);

    CREATE TABLE IF NOT EXISTS calendar_watch_channels (
      channel_id  text PRIMARY KEY,
      user_id     text NOT NULL,
      resource_id text,
      resource_uri text,
      token       text,
      expiration  timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_watch_user ON calendar_watch_channels(user_id);

    CREATE TABLE IF NOT EXISTS account_events (
      event_id        text PRIMARY KEY,
      user_id         text NOT NULL,
      account_id      text,
      event_type      text NOT NULL,
      occurred_at     timestamptz NOT NULL DEFAULT now(),
      source          text,
      source_reference text,
      payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
      provenance      text,
      idempotency_key text NOT NULL UNIQUE,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_account_events_user_account ON account_events(user_id, account_id, occurred_at);

    CREATE TABLE IF NOT EXISTS account_intelligence (
      account_id text NOT NULL,
      user_id    text NOT NULL,
      state      jsonb NOT NULL DEFAULT '{}'::jsonb,
      version    integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS risk_findings (
      finding_id          text PRIMARY KEY,
      user_id             text NOT NULL,
      account_id          text NOT NULL,
      type                text NOT NULL,
      severity            text NOT NULL,
      title               text NOT NULL,
      description         text,
      evidence            jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_references   jsonb NOT NULL DEFAULT '[]'::jsonb,
      signals             jsonb NOT NULL DEFAULT '[]'::jsonb,
      needs_investigation boolean NOT NULL DEFAULT false,
      status              text NOT NULL DEFAULT 'open',
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      resolved_at         timestamptz
    );
    CREATE INDEX IF NOT EXISTS idx_risk_findings_user_account ON risk_findings(user_id, account_id, status);

    CREATE TABLE IF NOT EXISTS finding_investigations (
      id         bigserial PRIMARY KEY,
      user_id    text NOT NULL,
      finding_id text NOT NULL,
      outcome    text NOT NULL,
      trace      jsonb NOT NULL DEFAULT '[]'::jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_finding_investigations_finding ON finding_investigations(finding_id);

    CREATE TABLE IF NOT EXISTS execution_plans (
      plan_id    text PRIMARY KEY,
      user_id    text NOT NULL,
      account_id text NOT NULL,
      plan       jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_execution_plans_user ON execution_plans(user_id, account_id);

    CREATE TABLE IF NOT EXISTS account_refresh_state (
      user_id    text NOT NULL,
      account_id text NOT NULL,
      state      jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS review_state (
      user_id     text NOT NULL,
      account_id  text NOT NULL,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (user_id, account_id)
    );

    -- Email verification (Step 71). Column is nullable; NULL = unverified.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      token_hash text PRIMARY KEY,
      user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_verification_tokens_user ON verification_tokens(user_id);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at    timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
  `);

  // One-time email-verification backfill: pre-migration users are treated as
  // already verified (they must never be suddenly locked out). Guarded by a
  // migration marker so it runs exactly once.
  try {
    const applied = await p.query("SELECT 1 FROM schema_migrations WHERE version = '0003_email_verification'");
    if (applied.rowCount === 0) {
      await p.query("UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL");
      await p.query("INSERT INTO schema_migrations (version) VALUES ('0003_email_verification') ON CONFLICT (version) DO NOTHING");
    }
  } catch {
    // Non-fatal: a fresh DB (no users yet) or a race on the marker is safe to ignore.
  }
}
