import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Configure it in .env before starting the API.");
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

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
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider)
    );

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
  `);
}
