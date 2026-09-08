# Continuous Tracked-Account Source Refresh (Step 61)

Accounts already known to Revenue Execution OS update when their connected
operational state changes — without mirroring the customer's entire HubSpot/Gmail
universe, and without any Sample Mode / event simulator.

Implementation: [`account-refresh.ts`](../../apps/api/src/account-refresh.ts),
job handler in [`job-handlers.ts`](../../apps/api/src/job-handlers.ts), scheduling
in [`worker.ts`](../../apps/api/src/worker.ts).

## Tracked accounts

Only accounts Revenue OS currently tracks are refreshed: accounts created from
processed interactions, with open findings/commitments, or recently active
(`account_intelligence.updated_at` within 30 days, or open findings).

## `account.refresh` job

For one tracked account, selectively reads:

- HubSpot deal (stage)
- relevant open tasks
- HubSpot commercial context (subscription status)
- known Gmail threads (only ids already associated with the account via
  commitment email references — never a mailbox scan)

## Change detection

Source state is normalized/fingerprinted
([`fingerprintSource`](../../apps/api/src/account-refresh.ts)) and compared to the
previous fingerprint (`account_refresh_state` table). On material change,
[`detectChanges`](../../apps/api/src/account-refresh.ts) emits AccountEvents:

- HubSpot task completed → `task_completed`
- deal stage changed → `crm_state_observed`
- commercial status changed → `commercial_state_observed`
- relevant Gmail reply → `email_observed`
- provider became unavailable → `*_observed { unavailable: true }` (never a
  fabricated value)

Each emitted event rebuilds Account Intelligence and re-runs the scanner via the
existing `appendAccountEvent` path.

## Schedule

Conservative, configurable interval (hourly idempotency bucket), reusing the
existing durable worker — no third-party API hammering, and rate limits are
respected (transient 429 retries with backoff).

## Manual refresh

- UI: **Refresh Account** on the account page → `POST /accounts/:accountId/refresh`
  (enqueues `account.refresh`).
- Test utility: `npm run assessment:refresh-account -- --account <id>` runs the same
  real refresh pipeline for the configured test account (no fabricated events).

## Expected demo (HELIO)

Deal = Trial, commercial = inactive → later the test HubSpot record becomes
commercial = ACTIVE → Refresh Account (or worker refresh) → new
`commercial_state_observed` event → Account Intelligence updates → scanner flags
the CRM/commercial mismatch → Command Center priority changes.

## Tests

[`account-refresh.test.ts`](../../apps/api/src/__tests__/account-refresh.test.ts)
covers: no change = no event, task completed, commercial change, deal change, known
Gmail reply, duplicate refresh, provider unavailable, rate limit (transient, not
fabricated), and tenant isolation.
