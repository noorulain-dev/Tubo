-- Revenue Execution OS — initial schema
-- PostgreSQL. Uses gen_random_uuid() (built into Postgres >= 13).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Operational anchor: the external account we reconcile against.
CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  domain      text,
  name        text NOT NULL,
  source      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Incoming customer interaction (untrusted raw input).
CREATE TABLE interactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  raw_text    text NOT NULL,
  truncated   boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Top-level processing run.
CREATE TABLE runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid REFERENCES accounts(id) ON DELETE SET NULL,
  interaction_id    uuid REFERENCES interactions(id) ON DELETE SET NULL,
  status            text NOT NULL,
  model             text,
  latency_ms        integer,
  prompt_tokens     integer,
  completion_tokens integer,
  cost_usd          numeric(12, 6),
  error             text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

-- Semantic items extracted by the interpreter (one row per item).
CREATE TABLE semantic_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind       text NOT NULL, -- decision | commitment | conditional_commitment | task_candidate | commercial_signal
  payload    jsonb NOT NULL,
  resolution text NOT NULL,
  evidence   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Agent invocation within a run.
CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status          text NOT NULL,
  tool_budget_used integer NOT NULL DEFAULT 0,
  tool_budget_max integer NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- Individual read-only tool invocation by the agent.
CREATE TABLE tool_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id    uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name       text NOT NULL,
  reason_category text NOT NULL,
  args            jsonb NOT NULL DEFAULT '{}'::jsonb,
  result          jsonb,
  ok              boolean NOT NULL,
  source          text,
  authority       text,
  latency_ms      integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Immutable capture of a source's state at retrieval time.
CREATE TABLE source_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source      text NOT NULL,
  authority   text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL
);

-- Reconciliation outcome for a single semantic claim.
CREATE TABLE reconciliation_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  claim_ref      text NOT NULL,
  classification text NOT NULL, -- missing | duplicate | contradictory | stale | ambiguous | unsafe | aligned
  evidence       jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Actionable execution gap derived from reconciliation.
CREATE TABLE execution_gaps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  reconciliation_id uuid REFERENCES reconciliation_results(id) ON DELETE SET NULL,
  type              text NOT NULL,
  what              text NOT NULL, -- changed | missing | stale | conflict | needs_review
  title             text NOT NULL,
  description       text NOT NULL,
  severity          text NOT NULL DEFAULT 'warning',
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Proposed action produced from a gap.
CREATE TABLE proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  gap_id            uuid REFERENCES execution_gaps(id) ON DELETE SET NULL,
  action_type       text NOT NULL,
  target            text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_approval boolean NOT NULL DEFAULT false,
  blocked           boolean NOT NULL DEFAULT false,
  review_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Deterministic policy decision for a proposal.
CREATE TABLE policy_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,
  decision    text NOT NULL, -- allow | block | require_approval
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowlisted boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Human approval/edit/reject of a proposal.
CREATE TABLE approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  proposal_id    uuid REFERENCES proposals(id) ON DELETE SET NULL,
  decision       text NOT NULL, -- approve | reject | edit
  reviewer       text NOT NULL,
  edited_payload jsonb,
  comment        text,
  decided_at     timestamptz NOT NULL DEFAULT now()
);

-- Result of executing an approved, allowlisted action.
CREATE TABLE executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  proposal_id     uuid REFERENCES proposals(id) ON DELETE SET NULL,
  status          text NOT NULL, -- pending | success | failed | skipped
  idempotency_key text NOT NULL UNIQUE,
  external_ref    text,
  error           text,
  executed_at     timestamptz
);

-- Human corrections to a proposal payload.
CREATE TABLE user_corrections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  proposal_id       uuid REFERENCES proposals(id) ON DELETE SET NULL,
  corrected_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Evaluation run (assessment harness) metrics.
CREATE TABLE evaluation_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid REFERENCES runs(id) ON DELETE SET NULL,
  case_id    text NOT NULL,
  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail (redacted payloads only).
CREATE TABLE audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid REFERENCES runs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor      text,
  level      text NOT NULL DEFAULT 'info',
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common lookups.
CREATE INDEX idx_interactions_account ON interactions(account_id);
CREATE INDEX idx_runs_account ON runs(account_id);
CREATE INDEX idx_semantic_items_run ON semantic_items(run_id);
CREATE INDEX idx_tool_calls_agent_run ON tool_calls(agent_run_id);
CREATE INDEX idx_source_snapshots_run ON source_snapshots(run_id);
CREATE INDEX idx_reconciliation_run ON reconciliation_results(run_id);
CREATE INDEX idx_gaps_run ON execution_gaps(run_id);
CREATE INDEX idx_proposals_run ON proposals(run_id);
CREATE INDEX idx_approvals_run ON approvals(run_id);
CREATE INDEX idx_executions_run ON executions(run_id);
CREATE INDEX idx_audit_run ON audit_events(run_id);
CREATE INDEX idx_audit_created ON audit_events(created_at);
