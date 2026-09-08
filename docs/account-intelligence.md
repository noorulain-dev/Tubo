# Account Intelligence (Step 51)

Persistent operational understanding per account — not a generic AI summary.
The AI understands/investigates/proposes; deterministic systems control
authority/policy/consequences.

## Account event ledger

`account_events` (immutable append-style): `event_id`, `user_id`, `account_id`,
`event_type`, `occurred_at`, `source`, `source_reference`, structured `payload`,
`provenance`, unique `idempotency_key`, `created_at`. Supported types include
`interaction_processed`, `meeting_processed`, `manual_interaction_processed`,
`email_observed`, `crm_state_observed`, `task_created`, `commercial_state_observed`,
`proposal_approved/rejected`, `external_action_executed`, `manual_correction`.
Future provider-refresh types fit without schema replacement.

## Intelligence snapshot

`account_intelligence` holds the latest structured state per `(user_id, account_id)`
with a monotonic `version`. Snapshot fields (identity company/contact/deal, stage,
commercial state + provenance, decisions, open/customer commitments, questions,
blockers, next steps, recent events, execution gaps, lastReviewed,
lastSourceRefresh) are populated only from evidence, never invented.

## Provenance

Every material fact carries provenance/evidence (e.g. commercial state from
HubSpot commercial context, task state from HubSpot task). No hidden
chain-of-thought is stored.

## Versioning

[`applyEvent`](../../apps/api/src/account-intelligence.ts) is a pure, append-only
derivation: each event increments `version` and updates the snapshot without
destroying history. Records are idempotent by `idempotency_key`; out-of-order or
duplicate events do not double-apply or erase state.

## Tenancy

Everything is scoped to the authenticated user. An account for User A never merges
with User B simply because the HubSpot company name matches.

## Event ingestion wiring

Manual processing (`POST /interactions`) records `manual_interaction_processed`
(provenance `manual`); Fireflies ingestion records `meeting_processed`
(provenance `fireflies`); future executor/CRM events append their corresponding
event types. Idempotency keys derive from the run/meeting identity.

## API

- `GET /accounts` — list the user's accounts.
- `GET /accounts/:accountId/intelligence` — current snapshot.
- `GET /accounts/:accountId/events` — event history (ordered).

## Tests

[`account-intelligence.test.ts`](../../apps/api/src/__tests__/account-intelligence.test.ts)
covers version increment, recent-event prepending, commercial provenance,
lastReviewed, and non-destructive capped history. DB-backed behaviors (idempotency,
isolation, restart persistence, out-of-order) are exercised by the unique-key +
`(user_id, account_id)` keying.

---

## MANUAL CHECKPOINT 51

To prove one account retains state across two separate interactions:

1. Sign in and run a **Manual Process Interaction** against `demo_stale` ("Fjord has
   subscribed and is now paying.").
2. Run a **second** interaction against the same account (e.g. "I'll send the revised
   security documentation by Friday.").
3. In a browser/HTTP client, GET `/accounts` → it lists `demo_stale`; GET
   `/accounts/demo_stale/events` → both `manual_interaction_processed` events appear in
   order; GET `/accounts/demo_stale/intelligence` → `version >= 2`, `stage` reflects the
   latest observed stage, and `recentEvents` contains both interactions — proving state
   accumulated across the two runs.