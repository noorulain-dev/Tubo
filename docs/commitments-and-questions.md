# Commitments and Customer Questions (Step 53)

Bounded commitment lifecycle and customer-question state, built as a
deterministic layer on the Step 52 account-intelligence state builder.

Implementation: [`state-builder.ts`](../../apps/api/src/state-builder.ts).
The snapshot types [`CommitmentState`](../../apps/api/src/state-builder.ts) and
[`QuestionState`](../../apps/api/src/state-builder.ts) are integrated directly
into [`AccountIntelligenceSnapshot`](../../apps/api/src/state-builder.ts), so no
second source of truth is introduced.

## Commitments

### Status set

`open`, `in_progress`, `fulfilled`, `overdue`, `blocked`, `cancelled`,
`superseded`, `ambiguous`.

Critical subset: `open`, `fulfilled`, `overdue`, `ambiguous`.

### Fields

`id`, `accountId`, `type` (`internal` | `customer`), `description`, `owner` +
`ownerResolution`, `dueDate` + `dueDateText` + `dueDateResolution`, `condition`,
`status`, `sourceEvidence[]`, `relatedTaskIds[]`, `relatedEmailIds[]`,
`fulfillment` (source + reference + occurredAt), `createdAt`, `updatedAt`.

### Deterministic rules

- **Overdue** — deterministic date comparison: an `open` commitment with a
  `resolved` due date in the past becomes `overdue`. No LLM involvement.
- **Fulfilled** — requires meaningful, reliably-linked evidence:
  - an explicit task completion where the task id is linked (`relatedTaskIds`), or
  - outbound Gmail evidence that carries `delivered: true` and an explicit link
    (`commitmentId` or exact `description`) plus the artifact reference.
  The builder **never** fulfils because a later email "sounds similar".
- **Ambiguous** — an unresolvable owner or deadline is left null and marked
  `ambiguous`; it is never invented, and is never coerced to `overdue`.
- **Conditional** — `conditionalCommitments` are tracked with their `condition`
  captured; tentative `candidateCommitments` ("we should…") are not promoted.
- **No duplication** — an equivalent commitment (same normalized description +
  owner) links rather than duplicates; `task_created` appends to
  `relatedTaskIds`; `task_completed` marks linked commitments `fulfilled`.

## Customer questions

### Status set

`open`, `answered`, `ambiguous`, `obsolete`.

### Fields

`id`, `question`, `sourceEvidence[]`, `askedAt`, `answer` (text + source +
reference), `answeredAt`, `status`.

### Rules

- Only explicitly-flagged questions are tracked; rhetorical/social language is
  filtered upstream and never classified as a question by the builder.
- A question resolves to `answered` only on matching answer evidence (by
  `questionId` or exact question text); an irrelevant email does not answer it.
- Duplicate questions (same normalized text) collapse to one record.
- `manual_correction` may set a question `obsolete` (e.g. the topic became moot).

## Rebuild

All of the above is deterministic: [`buildState`](../../apps/api/src/state-builder.ts)
folds the ordered event history (deduplicated by `eventId`, sorted by
`occurredAt`) and applies `deriveOverdue` against a reference clock. Given the
same events and `now`, the state is reproducible — no LLM re-call.

## Tests

[`account-intelligence.test.ts`](../../apps/api/src/__tests__/account-intelligence.test.ts)
covers open→fulfilled (task + Gmail), open→overdue, blocked, conditional,
ambiguous owner, ambiguous date, no-fuzzy-fulfilment, customer question,
question-answered-by-email, irrelevant-email-does-not-answer, duplicate question,
and similar-but-different commitments.
