-- Revenue Execution OS — Step 71B.14 evaluator (demo) workspace (ADDITIVE).
-- Adds a per-user flag marking a dedicated evaluator/demo account. Evaluator
-- accounts are a distinct tenant whose records are synthetic ("[ASSESSMENT]")
-- and whose external (HubSpot/Gmail) execution is disabled. Does NOT weaken
-- tenancy: all persistence tables remain user-scoped by user_id.

ALTER TABLE users ADD COLUMN IF NOT EXISTS evaluator boolean NOT NULL DEFAULT false;