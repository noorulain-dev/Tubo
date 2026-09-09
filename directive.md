# Tubo — Revenue Execution OS

MUST Company 5-Day Remote AI OS Sprint · Final Directive

---

# Problem

Revenue operators lose a customer conversation the moment the call ends. After a
customer conversation — or any customer event — the *reality* of that interaction
fragments across five disconnected systems:

- the **conversation/transcript** (what was actually said and agreed),
- **HubSpot CRM** (deal stage, owner, tasks, notes),
- **Gmail** (what was actually sent or replied to),
- **tasks** (follow-ups that were or were not created or closed),
- **Calendar** (the meeting itself and its context),
- **commercial/subscription state** (authoritative billing truth).

Each system is a partial, independently-updated view. None of them is the whole
picture, and none of them is automatically consistent with the others. The operator
is left to reconcile them by hand.

**Target user:** Luis Mussa, a Customer Success Manager who runs back-to-back client
meetings. In his own words, captured verbatim during the pilot:

> "You really did something with this product here"

> "Tubo caught the little things I often miss after taking back to back client
> meetings and my brain is fried"

**The job-to-be-done** is not "turn meeting notes into tasks." It is *knowing, after
every conversation, what changed, what is missing, what contradicts, what is already
done, what needs attention, what requires approval, and what can safely execute* —
before a consequential revenue action happens.

**Operational state drift** is the core problem. A customer says "we're not ready to
sign" while the CRM still reads "Closed Won." A follow-up task was never created. An
email answered half the commitment. Commercial state was never verified. Within a
day, four systems disagree — and someone makes a decision from whichever one they
happened to open.

**Why conversation extraction alone is insufficient.** Extracting commitments from a
transcript answers "what did the customer say." It does not answer "does reality
match?" A commitment has no value until it is reconciled against the authoritative
state of the deal, the task list, the sent mail, and the subscription. A confident
conversation can mask a cancelled subscription or a stale stage. Extraction without
reconciliation produces confident, incorrect follow-up.

**Business consequence.** Stale, missing, or contradictory state produces duplicate
follow-ups to the same customer, missed execution gaps, incorrect commercial
transitions (e.g. marking a deal Closed Won on optimism, or Closed Lost on a stale
CRM), and manual cross-tool re-checking that does not scale past a handful of
accounts.

---

# Priority

This was scoped to five days because it targets the single highest-leverage point in
the revenue workflow: the **recurring** post-conversation reconciliation a CSM
performs dozens of times a week.

The scope is justified by:

- **Repetition.** The same cross-system check happens after every meeting, every day.
- **High consequence of missed follow-up.** A dropped commitment or an unanswered
  customer question directly loses or delays revenue.
- **CRM drift.** Deal stage and owner fall out of sync with what the customer
  actually said.
- **Duplicate work.** Re-creating tasks and re-sending emails that already exist.
- **Incorrect commercial transitions.** Marking Closed Won without authoritative
  proof of conversion, or Closed Lost against a stale CRM.
- **Manual reconciliation cost.** Cross-tool checking is slow, error-prone, and
  depends on operator memory ("my brain is fried").
- **Trust requirement.** The operator will not delegate consequential CRM/email
  actions to a system unless that system is provably safe, auditable, and
  review-first.

**Non-goals (explicit):**

- Replacing HubSpot.
- Autonomous emailing (sending is blocked; only drafts are ever prepared).
- Unrestricted autonomous CRM mutation (execution is allowlisted + human-approved).
- Controlling Fireflies meeting attendance (Tubo never tells Fireflies to join or
  record a meeting).
- A generalized workflow builder (no arbitrary DAG language; only per-action
  dependencies).
- Full enterprise multi-user RBAC (tenancy is single-user-scoped in this sprint).

---

# Approach

The system is an **AI-understands, system-executes** architecture. The LLM is given
the authority to *understand, retrieve, compare, investigate, and propose* — and is
explicitly **denied** the authority to *execute, approve, or override policy*.

The pipeline, in the actual implementation order:

```
Customer Interaction / Event
  → Semantic Extraction (SemanticInterpreter + production LLM → validated SemanticState)
  → Structured Interaction State (Zod-validated, evidence-span-bound)
  → Bounded AI Investigation (read-only ReasoningAgent, tool budget + cache)
  → Read-only Operational Retrieval (DeterministicToolPlanner)
  → Source-Aware State Reconciliation (reconcile → classified findings)
  → Execution Gap Detection
  → Deterministic Validation (enforceRules safety net)
  → Deterministic Policy (evaluateAction — sole execution gatekeeper)
  → Human Review (proposals / execution plans, approve/edit/reject)
  → Deterministic Execution (allowlisted executor)
```

**Why this architecture.** Correctness in revenue operations is dominated by two
things: *model imprecision* (inventing an owner, promoting tentative language to a
commitment) and *deterministic classification* (mapping evidence to the correct
state). The architecture isolates both. Semantic understanding is delegated to the
model; classification, validation, policy, and execution are deterministic and
unit-tested. This makes the correctness backbone reproducible and auditable while
still using the model where only a model works — reading unstructured conversation.

**The critical distinction.** The LLM may understand, retrieve, compare, investigate,
and propose. It does **not** receive unrestricted execution authority. Policy,
approval, and consequential execution are deliberately separated from semantic
reasoning. The model can recommend "mark Closed Won"; only the deterministic policy
engine decides whether that is even eligible, and only a human approval can trigger
it. LLM/agent output has **zero** policy authority.

**Source authority** (see [Source Authority](#source-authority)) means every fact
carries a `{ source, authority }` tag and a weaker source can never overwrite a
stronger one.

**Why an LLM cannot infer Closed Won from optimism.** A conversation expressing
purchase intent is *evidence*, never *proof of payment*. Closed Won eligibility
requires authoritative commercial state showing an active subscription/conversion
plus a deal that is not already closed. Conversational optimism can explain intent;
it can never authorize the transition. Symmetrically, a stale CRM showing "Trial"
cannot justify Closed Lost when commercial state is still active.

**Missing Context Resolution.** When a gap can only be answered by a human (an
unresolvable owner, a decision only the operator can make), the system surfaces it as
a *candidate question*, not a guess. The operator selects from candidates derived
from real data, and the backend re-derives the gap and rejects any value that is not
one of those candidates. The human-supplied answer is recorded as **human-supplied
context with provenance** — it is never silently rewritten as model-derived evidence,
so the distinction between "the model saw this" and "a human told us this" remains
auditable.

---

# Solution

Tubo is a working TypeScript monorepo (npm workspaces: `packages/core`,
`apps/api`, `apps/web`) deployed as an API service, a background worker, and a
React SPA against Postgres.

## What is implemented

**Semantic extraction.** [`SemanticInterpreter`](packages/core/src/interpreter/semantic-interpreter.ts)
turns an untrusted interaction into a Zod-validated `SemanticState`. The hardened
contract distinguishes five buckets — confirmed commitment, discussion/suggestion,
conditional commitment, decision, and commercial fact-claim — and never
cross-contaminates them. Tentative language ("we should…") is not promoted to a
commitment; conditional commitments preserve their condition verbatim; ambiguous
owners and dates stay unresolved rather than being invented. Every claim is bound to
an evidence span.

**Discussion vs. commitment.** A bare brainstorm or suggestion is not a commitment;
only explicit, unconditional obligation is. Collective actors ("the team",
"whoever") stay `owner = null` / `ambiguous`; first-person "we/us" by a named
speaker resolves to that speaker's organization.

**Owner resolution.** Identity is resolved only through authoritative sources
(exact participant email → HubSpot contact → company → open deal). It never derives
identity from an email local-part, never invents an email, and never creates phantom
CRM objects.

**Account matching.** [`meeting-correlation.ts`](packages/core/src/correlation/meeting-correlation.ts)
matches a meeting to a Calendar event (event id → URL → organizer/time/participant
overlap) and then to a HubSpot account, with a typed
`resolved | ambiguous | unsupported | missing_context | conflicting` result.

**HubSpot context.** [`HubSpotCRMProvider`](packages/core/src/hubspot/hubspot-crm-provider.ts)
provides read-only deal/contact/task/note access and idempotent writes (create note,
create task, update field, update stage).

**Gmail evidence.** Gmail is read-only for *what was actually sent or replied*, and
can prepare (not send) drafts. A commitment is marked fulfilled only on outbound
Gmail evidence carrying `delivered: true` with an explicit link — never on a
"similar-sounding" email.

**Calendar context.** Google Calendar is read-only meeting context, synced by the
worker, with push-watch channel renewal.

**Fireflies ingestion.** Fireflies is an optional, user-owned, **read-only** meeting
notes integration. Tubo does **not** command Fireflies to join meetings. It consumes
transcripts/summaries that the user's own Fireflies account already produced, and it
has no bot/attendance commands at all.

**Background worker.** [`worker.ts`](apps/api/src/jobs/worker.ts) runs a durable,
Postgres-backed job queue (`SELECT … FOR UPDATE SKIP LOCKED`) with no Redis. Job
types: `calendar.sync`, `fireflies.sync`, `fireflies.fetch`, `interaction.process`,
`account.refresh`. Transient failures (429/5xx/timeout) retry with bounded
exponential backoff; permanent failures (revoked auth, invalid key) persist as
`failed` and never retry.

**Automatic Fireflies transcript synchronization.** The worker uses meeting/Calendar
context to *discover* meetings Fireflies has already processed. After an eligible
meeting, it schedules a one-shot Fireflies discovery (event-driven, not endless
polling); when a transcript becomes available it fetches, normalizes, and enqueues
it for processing. Participant extraction and account correlation happen
deterministically, so a transcript can be ingested and correlated to HubSpot
accounts without the operator manually pasting notes. Manual pasted notes remain
fully supported.

**Account intelligence.** An append-only event ledger plus a deterministic state
builder produces a versioned per-account snapshot (commitments, questions, blockers,
commercial state, stage, recent events, execution gaps), rebuilt by folding the
ordered event history — reproducible, no LLM re-call.

**State reconciliation.** [`reconcile`](packages/core/src/reconciliation/engine.ts)
compares each semantic item against authoritative operational context and classifies
it: `missing`, `stale`, `duplicate`, `contradictory`, `ambiguous`, `unsafe`, or
`aligned`. Precedence is deterministic
(`unsafe` > `contradictory` > `ambiguous` > `stale` > `duplicate` > `missing` >
`aligned`).

**Execution gaps.** Findings feed a gap detector that surfaces what is missing,
what needs attention, and what is already done.

**AI investigation.** A bounded, read-only agent selectively investigates a finding
and returns `CONFIRMED | REJECTED | AMBIGUOUS | MISSING_CONTEXT`, with a persisted
operational trace and no hidden chain-of-thought.

**Human approval.** Every consequential action is a `ProposedAction` with a
`requiresApproval` flag, gathered into evidence-backed execution plans with
per-action policy and `dependsOn` links. The operator approves, rejects, or edits
each action; editing re-runs server-side policy revalidation.

**Deterministic execution.** Only allowlisted actions (`create_note`, `create_task`,
`update_field`, `update_stage`, `create_draft`) can execute, and only when approved.
`send` and `create_draft` with `send: true` are always blocked.

**HubSpot task creation / stage updates / Gmail drafts.** These are the concrete
allowlisted write actions, each idempotent (signature-unique) and each gated by
policy then human approval.

**Idempotency, durable jobs, retry/fallback.** Idempotency is persistence-backed
across interaction ingestion, meeting artifacts, jobs, and executions. Retries use
bounded exponential backoff with jitter. Fallbacks are fail-closed: commercial
unavailable → `missing context` (never "not subscribed"); Gmail unavailable → cannot
prove absence; LLM failure → processing failure (no consequential execution).

**Audit trail.** Every run records its steps, tool calls with reason categories,
policy decisions, approvals, and executions. No chain-of-thought is persisted;
sensitive fields are redacted from logs.

**UI.** Process Interaction, Command Center (attention queue), Accounts (intelligence
snapshot + events), Runs, Review (proposals + audit), Settings → Integrations with
per-provider connection panels (HubSpot, Gmail, Calendar, Fireflies), and a public
Evaluation page.

---

# Expected Outcome

Results are reported in three deliberately-separated categories.

## User / workflow outcome

The user workflow evidence is Luis's real post-meeting workflow, collected
organically. The manual baseline (`research/baseline-runs.csv`) models three
representative scenarios from that workflow: a clean post-call commitment, a
messy multi-action interaction, and a commercial-state reconciliation.

Measured user evidence is the pilot feedback above: Luis reports Tubo "caught the
little things I often miss" after back-to-back meetings.

## AI / system evaluation

The final pre-deployment gate **passes** (`evals/predeploy-v4-summary.md`), on the
frozen 14-use-case official corpus plus an 8-case supplemental multi-event corpus:

| Gate | Target | Measured |
|---|---|---|
| Official classification | ≥ 10/14 | **12/14** |
| Supplemental OS (multi-event) | ≥ 7/8 | **8/8** |
| Required-retrieval recall | ≥ 0.90 | **0.972** |
| Owner accuracy | ≥ 0.90 | **1.0** |
| Classification accuracy | — | **1.0** |
| Stability (3× runs) | consistent | **12/14 × 3, no flips** |

Selected model: **gpt-6-astra** (Responses API, effort `medium`).

## Safety / reliability

| Metric | Value |
|---|---|
| External executions | **0** |
| Policy bypass / self-approval | **0** |
| Prompt-injection authority escalation | **0** |
| Incorrect external execution | **0** |

The system's own failure ledger concludes: "the safety layer is working as designed…
**no incorrect external mutation occurred**" across every run, including the cases
where the model recommended an unsafe action that policy blocked.

---

## Target User and Job-to-be-Done

**User:** Luis Mussa, Customer Success Manager (and revenue operators like him).
**Job:** after every customer conversation, arrive at a *review-ready* account state
— knowing what changed, what's missing, what's contradictory, what's already done,
what needs attention, what needs approval, and what can safely execute — without
manually cross-checking five systems.

## Existing Workflow

Today the operator, after each call: re-reads the transcript, opens HubSpot to check
deal stage and tasks, opens Gmail to check what was sent, checks the calendar, and
tries to verify commercial/billing state — holding all of it in their head across
context switches. Gaps and contradictions are caught only if the operator remembers
to look at the right system at the right time.

## Scope and Non-Goals

In scope: semantic extraction, bounded read-only investigation, source-aware
reconciliation, execution-gap detection, deterministic policy, human approval,
allowlisted execution, durable background ingestion, audit. Out of scope: replacing
HubSpot, autonomous emailing, unrestricted CRM mutation, commanding Fireflies
attendance, a generic workflow builder, and enterprise multi-user RBAC.

## Architecture

Three services over Postgres:

- **API** (Hono + `tsx`, no build step) — routes, services, repositories.
- **Worker** (`tsx` long-running loop) — durable Postgres job queue.
- **Web** (Vite + React 18) — review-first SPA.

`packages/core` is the pure, deterministic, I/O-free correctness backbone
(semantic schema, reconciliation, policy, providers, idempotency); `apps/api`
composes it with the LLM interpreter and read-only integrations; `apps/web`
consumes the API. The frozen intelligence core (semantic prompt/schema,
reconciliation logic, retrieval planner, policy authority, model selection, and the
frozen eval fixtures) is intentionally never modified.

## AI Authority vs System Authority

- **AI may:** understand interaction, retrieve read-only sources, compare, investigate,
  propose actions, draft email copy, explain evidence.
- **AI may not:** write HubSpot, send email, approve itself, override policy, change
  permissions, or execute. Enforced structurally — the tool registry contains only
  read tools; there is no mutation tool for the agent to call. `evaluateAction`
  remains the sole execution gatekeeper.

## Source Authority

| Fact | Authoritative source | Evidence-only source |
|---|---|---|
| Subscription / payment / commercial truth | commercial (HubSpot commercial context) | conversation intent |
| What the customer literally promised | conversation | CRM metadata |
| Whether an operational task exists | tasks / HubSpot | transcript inference |
| CRM stage / owner | HubSpot | conversation |
| Communication actually sent / delivered | Gmail | conversation |

A weaker source can never overwrite a stronger one.

## Human Approval Model

Consequential actions are proposals that require approval; safe-to-prepare actions
(notes) may proceed; informational actions take no external effect. Execution plans
allow per-action approve/reject/edit with dependencies, and `executeApproved` runs
only `approved`, allowlisted actions. No autonomous external mutation.

## Evaluation Method

A deterministic harness (no LLM judge) compares system output to frozen gold labels
in `evals/cases.json` + `evals/expected.json`. The final `system-v0`/`predeploy-v4`
runs execute the **real** production path (real `SemanticInterpreter` + configured
model + real agent + frozen deterministic fixture providers), with the executor
never invoked, and fail loudly if the real model key is missing. Ground truth is
loaded once for post-hoc comparison and is never passed to the model or any prompt.

## Results

See [Expected Outcome](#expected-outcome). The progression tells the real story:
an early keyword-stand-in harness scored 3/14 and was **rejected as an invalid
measure** of the AI system; the real `gpt-4o` run scored 4–5/14 (gate FAIL); after
hardening the semantic contract and retrieval planner and selecting `gpt-6-astra`,
the system reached **12/14 official + 8/8 supplemental**, stable across three runs,
with zero safety violations.

## Failure-Driven Development

- **An early evaluator that did not exercise the production semantic model was
  rejected.** The keyword/regex `createEvalLLM` stand-in produced a 3/14 result that
  was audited as a *plumbing sanity check*, not an intelligence measurement, and
  replaced with the real-model `system-v0` harness (`docs/evaluation-harness-audit.md`).
- **Provider/model availability was investigated rather than assumed.**
  `gpt-5.6-sol`/`gpt-5.6-terra` were found unavailable on the configured OpenAI
  account (non-existent model ids), so the benchmark pivoted to `gpt-6-astra`
  (`docs/intelligence-quality-gate.md`).
- **Frozen ground truth was preserved, not rewritten.** Two cases were flagged as
  `GROUND_TRUTH_QUESTION` and left for human review rather than editing the gold
  labels to make tests pass.
- **Benchmark-specific brittle fixes were rejected.** Reconciliation changes were
  generalizable rule changes (token-subset task equivalence, precedence ordering),
  not case-targeted patches.
- **Model/retrieval improvements were evaluated repeatedly.** Retrieval recall moved
  from 0.792 → 0.972 by making the planner bounded (baseline deal+tasks, signal-
  triggered commercial/Gmail) rather than retrieve-all.
- **Unsafe output is preferable to block/review rather than execute.** Across every
  run, the policy engine blocked unsafe recommendations; "a higher pass rate with
  weaker safety is not an improvement."

## Reliability and Safety

Zod request validation, structured pino logging with secret redaction, request
correlation ids, bounded timeouts, bounded retries (transient-only), fail-closed
fallbacks, persistence-backed idempotency, scrypt password hashing + hashed session
tokens, and stable error envelopes. Readiness (`/ready`) fails when Postgres is
down; no silent in-memory fallback.

## Integrations

- **HubSpot** — CRM read/write (idempotent) + commercial context (native subscriptions
  or explicit property mapping).
- **Gmail** — OAuth read + draft preparation (no send).
- **Google Calendar** — OAuth read + sync + push-watch.
- **Fireflies** — read-only transcript ingestion (no attendance control).
- **Stripe** — commercial provider (stripe-commercial-provider in core) alongside
  HubSpot commercial context.

## Limitations

- Email is **draft-only**; external send is deliberately unsupported in this sprint.
- Single-user tenancy (no enterprise multi-user RBAC).
- In-process rate limiting (not distributed); single-instance assumption.
- Raw `pg` (no ORM/migration runner); schema via idempotent `ensureSchema()`.
- Fireflies/Gmail/Calendar OAuth limited to approved test accounts (Google
  verification limits).
- HubSpot native Commerce subscriptions depend on portal tier + token scopes.

## Two-Week Iteration Plan

**Week 1 — close the trust loop.**
1. Reviewed external send (human-approved, one-shot) behind an explicit
   "draft → send" confirmation, still never autonomous.
2. Distributed rate limiting + a shared job queue for horizontal scale.
3. Real-data (non-fixture) end-to-end verification against the provisioned HubSpot
   accounts.

**Week 2 — operationalize.**
4. Multi-account batch scan across a user's whole book of business.
5. Provider refresh on webhook (HubSpot deal change → automatic re-reconcile).
6. Quantified operator time-to-review benchmark against the synthetic baseline.
