-- Human-in-the-loop context resolution audit trail.
-- Append-only: rows are never updated or deleted, so the original ambiguity and
-- who answered it remain recoverable forever.

CREATE TABLE IF NOT EXISTS context_resolutions (
  resolution_id      text PRIMARY KEY,
  user_id            text NOT NULL,
  account_id         text NOT NULL,
  gap_id             text NOT NULL,
  gap_type           text NOT NULL,
  subject_kind       text NOT NULL,
  subject_id         text NOT NULL,
  subject_label      text NOT NULL DEFAULT '',
  question           text NOT NULL DEFAULT '',
  original_ambiguity jsonb NOT NULL DEFAULT '[]'::jsonb,
  choice_kind        text NOT NULL,
  selected_label     text NOT NULL DEFAULT '',
  selected_value     jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance         text NOT NULL DEFAULT 'human_supplied',
  resolved_by        text NOT NULL,
  resolved_by_name   text,
  resolved_at        timestamptz NOT NULL DEFAULT now(),
  account_event_id   text,
  run_id             text,
  finding_id         text
);

CREATE INDEX IF NOT EXISTS idx_context_resolutions_user_account ON context_resolutions(user_id, account_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_resolutions_gap ON context_resolutions(user_id, gap_id);

INSERT INTO schema_migrations (version) VALUES ('0006_context_resolutions') ON CONFLICT (version) DO NOTHING;
