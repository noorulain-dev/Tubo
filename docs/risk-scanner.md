# Revenue Execution Gap / Risk Scanner (Step 54)

Continuous scanner that, given persisted Account Intelligence, identifies accounts
requiring human attention. It reuses Step-50 reconciliation/execution-gap
primitives (via `snapshot.reconciliationGaps`) and Step-53 commitment/question
state — it does **not** create a competing truth system.

Implementation: [`risk-scanner.ts`](../../apps/api/src/risk-scanner.ts).
Findings persist in the `risk_findings` table (see
[`db.ts`](../../apps/api/src/db.ts)).

## Finding model

`finding_id`, `user_id`, `account_id`, `type`, `severity`, `title`, `description`,
`evidence[]`, `source_references[]`, `signals[]` (deterministic severity inputs),
`needs_investigation`, `status` (`open` | `resolved`), `created_at`, `updated_at`,
`resolved_at`.

## Finding types (only those supported by available data)

| Type | Deterministic signal |
|------|----------------------|
| `overdue_internal_commitment` | internal commitment with `overdue` status; `days_overdue` |
| `unanswered_customer_question` | open question; `question_age_days` |
| `missing_operational_task` | open/in_progress commitment with empty `relatedTaskIds` |
| `stale_crm_state` | CRM stage present but `lastSourceRefresh` older than 7 days |
| `commercial_crm_mismatch` | commercial paying + CRM stage Trial/Closed Lost |
| `trial_expiring_with_open_blocker` | stage Trial + non-empty `blockers` |
| `customer_waiting_on_us` | open internal commitment with upcoming resolved deadline |
| `missing_next_step` | open work but empty `nextSteps` |
| `duplicate_action` | reconciliation gap of type `duplicate` |
| `contradictory_state` | reconciliation gap of type `contradictory` |
| `missing_required_context` | non-empty `unavailableSources` |

## Severity

Never an LLM "0–100 score". Severity is mapped from observable signals only:

- days overdue → `critical` (≥7) / `high` (≥3) / `medium` (otherwise)
- question age → `high` (≥7d) / `medium` (≥3d) / `low`
- commercial/CRM mismatch → `high`, or `critical` when Closed Lost + paying
- trial + blocker → `high`
- days until due → `critical` (≤1) / `high` (≤3) / `medium`
- stale CRM → `low`, or `medium` when ≥30d
- missing required context → `high` when commercial/hubspot unavailable

The AI may explain a finding in prose but may not invent the underlying signal.

## Lifecycle

`scanAccount` recomputes findings from the current snapshot each time, so:

- a finding **appears** when its condition becomes true,
- **persists** while the condition remains,
- **resolves** when evidence changes (e.g. a question gets answered),
- and **never duplicates** on repeated scans (stable `finding_id`).

[`reconcileFindings`](../../apps/api/src/risk-scanner.ts) diffs the new scan against
persisted findings: matching open findings are kept/refreshed, new ones are created,
and open findings whose condition no longer holds are marked `resolved`.

## Triggers

`appendAccountEvent` calls
[`scanAndPersistAccount`](../../apps/api/src/risk-scanner.ts) after a material
account-state update (manual interaction, Fireflies meeting, executor action). The
scanner is also structured for a future scheduled refresh over all accounts.

## Provider unavailable

An unavailable required provider yields `missing_required_context` — never `aligned`
and never a fabricated state.

## Tests

[`risk-scanner.test.ts`](../../apps/api/src/__tests__/risk-scanner.test.ts) covers:
overdue commitment, answered-question disappearance, missing task, task-later-exists,
commercial-active/CRM-Trial, commercial unavailable, duplicate task, customer
waiting, missing next step, idempotent rescans, and finding resolution.
