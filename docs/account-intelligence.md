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

---

# Step 52 — Account Intelligence State Builder

The deterministic reducer that turns the ordered event ledger into the latest
structured account state. Implementation lives in
[`state-builder.ts`](../../apps/api/src/state-builder.ts); the ledger/persistence
functions remain in [`account-intelligence.ts`](../../apps/api/src/account-intelligence.ts).

## Core invariant: one source of truth

The snapshot is not incrementally mutated; it is **rebuilt** by folding over the
full ordered event history. [`buildState`](../../apps/api/src/state-builder.ts)
sorts events by `occurredAt` (stable tie-break by `eventId`), de-duplicates by
`eventId`, and applies the pure [`reduceEvent`](../../apps/api/src/state-builder.ts)
per event. Semantic outputs are persisted verbatim in each event payload, so a
rebuild never re-calls the LLM.

## State-building rules

- **Meeting commitment → open commitment.** Only `confirmedCommitments` become
  open commitments. `candidate`/`conditional` commitments (tentative language) are
  intentionally ignored — "we should…" is never promoted.
- **Equivalent existing HubSpot task → link, do not duplicate.** An equivalent
  commitment (same action + owner) links to the existing record; `task_created`
  sets `linkedTaskId`; `task_completed` marks the linked commitment `fulfilled`.
- **Gmail proves delivery → fulfillment candidate.** An `email_observed` event
  with delivery evidence marks the matched commitment `fulfilled` with source
  `gmail`.
- **Commercial ACTIVE → commercial state updates.** `commercial` is written only
  by `commercial_state_observed` (authoritative). Conversational intent is evidence
  and never overwrites it.
- **HubSpot stage stays Trial → preserve separately.** `stage` (CRM, hubspot
  authoritative) and `commercial` (subscription, commercial authoritative) are
  distinct fields; one never overwrites the other.
- **Task completed → linked work updates** where evidence is strong (task id link).
- **Newer authoritative evidence → supersedes stale latest fact**; the historical
  event remains in the ledger (`recentEvents`).
- **Ambiguous evidence → `ambiguous` state**, never silently resolved.
- **Provider unavailable → `missing_context`, never guessed.** A refresh that
  cannot load a source records it in `unavailableSources` and leaves dependent
  facts null.

## Authority hierarchy

| Fact type | Authoritative source | Evidence-only source |
|-----------|----------------------|----------------------|
| Subscription/payment/commercial truth | `commercial` | `conversation` intent |
| What the customer literally promised/asked | `conversation` | CRM metadata |
| Whether an operational task exists | `tasks` / `hubspot` | transcript inference |
| CRM stage/owner | `hubspot` | conversation |
| Sent communication / document delivered | `gmail` | conversation |

A weaker source can never overwrite a stronger one — enforced structurally by
writing each fact to its own field (`stage` vs `commercial`) and by only allowing
authoritative event types to mutate single-value facts.

## Non-goals (explicit)

- No owner inference from vague "we"/"our team".
- "almost done" is never turned into `completed`.
- LLM confidence is never used as state-change authorization.

## Tests

[`account-intelligence.test.ts`](../../apps/api/src/__tests__/account-intelligence.test.ts)
covers the eight multi-event sequences: commitment→task→completion, question→answer,
commercial-active/CRM-Trial, ambiguous→owner-resolution, newer-supersedes-older,
duplicate event, out-of-order event, and provider-unavailable — plus reproducibility
and no-duplicate/no-inference guards.