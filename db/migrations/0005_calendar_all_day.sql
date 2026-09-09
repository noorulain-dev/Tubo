-- Revenue Execution OS — Step 72.4 calendar panel (ADDITIVE).
-- Distinguish all-day events (Google all-day start.date events) from timed events
-- so the calendar panel can render them in a separate compact row.

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;