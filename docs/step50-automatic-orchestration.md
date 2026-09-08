# Step 50.9 — Automatic Orchestration

One product runtime, two entry paths, one canonical pipeline.

## Entry paths

- **Manual** — authenticated user pastes notes/transcript via Process Interaction.
- **Automatic Fireflies** — background `fireflies.sync` discovers an artifact the user's
  own Fireflies already produced, then `fireflies.fetch` → `interaction.process`.

Both converge into `RunService.process(input, userId)`.

## Canonical input

[`buildCanonicalInteraction`](../../apps/api/src/canonical-interaction.ts) normalizes a
`MeetingArtifact` into the same `InteractionInput` (kind `meeting`, transcript text,
participants, resolved account id) plus `SourceMetadata` (source_type, provider meeting
id, calendar event id, title, date, participants, summary, action-item hints, provenance).
Fireflies action items are **hints only** — never authoritative truth.

## Automatic pipeline

[`ingestMeetingArtifact`](../../apps/api/src/fireflies-ingest.ts): load artifact →
correlate Calendar (strongest evidence first) → resolve HubSpot account/contact/deal
(exact email strongest) → build canonical input → run the SAME `SemanticInterpreter` +
bounded read-only reasoning agent + reconciliation + policy + executor. Returns
`needs_review | completed_no_action | unresolved_account | failed`. Idempotency is keyed
by `(user, provider, meeting id)` so duplicate discovery/retry/webhook/refresh never
duplicate an artifact, interaction, run, proposal, or external mutation.

The worker registers the live `RunService` via [`pipeline-service.ts`](../../apps/api/src/pipeline-service.ts)
so background jobs reuse the exact engine the manual path uses — no second reasoning system.

## Read-only agent, policy, proposals

The agent keeps the existing read-only tool registry (no HubSpot write, no Gmail
createDraft, no approval/executor). Supported proposal types remain
`CREATE_HUBSPOT_TASK`, `CREATE_HUBSPOT_NOTE`, `UPDATE_HUBSPOT_NEXT_STEP`,
`UPDATE_HUBSPOT_DEAL_STAGE`, `CREATE_GMAIL_DRAFT` — a draft is only proposed when a
follow-up need is grounded in evidence, never merely because Gmail exists. No email send.
Consequential mutations remain policy/approval controlled.

## Provider failures

`HubSpot unavailable`, `Gmail unavailable`, `commercial context unavailable`,
`account unresolved`, `AI/schema failure`, `policy blocked`, `external execution
failure` are distinct states — a provider being unavailable is never "no record exists".

## Tests

[`fireflies-ingest.test.ts`](../../apps/api/src/__tests__/fireflies-ingest.test.ts) proves
canonical-input normalization and the ingest outcomes (resolved → needs_review /
completed_no_action; unresolved → unresolved_account; missing artifact → failed).

---

## MANUAL CHECKPOINT 50.9 (≤10 minutes, browser-only)

1. Sign in. On **Process Interaction**, run the sample account `demo_stale` ("Fjord has
   subscribed and is now paying") — confirm a run appears with **Source: Manual**,
   reconciliation "stale", and a `Trial → Closed Won` proposal in **Needs review**.
2. Open that run and click **Execute before approving** — confirm it is **blocked**.
3. **Approve** the stage-change proposal, then **Execute** — confirm status becomes
   "executed" and no duplicate appears when you click Execute again.
4. Confirm the run persists after a page refresh (Runs list still shows it, proposal
   status "executed").
5. (Fireflies path) if you have a connected Fireflies meeting, run `npm run worker` and
   confirm an automatic run appears in **Runs** with **Source: Fireflies** and the meeting
   title/date — without you clicking Analyze — ending in `needs_review`, `completed_no_action`,
   or `unresolved_account` (never a generic "AI failed").
