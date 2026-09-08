# Evidence-Backed Execution Plans (Step 56)

A **thin coordination layer** over the existing `ProposedAction` architecture. A
confirmed account issue may require several coordinated actions; each action
remains an independently policy-controlled `ProposedAction`.

Implementation: [`execution-plans.ts`](../../apps/api/src/execution-plans.ts).

## Model

```
ExecutionPlan:
  plan_id, account_id, finding_ids, objective, summary, evidence, actions[], created_at

ExecutionPlanAction:
  actionId, action (ProposedAction), policy (PolicyEvaluation), status,
  dependsOn[], dependencyBlocked, approval?, execution?
```

`plan_id` is derived deterministically from `(account_id, objective, finding_ids)`,
so identical plans do not duplicate.

## What the AI may do

Summarize the objective, sequence candidate actions, draft grounded email copy,
explain evidence, and connect related findings.

## What the AI may NOT do

Invent owner, invent deadline, invent a commercial fact, override policy, approve
itself, execute, or send email. These are enforced deterministically:

- A `create_task` without a resolved owner is **blocked** (`ambiguous_owner`) —
  the owner is never fabricated.
- A `create_draft` with `send: true` is **blocked** (`external_send_requested`).
- Every action is re-validated server-side via
  [`evaluateAction`](../../packages/core/src/policy/engine.ts); LLM/agent output has
  zero policy authority.

## Partial approval

A user may approve/reject/edit an individual action, or approve all eligible
actions. Each decision is applied per-action; editing re-runs server-side policy
revalidation. A blocked action does **not** block unrelated safe actions — only an
explicit `dependsOn` link blocks a downstream action.

## Dependencies

`dependsOn: string[]` (action ids). If action B depends on action A and A is not
yet `approved`/`executed`, B is marked `dependencyBlocked` and its status becomes
`blocked`. There is no generic workflow language — just a directed, per-action
dependency list.

## Execution

`executeApproved` executes only `approved` actions independently (delegating to the
existing deterministic executor); a failure marks only that action `failed`.

## Tests

[`execution-plans.test.ts`](../../apps/api/src/__tests__/execution-plans.test.ts)
covers: three-action plan, one blocked action, one rejected action, edited-action
revalidation, ambiguous-owner-blocks-task-but-not-note, Gmail draft (and send
blocked), deal-stage high risk, partial execution, duplicate plan creation, and
dependency blocking.
