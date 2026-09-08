-- Revenue Execution OS — Step 50 tenancy + persistence (ADDITIVE)
-- Does not modify or drop existing tables (0001) or the users/sessions/connections
-- tables created by db.ts. Adds user-owned persistence tables that match the
-- application's runtime model (whole StoredRun / StoredProposal JSON payloads).

-- Runs owned by an authenticated user. `payload` is the full runtime StoredRun
-- (semantic, findings, gaps, proposals, activity, policyContext, error).
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

-- Proposals owned by a user, parented to a run. `payload` is the full runtime
-- StoredProposal (action, originalAction, revisions, policy, approval, execution).
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

-- Append-only audit trail, user-scoped and redacted (payload never contains secrets).
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

-- Execution idempotency records (survives restart so a proposal executes once).
CREATE TABLE IF NOT EXISTS app_executions (
  execution_id        text PRIMARY KEY,
  user_id             text NOT NULL,
  proposal_signature  text NOT NULL,
  result              jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_executions_sig ON app_executions(proposal_signature);
CREATE INDEX IF NOT EXISTS idx_app_executions_user ON app_executions(user_id);
