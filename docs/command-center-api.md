# Revenue Command Center API (Step 57)

Backend/API only — no frontend yet. Answers the default operational question
**"What needs my attention?"** per authenticated user, entirely from persisted
state.

Implementation: [`command-center.ts`](../../apps/api/src/command-center.ts).
New table: `review_state` ([`db.ts`](../../apps/api/src/db.ts)).

## Dashboard (`GET /command-center`)

Returns the user's accounts requiring attention, each as an `AccountRow`:

`accountId`, `identity`, `stage`, `commercial`, `highestSeverity`, `topFinding`,
`openCommitments`, `openQuestions`, `blockerCount`/`blocked`,
`lastMeaningfulEventAt`, `pendingCount`, `lastReviewedAt`, `updatedAt`.

Query params: `limit` (default 50), `offset` (default 0). Returns `{ rows, total, limit, offset }`.

## Priority (deterministic, no LLM score)

`priorityScore` = `severityRank(highestSeverity) * 1e15 + recency + open-item
volume`. Accounts sort by severity first (`critical` > `high` > `medium` > `low`),
then by recency of the last meaningful event, then by open-item volume.
`sortAccounts` applies this deterministically.

## Account detail (`GET /command-center/accounts/:accountId`)

Returns: Account Intelligence snapshot, structured "what changed since last
review" (`computeChanges`), CRM vs commercial state, commitments, questions,
blockers, findings, latest investigation, execution plans, recent events, and
`lastReviewedAt`.

## Mark reviewed (`POST /command-center/accounts/:accountId/reviewed`)

Persists `reviewed_at` and a copy of the current snapshot into `review_state`.
"What changed since last review" compares the current snapshot against that
captured snapshot deterministically (stage/commercial changes, new/resolved
commitments, new/answered questions, new/resolved blockers, `eventsSince`). The AI
may summarize the structured change set, but the underlying diff is deterministic.

## Performance

The dashboard reads directly from the DB (`account_intelligence`, `risk_findings`,
`review_state`) with per-user `WHERE user_id = $1` scoping — no N+1 provider/API
calls. `risk_findings` is indexed on `(user_id, account_id, status)`.

## Tenant isolation

Every query is scoped to the authenticated `user_id`; an account for one user
never merges with another user's account of the same company name.

## Tests

[`command-center.test.ts`](../../apps/api/src/__tests__/command-center.test.ts)
covers priority ordering, tenant isolation, resolved-finding disappearance,
new-finding appearance, last-reviewed diff, pagination, empty dashboard, and
many-accounts determinism.
