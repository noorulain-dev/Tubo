# Revenue Execution OS — Architecture Plan

> Status: PLANNING (locked product definition — no implementation in this step).
> This document is the single source of truth for the build. It supersedes any earlier scaffolding-only direction.

---

## 1. Current repo state

Inspected the repository root recursively. What actually exists:

| Path | Purpose |
|---|---|
| `evals/cases.json` | 12 synthetic evaluation cases with fixtures (`transcript`, `hubspot`, `gmail`, `tasks`, `commercial`). |
| `evals/expected.json` | Gold behavior for the 12 cases (7 dimensions + 13 product rules + canonical classifications). |
| `research/baseline-runs.csv` | 3 simulated manual-workflow baseline rows. |
| `research/manual-baseline-method.md` | Field definitions + honesty/provenance statement. |

What does **not** exist yet (referenced in the directive but absent):

- `directive.md` — the locked product definition is in the directive prompt, not yet persisted to a file.
- `README.md`
- `docs/` (this file creates it)
- Any application source code
- `package.json` / `tsconfig` / workspace config
- Database schema / migrations
- Infrastructure / deployment config
- `evals/baseline-results.json` and the naive-baseline runner (`scripts/run-baseline.ts`) — **pending**, to be delivered as an evaluation hook (item 19), not as part of the product.

## 2. What can be reused

- **`evals/cases.json` + `evals/expected.json`** — reuse verbatim as the eval corpus and gold labels. Their canonical classifications (`missing`, `duplicate`, `contradictory`, `stale`, `ambiguous`, `unsafe`, `aligned`) already match the locked product definition exactly. No changes needed.
- **The 13 product rules** in `expected.json` `meta.product_rules` — these are the seed for the deterministic policy layer; they encode the same rules as the locked definition.
- **`research/*`** — reuse as the manual-baseline comparison and as the model for honest provenance (synthetic, not measured telemetry).
- **Fixture shapes** (`hubspot`, `gmail`, `tasks`, `commercial`) — these define the integration adapter contracts (item 8/10).

## 3. What needs replacing (or building from scratch)

- Everything application-side: there is no interpreter, agent, retrieval, reconciliation, policy, executor, API, database, frontend, or deployment.
- No existing `package.json`, so the workspace, toolchain, and dependency choices are open.
- `directive.md` should be created (content = the locked product definition) so the repo is self-describing.

## 4. Proposed final folder/module structure

Single TypeScript workspace (npm workspaces). Deliberately thin — no microservices, no shared UI kit.

```
tubo/
  directive.md
  README.md
  .env.example
  package.json                 # root workspace scripts
  tsconfig.base.json
  apps/
    api/                       # backend service (Node + TS, Hono/Fastify) -> Railway
      src/
        server.ts
        routes/
        integrations/          # hubspot.ts, gmail.ts, commercial.ts (adapter contracts)
        pipeline/
          interpreter.ts
          validation.ts
          agent.ts
          reconciliation.ts
          gaps.ts
          policy.ts
          executor.ts
        db/                    # client, migrations, seed
        audit.ts
    web/                       # frontend (Next.js) -> Vercel
      src/
        app/
        components/
        lib/api.ts
  packages/
    core/                      # pure, deterministic, shared types + policy + reconciliation
      src/
        types.ts
        authority.ts
        reconciliation.ts
        policy.ts
        schemas.ts
    eval/                      # evaluation harness + baseline runner
      src/
        harness.ts
        metrics.ts
        run-baseline.ts
  evals/                       # cases.json, expected.json, baseline-results.json
  research/
  docs/
```

Rationale: `packages/core` is **pure and deterministic** (no I/O, no LLM) so it is unit-testable and is the correctness backbone. `apps/api` composes it with the LLM interpreter and read-only integrations. `packages/eval` is a consumer of `core`, not a runtime dependency of the product.

## 5. Database schema (Postgres — Neon/Supabase)

Append-only audit is first-class; operational state is a snapshot mirror of external systems, never the source of truth.

```
accounts         (id, external_id, domain, name, created_at)
owners           (id, external_id, name, email, created_at)
contacts         (id, account_id, external_id, email, first_name, last_name, created_at)
deals            (id, account_id, owner_id, external_id, stage, amount, close_date, updated_at)
tasks            (id, account_id, contact_id, owner_id, external_id, title, type, status, due_date, updated_at)
email_threads    (id, account_id, external_id, subject, participants)
email_messages   (id, thread_id, external_id, from_addr, to_addrs, subject, body, sent_at)
subscription_state (id, account_id, plan, status, trial_start, trial_end, grace_period_end, active_since, exception_json, source, updated_at)

runs             (id, case_id, status, model, started_at, finished_at, latency_ms, prompt_tokens, completion_tokens, cost_usd, error)
run_steps        (id, run_id, step_type, step_index, input_json, output_json, tool_calls_json, latency_ms, token_usage_json)
interpretations  (id, run_id, semantic_state_json, evidence_spans_json)
reconciliations  (id, run_id, classification, gaps_json, evidence_json)
proposed_actions (id, run_id, reconciliation_id, action_type, payload_json, requires_approval, review_reason, status)
reviews          (id, run_id, proposed_action_id, decision, reviewer, decided_at, edited_payload_json)
executions       (id, run_id, proposed_action_id, status, idempotency_key, external_ref, error, executed_at)
audit_log        (id, run_id, event_type, payload_json, created_at)
```

Design notes:
- `external_id` columns keep the authoritative foreign key from HubSpot/Gmail/commercial; the local DB is a cache/projection, and reconciliation always re-reads the authoritative adapter (or a fixture snapshot) rather than trusting a stale mirror.
- `subscription_state` is versioned by `updated_at`; the latest row per `account_id` with the commercial source tag is authoritative for subscription facts.

## 6. API surface (backend)

```
POST   /runs                       # start processing an interaction (transcript + optional context refs)
GET    /runs/:id                   # status (processing | needs_review | done | failed)
GET    /runs/:id/result            # full result: what_changed, revenue_state, gaps, proposals, review
GET    /runs                       # run history
POST   /runs/:id/review            # approve / edit / reject a proposed action
POST   /runs/:id/execute           # execute approved actions (safe ones auto; consequential after approval)
GET    /audit                      # audit trail for a run
GET    /accounts/:id/context       # read-only operational context (for the review UI)
POST   /demo/seed                  # load synthetic fixtures for a case (demo mode)
GET    /demo/cases                 # list cases for demo mode
```

Principles: the API is **review-first**. It returns proposals with `requires_approval` flags; it never performs consequential mutations without an explicit review decision. `execute` only runs allowlisted, approved actions.

## 7. Semantic interpreter contract

**Input:** untrusted raw interaction text (transcript/note/email) + source metadata.

**Output (versioned JSON schema):** a *validated structured semantic state*:

```
{
  decisions:            Decision[],
  confirmed_commitments:   Commitment[],
  candidate_commitments:   Commitment[],
  conditional_commitments: Commitment[],   // condition preserved verbatim
  internal_tasks:       TaskIntent[],
  customer_actions:     TaskIntent[],
  entity_references:    EntityRef[],       // resolved to owner/contact only where supported
  temporal_expressions: TemporalRef[],     // resolved only where deterministic; else "ambiguous"
  blockers:             string[],
  commercial_signals:   Signal[],          // qualitative, e.g. "intends to upgrade"
  state_implications:   Implication[],     // potential operational deltas (non-authoritative)
  evidence:             EvidenceSpan[]     // every claim -> exact source offsets
}
```

Constraints enforced by the **deterministic validation** layer (not by the LLM):
- No claim without an evidence span.
- Never fabricate an owner or identity; ambiguous stays `null` + `reason`.
- Tentative language → `candidate_commitments`, never `confirmed_commitments`.
- Conditional commitments retain their condition; they are never collapsed into confirmed ones.
- Ambiguous dates are emitted as `ambiguous`, never coerced to a concrete timestamp.

## 8. Agent tool contracts (read-only)

Every tool is **read-only, idempotent, and source-tagged**. No mutation tools exist on the agent.

```
resolve_account(query)            -> Account[]
get_account_context(account_id)   -> AccountContext
get_contacts(account_id)          -> Contact[]
get_open_deal(account_id)         -> Deal | null
get_recent_notes(account_id)      -> Note[]
get_open_tasks(account_id)        -> Task[]
get_email_thread(thread_id)       -> Thread
check_existing_action(account_id, signature) -> ActionMatch | null   # duplicate detection
get_commercial_state(account_id)  -> SubscriptionState               # authoritative
get_customer_activity(account_id) -> Activity[]
get_commercial_exception(account_id) -> Exception | null
```

Each tool result carries `{ source, authority }` so downstream reconciliation knows *which* system supplied the fact and *how authoritative* it is. The agent returns a structured **tool-selection reason** per call (e.g., `need-commercial-state`, `duplicate-check`, `resolve-owner`) to make unnecessary-tool-call measurement possible.

## 9. Agent orchestration design

Single bounded reasoning agent (explicitly **not** multi-agent):

1. Receive validated semantic state.
2. Loop (bounded): decide which facts are required → select read-only tools with a reason category → call → cache results in-run.
3. Compare retrieved authoritative state against the semantic state.
4. Emit a structured reconciliation/gap proposal (not prose) and stop.

Constraints: max tool-call budget; duplicate-call prevention; in-run cache; no chain-of-thought persisted; no mutation tools; the agent cannot approve its own recommendation.

## 10. Source authority representation

A **fact-type → authority** map, resolved deterministically (never by the LLM):

| Fact type | Authoritative source |
|---|---|
| Subscription / trial / payment state | Commercial provider |
| CRM records, tasks, pipeline, owner, notes | HubSpot |
| Stated intent, commitments, decisions, qualitative context | Conversation (evidence only) |
| External communication that actually occurred | Gmail |

Each retrieved fact is tagged `authoritative | evidence | derived`. Rule: **authoritative beats evidence** for actual-state claims. Example: a customer's "we intend to subscribe" (conversation/evidence) does **not** set `subscription_status = active`; only commercial state does.

## 11. Reconciliation algorithm (deterministic)

For each semantic claim (commitment, decision, implication):

1. Determine the required facts and their authoritative sources.
2. Retrieve/compare the operational state.
3. Classify into the canonical set:

| Classification | Trigger |
|---|---|
| `missing` | confirmed claim has no operational representation (e.g., no task/record). |
| `duplicate` | an equivalent task/record already exists (same action+contact+owner+date). |
| `contradictory` | claim conflicts with authoritative state (e.g., "we signed" vs CRM Negotiation + commercial trial). |
| `stale` | one source lags authoritative state (e.g., HubSpot Trial vs commercial Active). |
| `ambiguous` | identity/owner/date cannot be resolved. |
| `unsafe` | injection detected, or required source unavailable. |
| `aligned` | no gap. |

Output: `ReconciliationResult[]` with classification, evidence spans, and the source-authority comparison used.

## 12. Execution gap algorithm

Convert reconciliation output into **actionable gaps**:

- `what_changed` — decisions from the conversation.
- `what_missing` — confirmed commitments with no task/record → propose `create_task`.
- `what_stale` — CRM lagging authoritative state → propose field/stage sync.
- `what_conflicts` — contradiction → propose verification (never auto-resolve).
- `what_needs_review` — ambiguous/unsafe/consequential → route to human review.

Each gap maps to a `ProposedAction` with a `requires_approval` flag derived from policy (item 13). Gaps, not raw LLM output, drive the UI.

## 13. Policy state machine (deterministic)

LLM output has **zero** execution authority. Deterministic code controls schemas, evidence validation, permissions, allowlists, idempotency, retries, and state transitions.

Lifecycle transitions:
- **Closed Won** eligible iff authoritative commercial state shows active subscription/conversion **and** HubSpot is not already correct. Conversation may *support* this but does not establish it. Requires human approval (v1).
- **Closed Lost** eligible iff trial ended **and** configured grace period expired **and** no active subscription **and** no approved exception. Requires human approval (v1).

Executor allowlist (the only supported actions):
- create HubSpot note
- create HubSpot task
- update an allowlisted HubSpot field
- update deal stage **after approval**
- create Gmail draft **after approval**

**No automatic customer email sending.**

## 14. Executor design

Deterministic, idempotent, with no LLM authority. It executes only actions that are (a) allowlisted and (b) either `!requires_approval` or approved. Each execution records: idempotency key, external ref, status, and error. Email is **draft-only**; "send" is never an executor action.

## 15. Idempotency design

- Idempotency key = hash of `(account_id, action_type, normalized_payload, target_external_ref)`.
- Notes/tasks are upserted, not blindly inserted; `check_existing_action` is consulted before `create_task` to prevent duplicates.
- `executions` table enforces uniqueness on `idempotency_key`, so re-running a run or a retry cannot double-apply a mutation.

## 16. Retry / failure design

- **Tool calls:** bounded retries with backoff on transient errors; hard failures surface as a step error, not a silent skip.
- **LLM calls:** retry on 429/5xx; on malformed JSON, a single reformat retry, else mark the run `failed` with a safe result.
- **Executor:** idempotent actions may retry; non-idempotent external mutations re-check current state before any retry.
- **Fail-safe:** any missing required context produces a review/failure, never a guess (case-12 behavior).

## 17. Observability design

- Append-only `audit_log` + `run_steps` capture the full causal chain: input, tool calls (with reasons), retrieved facts (with source/authority), classification, proposal, review, execution.
- Structured JSON logs; one trace per run, spans per step.
- Metrics: latency, prompt/completion tokens, estimated cost, tool-call count, unnecessary-tool-call count, classification distribution, and **critical incorrect execution count** (the safety headline metric).

## 18. Frontend/backend contract

- Frontend consumes the REST API only; types shared from `packages/core`.
- Primary UX flow (review-first, **not a chatbot**):
  `Process Interaction → What Changed → Revenue State → Execution Gaps → Needs Review → Current vs Proposed → Approve/Edit/Reject → Execution Result → Run History/Audit`.
- The review screen shows `current vs proposed` side-by-side with evidence spans, so a non-developer can approve/edit/reject without reading JSON.

## 19. Evaluation hooks

- Harness loads `evals/cases.json`, runs the full pipeline, and compares against `evals/expected.json` across:
  - **A. Semantic** — commitment precision/recall, owner accuracy, due-date accuracy, evidence validity.
  - **B. Agent/retrieval** — required-context retrieval, unnecessary tool calls, avg tool calls/run.
  - **C. Reconciliation/gap** — gap precision/recall, classification accuracy, CRM proposal accuracy.
  - **D. Policy/safety** — lifecycle transition accuracy, review routing, critical incorrect execution count.
  - **E. Operational** — latency, token usage, estimated cost/run.
- **Golden separation:** `expected.json` is consumed only by the evaluator after generation; it is never passed to the model.
- **Naive baseline:** `packages/eval/src/run-baseline.ts` + `npm run eval:baseline`, producing `evals/baseline-results.json` and `evals/baseline-summary.md` (single generic prompt, no agent/retrieval/policy). This is the reference against which the engineered system is compared.

## 20. Deployment architecture

- **Frontend:** Vercel (Next.js).
- **Backend:** Railway (Node/TS service).
- **Database:** Neon or Supabase Postgres.
- `.env.example` committed; **no secrets**. Demo/sample mode seeds synthetic fixtures so reviewers can drive the 12 cases with a live URL.

## 21. Exact implementation phases (dependency order)

1. **Scaffold** — workspace, `package.json`, `tsconfig.base.json`, `directive.md`, `README.md`, `.env.example`.
2. **`packages/core`** — types, authority map, reconciliation, policy (pure, unit-tested) — this is the correctness backbone and unblocks everything else.
3. **DB** — schema, migrations, synthetic seed (mirrors fixture shapes).
4. **Integration adapters** — HubSpot, Gmail, Commercial provider behind provider contracts (Commercial = deterministic synthetic fixtures now, swappable later).
5. **Semantic interpreter** — LLM extraction + deterministic validation.
6. **Reasoning agent** — read-only tools + bounded orchestration.
7. **Reconciliation + gaps + policy + executor** — deterministic layers composing `core`.
8. **API + audit** — routes, run orchestration, observability.
9. **Eval harness + baseline** — run against the 12 cases; produce `baseline-results.json` + `baseline-summary.md`.
10. **Frontend** — review-first UX over the API.
11. **Deploy + demo mode** — live URL, seed, polish.

## 22. Recommended cuts (complexity without payoff for a 4-day assessment)

- **RAG / embeddings / vector DB** — bounded, source-tagged retrieval over a handful of records is sufficient; embeddings add cost and failure surface with no real gain here.
- **Browser agents** — not needed; deterministic adapters + fixtures cover the integrations.
- **Multi-agent architecture** — a single bounded agent is clearer, cheaper, and easier to evaluate.
- **Autonomous email sending** — draft-only is a hard product rule; any "send" machinery is cut.
- **Arbitrary/plugin tool execution** — allowlist-only executor.
- **Microservices / Kubernetes** — a single API service + Vercel frontend is enough.
- **Redis / background queue** — in-process, synchronous run orchestration is fine for a demo; note it as a production scaling point only.
- **Heavy observability stack (OTel collector, Grafana)** — structured JSON logs + a metrics endpoint give enough signal for the eval dimensions.
